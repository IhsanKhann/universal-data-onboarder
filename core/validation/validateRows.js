// services/shared/importValidation.service.js
// Migration Wizard — full build (Party Model Standardization "Phase 6").
// Required/type checks, intra-file duplicate detection, existing-record
// duplicate detection, and foreign-key resolution (HR's orgUnit/role/branch
// name lookups) — the "make the data trustworthy" step
// (MIGRATION_WIZARD_PLAN_2026-07-07.md §4 step 6).
//
// Every batched query (dedup grouping, distinct identity/reference values,
// existing-record checks) runs ONCE for the whole job, never once per row —
// the only per-row work is a cursor pass applying results already computed.
import mongoose from "mongoose";
import { getTargetDescriptor } from "../../registry/registerTarget.js";
import { coerceFieldValue } from "../../registry/importTargetRegistry.service.js";
import { resolveSessionReferences } from "../../orchestration/sessionManager.js";
import { createMongooseJobStore } from "../../orchestration/jobStore.js";
import logger from "../../utils/logger.js";

const jobStore = createMongooseJobStore();

const SERVICE = "importValidation.service";

// ── validateImportJob ─────────────────────────────────────────────────────────

export const validateImportJob = async (tenantId, importJobId, conn = mongoose) => {
  const job = await jobStore.getJob(tenantId, importJobId, conn);
  if (!["mapped", "validated"].includes(job.status)) {
    throw Object.assign(
      new Error(`Cannot validate an import job in status "${job.status}" — expected "mapped" or "validated"`),
      { statusCode: 409 }
    );
  }

  const descriptor = getTargetDescriptor(job.module, job.entityKey);
  const { fields, identityField } = descriptor;
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  const enumFields = fields.filter((f) => Array.isArray(f.enum) && f.enum.length);

  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);

  // ── Pass 1: intra-file duplicate identity values (one aggregation) ──────────
  const dupGroups = await jobStore.aggregateStaged(conn, [
    { $match: { tenantId: tenantObjectId, importJobId: job._id } },
    { $group: { _id: `$mappedFields.${identityField}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 }, _id: { $ne: null } } },
  ]);
  const duplicateIdentityValues = new Set(dupGroups.map((g) => g._id));

  // ── Pass 2: existing-record duplicates (one batched query, if the target defines one) ──
  let existingIdentities = new Set();
  if (descriptor.findExistingIdentities) {
    const distinctIdentityValues = await jobStore.distinctStaged(conn, `mappedFields.${identityField}`, {
      tenantId, importJobId: job._id,
    });
    existingIdentities = await descriptor.findExistingIdentities(
      tenantId, distinctIdentityValues.filter((v) => v != null), conn
    );
  }

  // ── FK resolution ───────────────────────────────────────────────────────────
  let referenceLookups = null;
  if (descriptor.referenceFields?.length) {
    const distinctValuesByKey = {};
    await Promise.all(descriptor.referenceFields.map(async (key) => {
      const values = await jobStore.distinctStaged(conn, `mappedFields.${key}`, { tenantId, importJobId: job._id });
      distinctValuesByKey[key] = values.filter((v) => v != null);
    }));
    referenceLookups = await descriptor.resolveReferences(tenantId, distinctValuesByKey, conn);

    if (job.sessionId) {
      const sessionResolved = await resolveSessionReferences(
        tenantId, job.sessionId,
        { referenceFields: descriptor.referenceFields, resolveReferences: async () => referenceLookups },
        distinctValuesByKey, conn
      );
      for (const [fieldKey, fieldMap] of Object.entries(sessionResolved)) {
        if (referenceLookups[fieldKey]) {
          for (const [key, value] of fieldMap) {
            if (!referenceLookups[fieldKey].has(key)) {
              referenceLookups[fieldKey].set(key, value);
            }
          }
        } else {
          referenceLookups[fieldKey] = fieldMap;
        }
      }
    }
  }

  // ── Pass 3: per-row cursor — required/type checks, dedup flags, FK checks ───
  const cursor = jobStore.cursorStaged(conn, { tenantId, importJobId: job._id });
  const seenIdentityValues = new Set();
  let bulkOps = [];
  const CHUNK_SIZE = 500;
  let validCount = 0;
  let invalidCount = 0;

  for await (const record of cursor) {
    const errors = [];
    const mf = record.mappedFields ?? {};

    for (const key of requiredKeys) {
      if (mf[key] == null || mf[key] === "") {
        const label = fields.find((f) => f.key === key)?.label ?? key;
        errors.push(`"${label}" is required`);
      }
    }

    for (const field of enumFields) {
      const value = mf[field.key];
      if (value == null || value === "") continue;
      if (!field.enum.includes(value)) {
        errors.push(`"${field.label}" value "${value}" is not one of: ${field.enum.join(", ")}`);
      }
    }

    const identityValue = mf[identityField];
    if (identityValue != null) {
      if (duplicateIdentityValues.has(identityValue)) {
        if (seenIdentityValues.has(identityValue)) {
          errors.push(`Duplicate within this file — another row already uses this ${identityField}`);
        }
        seenIdentityValues.add(identityValue);
      }
      if (existingIdentities.has(String(identityValue))) {
        errors.push(`Already exists — a record with this ${identityField} already exists`);
      }
    }

    if (referenceLookups) {
      for (const key of descriptor.referenceFields) {
        const value = mf[key];
        if (value == null) continue;
        if (!referenceLookups[key]?.has(value)) {
          const label = fields.find((f) => f.key === key)?.label ?? key;
          errors.push(`"${label}" value "${value}" was not found`);
        }
      }
    }

    const validationStatus = errors.length ? "invalid" : "valid";
    if (validationStatus === "valid") validCount += 1; else invalidCount += 1;

    bulkOps.push({
      updateOne: {
        filter: { _id: record._id },
        update: { $set: { validationStatus, validationErrors: errors } },
      },
    });

    if (bulkOps.length >= CHUNK_SIZE) {
      await jobStore.bulkWriteStaged(conn, bulkOps);
      bulkOps = [];
    }
  }
  if (bulkOps.length) await jobStore.bulkWriteStaged(conn, bulkOps);

  const updatedJob = await jobStore.updateJob(
    tenantId, job._id,
    { status: "validated", "counts.validRows": validCount, "counts.invalidRows": invalidCount },
    conn
  );

  logger.info(`[${SERVICE}] validated import job`, { tenantId, importJobId: String(job._id), validCount, invalidCount });
  return { job: updatedJob, validCount, invalidCount };
};

// ── getSampleErrors ────────────────────────────────────────────────────────────
// A handful of representative invalid rows for the API's validate-summary
// response, so the caller doesn't have to page through everything just to
// show "here's what's wrong" immediately after validation runs.

export const getSampleErrors = async (tenantId, importJobId, limit = 10, conn = mongoose) => {
  return jobStore.findSampleErrors(tenantId, importJobId, limit, conn);
};

// ── patchStagedRecordFields ───────────────────────────────────────────────────
// The "review and fix" screen's single-row edit: override one or more
// mappedFields values (whitelisted against the target's known field keys,
// same rule as applyMapping) and/or exclude the row from commit entirely.
// Excluding reuses validationStatus:"invalid" rather than a new field —
// commitBatch already filters on validationStatus:"valid", so this is
// sufficient and doesn't need a schema change.
//
// Deliberately only re-checks required-field presence for the edited row,
// not the batch-level dedup/FK checks validateImportJob runs — those need
// the whole-file context this single-row edit doesn't have. Re-run
// validateImportJob if you need those re-verified after a bunch of edits.

export const patchStagedRecordFields = async (
  tenantId, importJobId, rowId, { mappedFields: overrides, exclude = false } = {}, conn = mongoose
) => {
  const job = await jobStore.getJob(tenantId, importJobId, conn);
  const descriptor = getTargetDescriptor(job.module, job.entityKey);
  const fieldsByKey = new Map(descriptor.fields.map((f) => [f.key, f]));

  const record = await jobStore.findOneStaged({ _id: rowId, tenantId, importJobId: job._id }, conn);
  if (!record) {
    throw Object.assign(new Error("Staged row not found"), { statusCode: 404 });
  }

  if (overrides) {
    const invalidKeys = Object.keys(overrides).filter((k) => !fieldsByKey.has(k));
    if (invalidKeys.length) {
      throw Object.assign(
        new Error(`Unknown target field key(s): ${invalidKeys.join(", ")}`),
        { statusCode: 400 }
      );
    }
    for (const [key, rawValue] of Object.entries(overrides)) {
      const field = fieldsByKey.get(key);
      record.mappedFields[key] = coerceFieldValue(field.type, rawValue, field.label);
    }
    record.markModified("mappedFields");
  }

  if (exclude) {
    record.validationStatus = "invalid";
    record.validationErrors = ["Excluded by reviewer"];
  } else {
    const errors = [];
    for (const field of descriptor.fields.filter((f) => f.required)) {
      if (record.mappedFields[field.key] == null || record.mappedFields[field.key] === "") {
        errors.push(`"${field.label}" is required`);
      }
    }
    // Same enum check as the bulk path — a reviewer hand-editing a cell must not
    // be able to smuggle in a value the model will reject at commit.
    for (const field of descriptor.fields.filter((f) => Array.isArray(f.enum) && f.enum.length)) {
      const value = record.mappedFields[field.key];
      if (value == null || value === "") continue;
      if (!field.enum.includes(value)) {
        errors.push(`"${field.label}" value "${value}" is not one of: ${field.enum.join(", ")}`);
      }
    }
    record.validationStatus = errors.length ? "invalid" : "valid";
    record.validationErrors = errors;
  }

  await record.save();
  return record;
};
