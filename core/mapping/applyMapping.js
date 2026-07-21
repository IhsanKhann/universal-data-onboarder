// services/shared/importMapping.service.js
// Migration Wizard — full build (Party Model Standardization "Phase 6").
// Column-name -> target-field-key resolution: suggest a mapping, apply it
// (rewriting every ImportStagedRecord's mappedFields/customFields split),
// and persist it as a reusable ImportMappingProfile.
import mongoose from "mongoose";
import { getTargetDescriptor } from "../../registry/registerTarget.js";
import { coerceFieldValue } from "../../registry/importTargetRegistry.service.js";
import { createMongooseJobStore } from "../../orchestration/jobStore.js";
import logger from "../../utils/logger.js";

const jobStore = createMongooseJobStore();

const SERVICE = "importMapping.service";

// ── normalize / levenshtein (pure, dependency-free — Phase 6 plan explicitly
// rules out adding a fuzzy-match library; this is small enough to own) ──────
const normalize = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

// ── getTargetSchema ───────────────────────────────────────────────────────────
// Thin wrapper the frontend's mapping screen calls to render field
// descriptors — throws the registry's own clear 400 for an unknown
// module/entity, nothing to add here.

export const getTargetSchema = (moduleName, entityKey) => {
  const descriptor = getTargetDescriptor(moduleName, entityKey);
  return {
    module: descriptor.module,
    entityKey: descriptor.entityKey,
    label: descriptor.label,
    fields: descriptor.fields,
    identityField: descriptor.identityField,
  };
};

// ── suggestMapping ────────────────────────────────────────────────────────────
// Pure. Three tiers, cheapest/most-confident first, each target field key
// claimed at most once (two source columns never both auto-map to the same
// target): (1) exact normalized match against the field's key/label/aliases,
// (2) normalized substring containment, (3) small edit-distance tolerance.
// Anything left unmatched comes back with targetFieldKey: null — the human
// maps it manually or leaves it as a custom field.

export const suggestMapping = (sourceColumns, targetFields) => {
  const candidates = targetFields.map((f) => ({
    key: f.key,
    normalizedForms: [f.key, f.label, ...(f.aliases ?? [])].map(normalize).filter(Boolean),
  }));
  const usedKeys = new Set();

  const claim = (key) => usedKeys.add(key);

  return sourceColumns.map((sourceColumn) => {
    const normSource = normalize(sourceColumn);
    if (!normSource) return { sourceColumn, targetFieldKey: null, confidence: null };

    for (const c of candidates) {
      if (usedKeys.has(c.key)) continue;
      if (c.normalizedForms.includes(normSource)) {
        claim(c.key);
        return { sourceColumn, targetFieldKey: c.key, confidence: "exact" };
      }
    }

    for (const c of candidates) {
      if (usedKeys.has(c.key)) continue;
      if (c.normalizedForms.some((f) => f.length > 2 && (normSource.includes(f) || f.includes(normSource)))) {
        claim(c.key);
        return { sourceColumn, targetFieldKey: c.key, confidence: "fuzzy" };
      }
    }

    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (usedKeys.has(c.key)) continue;
      for (const f of c.normalizedForms) {
        const dist = levenshtein(normSource, f);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
    }
    if (best && normSource.length > 3 && bestDist <= 2) {
      claim(best.key);
      return { sourceColumn, targetFieldKey: best.key, confidence: "fuzzy" };
    }

    return { sourceColumn, targetFieldKey: null, confidence: null };
  });
};

// ── suggestMappingForJob ──────────────────────────────────────────────────────
// Fetches one sample staged row to get the real source column names, then
// runs suggestMapping against the chosen target's field descriptors.

export const suggestMappingForJob = async (tenantId, importJobId, moduleName, entityKey, conn = mongoose) => {
  const job = await jobStore.getJob(tenantId, importJobId, conn);
  const sample = await jobStore.findOneStaged({ tenantId, importJobId: job._id }, conn);
  if (!sample) return { sourceColumns: [], suggestions: [] };

  const sourceColumns = Object.keys(sample.rawRow ?? {});
  const { fields } = getTargetSchema(moduleName, entityKey);
  return { sourceColumns, suggestions: suggestMapping(sourceColumns, fields) };
};

// ── applyMapping ──────────────────────────────────────────────────────────────
// Validates fieldMap against the target's known field keys (server-side
// whitelist — no arbitrary key can reach mappedFields, and therefore no
// arbitrary key can later reach a commitRow payload), then walks every
// ImportStagedRecord for this job via a cursor + chunked bulkWrite (not one
// giant array in memory, not N individual .save() calls) rewriting
// mappedFields/customFields.
//
// A single row's coercion failure (e.g. "not-a-number" in a numeric column)
// does NOT abort the whole job — that field is simply left out of
// mappedFields for that row, and importValidation.service.js's required-field
// check catches it with a clear per-row message. Mapping is a reshaping
// step; correctness checking is validation's job, not this one's.

export const applyMapping = async (
  tenantId, importJobId,
  { entityKey, fieldMap, saveAsProfile = false, profileLabel = null, createdBy = null },
  conn = mongoose
) => {
  const job = await jobStore.getJob(tenantId, importJobId, conn);
  if (!["staged", "mapped"].includes(job.status)) {
    const err = new Error(`Cannot map an import job in status "${job.status}" — expected "staged" or "mapped"`);
    err.statusCode = 409;
    throw err;
  }

  const moduleName = job.module;
  const { fields } = getTargetSchema(moduleName, entityKey);
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));

  const entries = Object.entries(fieldMap ?? {});
  const invalidTargets = entries.filter(([, targetKey]) => !fieldsByKey.has(targetKey)).map(([, t]) => t);
  if (invalidTargets.length) {
    const err = new Error(`Unknown target field key(s) for ${moduleName}.${entityKey}: ${[...new Set(invalidTargets)].join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  const targetKeysUsed = entries.map(([, t]) => t);
  const duplicateTargets = targetKeysUsed.filter((t, i) => targetKeysUsed.indexOf(t) !== i);
  if (duplicateTargets.length) {
    const err = new Error(`Two source columns cannot map to the same target field: ${[...new Set(duplicateTargets)].join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  // The cursor/bulkWrite pattern requires a pre-warmed connection cache.
  // Cursor must come from the cached model (initialized by getJob call above).
  const cursor = jobStore.cursorStaged(conn, { tenantId, importJobId: job._id });

  let bulkOps = [];
  const CHUNK_SIZE = 500;
  let processed = 0;

  for await (const record of cursor) {
    const mappedFields = {};
    const remainingCustomFields = { ...(record.rawRow ?? {}) };

    for (const [sourceColumn, targetKey] of entries) {
      if (!(sourceColumn in remainingCustomFields)) continue;
      const descriptor = fieldsByKey.get(targetKey);
      try {
        const coerced = coerceFieldValue(descriptor.type, remainingCustomFields[sourceColumn], descriptor.label);
        if (coerced != null) mappedFields[targetKey] = coerced;
      } catch (err) {
        logger.debug(`[${SERVICE}] coercion skipped for row ${record._id}: ${err.message}`);
      }
      delete remainingCustomFields[sourceColumn];
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: record._id },
        update: { $set: { mappedFields, customFields: remainingCustomFields } },
      },
    });
    processed += 1;

    if (bulkOps.length >= CHUNK_SIZE) {
      await jobStore.bulkWriteStaged(conn, bulkOps);
      bulkOps = [];
    }
  }
  if (bulkOps.length) await jobStore.bulkWriteStaged(conn, bulkOps);

  let mappingProfileId = job.mappingProfileId ?? null;
  if (saveAsProfile) {
    if (!profileLabel || typeof profileLabel !== "string" || profileLabel.trim() === "") {
      const err = new Error("profileLabel is required when saveAsProfile is true");
      err.statusCode = 400;
      throw err;
    }
    const profile = await jobStore.upsertMappingProfile(tenantId, moduleName, entityKey, fieldMap, profileLabel, createdBy, conn);
    mappingProfileId = profile._id;
  }

  job.entityKey = entityKey;
  job.fieldMap = fieldMap;
  job.mappingProfileId = mappingProfileId;
  job.status = "mapped";
  await jobStore.saveJob(job);

  logger.info(`[${SERVICE}] applied mapping`, { tenantId, importJobId: String(job._id), entityKey, rowsProcessed: processed });
  return job;
};

// ── listMappingProfiles ───────────────────────────────────────────────────────

export const listMappingProfiles = async (tenantId, { module: moduleName, entityKey } = {}, conn = mongoose) => {
  return jobStore.listMappingProfiles(tenantId, { module: moduleName, entityKey }, conn);
};
