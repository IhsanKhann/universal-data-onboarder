// services/shared/migrationSession.service.js
// Migration Wizard — Stage E1 (MIGRATION_WIZARD_TIERED_EXTENSION_MASTER_PLAN
// 2026-07-16.md §3). Manages migration sessions: groups of import jobs that
// are executed together with dependency-graph ordering and cross-job reference
// resolution via external IDs.
//
// A session is how a tenant imports their full org chart in one pass: upload
// OrgUnits + Roles + Branches + Employees together, and the system figures out
// the right order and resolves parent references across jobs.

import mongoose from "mongoose";
import { getMigrationSessionModel } from "./adapters/mongoose/schemas/MigrationSession.model.js";
import { getImportStagedRecordModel } from "./adapters/mongoose/schemas/ImportStagedRecord.model.js";
import { getImportJobModel } from "./adapters/mongoose/schemas/ImportJob.model.js";
import { getTargetDescriptor } from "../registry/registerTarget.js";
import { computeSessionExecutionOrder } from "./dependencyGraph.js";
import { getImportJob } from "./migrationImport.service.js";
import logger from "../utils/logger.js";

const SERVICE = "migrationSession.service";

/**
 * Collect dependency declarations for a set of entity keys.
 * Looks up each entity key's target descriptor across all modules
 * to find its declared dependencies.
 *
 * @param {string[]} entityKeys
 * @returns {Object<string, string[]>} entityKey -> [dependent entityKeys]
 */
function collectDependencies(entityKeys) {
  // Known modules to search for descriptors
  const knownModules = ["hr", "businessops"]; // extends as stages add more
  const depsByEntity = {};

  for (const entityKey of entityKeys) {
    let found = false;
    for (const moduleName of knownModules) {
      try {
        const descriptor = getTargetDescriptor(moduleName, entityKey);
        depsByEntity[entityKey] = descriptor.dependencies ?? [];
        found = true;
        break;
      } catch {
        // descriptor not found in this module, try the next
      }
    }
    if (!found) {
      depsByEntity[entityKey] = [];
    }
  }

  return depsByEntity;
}

/**
 * Resolve references for a descriptor within a session's context.
 *
 * For each reference field, first checks the session's own staged rows
 * (by entityKey + externalId), then falls back to the original DB-based
 * resolveReferences on the descriptor.
 *
 * This is what enables a child job (e.g. employee) to reference a parent
 * (e.g. orgunit) that exists only as staged-but-not-committed rows within
 * the same session.
 *
 * @param {string} tenantId
 * @param {string} sessionId — MigrationSession _id
 * @param {object} descriptor — the target descriptor (with resolveReferences)
 * @param {object} distinctValuesByKey — { fieldKey: [value, ...] }
 * @param {import("mongoose").Connection} conn
 * @returns {Promise<Object<string, Map<string, object>>>}
 */
export async function resolveSessionReferences(
  tenantId, sessionId, descriptor, distinctValuesByKey, conn = mongoose
) {
  const sessionModel = getMigrationSessionModel(conn);
  const session = await sessionModel.findById(sessionId).lean();
  if (!session) {
    // No session context: fall through to the descriptor's own resolution.
    return descriptor.resolveReferences?.(tenantId, distinctValuesByKey, conn) ?? {};
  }

  // Collect all job IDs in this session
  const sessionJobIds = session.jobs.map((j) => j.importJobId);

  if (!sessionJobIds.length) {
    return descriptor.resolveReferences?.(tenantId, distinctValuesByKey, conn) ?? {};
  }

  // For entity keys in the session, try to resolve from staged rows first.
  // Build a map: entityKey -> { externalId -> stagedRecord }
  // Only reference fields that correspond to entity keys in the session matter.
  const referenceFields = descriptor.referenceFields ?? [];

  // Identify which reference fields match session entities. The session's jobs
  // list entity keys; we need to know if any reference fields correspond to
  // entities in this session.
  // Reference fields are field names (e.g. "orgUnitName") but session entities
  // use entityKeys (e.g. "orgunit"). We need a mapping convention.
  // For now, we check by trying each reference field name against the entity
  // keys present in the session, lowercased and matching common patterns.
  const sessionEntityKeys = new Set(session.jobs.map((j) => j.entityKey));

  // Try to match reference fields to session entity keys.
  // Convention: the string after "Name" in a reference field like "orgUnitName"
  // hints at the entity type "orgunit". Session jobs use entity keys like
  // "orgunit", "role", "branch", "employee".
  const matchingFields = referenceFields.filter((fieldKey) => {
    // Remove common suffixes to guess the entity key
    const baseName = fieldKey.replace(/Name$/i, "").toLowerCase();
    // Map common HR reference field bases to entity keys
    const fieldToEntity = {
      orgunit: "orgunit",
      org: "orgunit",
      branch: "branch",
      role: "role",
    };
    return sessionEntityKeys.has(fieldToEntity[baseName] ?? baseName);
  });

  if (!matchingFields.length) {
    // No reference fields match session entities — fall back to standard resolution.
    return descriptor.resolveReferences?.(tenantId, distinctValuesByKey, conn) ?? {};
  }

  // For each matching field, query the session's staged rows by externalId
  // (which equals the identity value for that entity type).
  const ImportStagedRecord = getImportStagedRecordModel(conn);
  const resolved = { ...(await descriptor.resolveReferences?.(tenantId, distinctValuesByKey, conn) ?? {}) };

  for (const fieldKey of matchingFields) {
    const values = distinctValuesByKey[fieldKey] ?? [];
    if (!values.length) continue;

    // Only resolve values that weren't found by the DB resolution
    const existingMap = resolved[fieldKey] ?? new Map();
    const missingValues = values.filter((v) => !existingMap.has(v));
    if (!missingValues.length) continue;

    // Determine the entity key to search for in session rows
    const baseName = fieldKey.replace(/Name$/i, "").toLowerCase();
    const fieldToEntity = {
      orgunit: "orgunit",
      org: "orgunit",
      branch: "branch",
      role: "role",
    };
    const entityKey = fieldToEntity[baseName] ?? baseName;

    // Query session staged rows that match any of the missing values by externalId
    const sessionRows = await ImportStagedRecord.find({
      importJobId: { $in: sessionJobIds },
      entityKey,
      externalId: { $in: missingValues },
      validationStatus: { $in: ["valid", "unvalidated"] },
    }).select("externalId mappedFields").lean();

    // Add resolved session rows to the result map. The row's mappedFields
    // serve as the resolved reference data.
    for (const row of sessionRows) {
      existingMap.set(row.externalId, { _id: null, externalId: row.externalId, _staged: true, ...row.mappedFields });
    }

    resolved[fieldKey] = existingMap;
  }

  return resolved;
}

/**
 * Resolve an entity reference within a session by its external ID.
 * Used by commitRow functions to look up a referenced entity's _id at commit
 * time, either from already-committed data or from session staged rows.
 *
 * Returns { entityId, staged } where staged=true means the entity is in the
 * session's staged rows and hasn't been committed yet.
 *
 * @param {string} tenantId
 * @param {string} sessionId — MigrationSession _id (null for standalone jobs)
 * @param {string} entityKey — the entity type to look up (e.g. "orgunit")
 * @param {string} externalId — the external identity value
 * @param {import("mongoose").Connection} conn
 * @returns {Promise<{entityId: string|null, staged: boolean}|null>}
 */
export async function resolveSessionEntityByExternalId(
  tenantId, sessionId, entityKey, externalId, conn = mongoose
) {
  if (!sessionId || !externalId) return null;

  const sessionModel = getMigrationSessionModel(conn);
  const session = await sessionModel.findById(sessionId).lean();
  if (!session) return null;

  // Check if this entity key is part of the session
  const sessionJobIds = session.jobs
    .filter((j) => j.entityKey === entityKey)
    .map((j) => j.importJobId);

  if (!sessionJobIds.length) return null;

  // Look up the staged row by externalId within the session's jobs
  const ImportStagedRecord = getImportStagedRecordModel(conn);
  const staged = await ImportStagedRecord.findOne({
    importJobId: { $in: sessionJobIds },
    entityKey,
    externalId,
    validationStatus: "valid",
    commitStatus: { $in: ["pending", "committed"] },
  }).lean();

  if (!staged) return null;

  // If the row has already been committed, use its committed entity ID
  if (staged.commitStatus === "committed" && staged.committedEntityId) {
    return { entityId: staged.committedEntityId.toString(), staged: false };
  }

  // The entity is staged but not committed. We can't resolve to a real _id yet.
  // Return null so the caller knows it exists but isn't committed yet.
  // At commit time, the commitRow function should receive the session context
  // so it can handle this case.
  return { entityId: null, staged: true, stagedRowId: staged._id.toString() };
}

/**
 * Create a migration session.
 *
 * @param {string} tenantId
 * @param {string} [label] — optional human-readable label
 * @param {string|null} [createdBy]
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<object>} created session
 */
export async function createSession(tenantId, label = null, createdBy = null, conn = mongoose) {
  const MigrationSession = getMigrationSessionModel(conn);
  const session = await MigrationSession.create({
    tenantId,
    label,
    status: "pending",
    jobs: [],
    executionOrder: [],
    dependencyGraph: {},
    counts: { total: 0, completed: 0, failed: 0, skipped: 0 },
    createdBy,
  });
  return session;
}

/**
 * Add a job to a session.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {string} importJobId
 * @param {string} module
 * @param {string} entityKey
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<object>} updated session
 */
export async function addJobToSession(
  tenantId, sessionId, importJobId, module, entityKey, conn = mongoose
) {
  const MigrationSession = getMigrationSessionModel(conn);
  const ImportJob = getImportJobModel(conn);

  // Verify the job exists and belongs to this tenant
  const job = await ImportJob.findOne({ _id: importJobId, tenantId });
  if (!job) {
    const err = new Error("Import job not found");
    err.statusCode = 404;
    throw err;
  }

  const session = await MigrationSession.findOne({ _id: sessionId, tenantId });
  if (!session) {
    const err = new Error("Session not found");
    err.statusCode = 404;
    throw err;
  }

  if (session.status !== "pending") {
    const err = new Error(
      `Cannot add jobs to a session in status "${session.status}" — expected "pending"`
    );
    err.statusCode = 409;
    throw err;
  }

  // Check for duplicate
  const alreadyAdded = session.jobs.some(
    (j) => j.importJobId.toString() === importJobId
  );
  if (alreadyAdded) {
    return session;
  }

  session.jobs.push({ importJobId, module, entityKey });
  session.counts.total = session.jobs.length;
  await session.save();

  // Also link the job back to the session
  await ImportJob.findOneAndUpdate(
    { _id: importJobId, tenantId },
    { $set: { sessionId } }
  );

  return session;
}

/**
 * Get a session with its job details populated.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<object>}
 */
export async function getSession(tenantId, sessionId, conn = mongoose) {
  const MigrationSession = getMigrationSessionModel(conn);
  const session = await MigrationSession.findOne({ _id: sessionId, tenantId }).lean();
  if (!session) {
    const err = new Error("Session not found");
    err.statusCode = 404;
    throw err;
  }
  return session;
}

/**
 * List sessions for a tenant.
 *
 * @param {string} tenantId
 * @param {object} [query] - { status, page, limit }
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<{items: object[], total: number, page: number, limit: number}>}
 */
export async function listSessions(
  tenantId, { status, page = 1, limit = 20 } = {}, conn = mongoose
) {
  const MigrationSession = getMigrationSessionModel(conn);
  const filter = { tenantId };
  if (status) filter.status = status;

  const numericPage  = Math.max(1, Number(page) || 1);
  const numericLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    MigrationSession.find(filter)
      .sort({ createdAt: -1 })
      .skip((numericPage - 1) * numericLimit)
      .limit(numericLimit)
      .lean(),
    MigrationSession.countDocuments(filter),
  ]);

  return { items, total, page: numericPage, limit: numericLimit };
}

/**
 * Pre-compute the execution order for a session. This must be called before
 * the session is processed by the Cloud Run entrypoint.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<object>} updated session
 */
export async function computeSessionOrder(tenantId, sessionId, conn = mongoose) {
  const MigrationSession = getMigrationSessionModel(conn);
  const session = await MigrationSession.findOne({ _id: sessionId, tenantId });
  if (!session) {
    const err = new Error("Session not found");
    err.statusCode = 404;
    throw err;
  }

  if (session.status !== "pending") {
    const err = new Error(
      `Cannot compute order for a session in status "${session.status}" — expected "pending"`
    );
    err.statusCode = 409;
    throw err;
  }

  if (!session.jobs.length) {
    const err = new Error("Session has no jobs — cannot compute execution order");
    err.statusCode = 400;
    throw err;
  }

  // Collect entity keys present in this session
  const entityKeys = [...new Set(session.jobs.map((j) => j.entityKey))];

  // Collect dependency declarations
  const dependenciesByEntity = collectDependencies(entityKeys);

  // Compute the execution order
  const jobsList = session.jobs.map((j) => ({
    importJobId: j.importJobId,
    entityKey: j.entityKey,
  }));

  const { orderedIds, orderedEntityKeys } = computeSessionExecutionOrder(
    jobsList, dependenciesByEntity
  );

  // Build per-job status entries in the computed order
  const jobStatuses = orderedIds.map((id, index) => ({
    importJobId: id,
    entityKey: orderedEntityKeys[index],
    status: "pending",
    error: null,
  }));

  session.executionOrder = orderedIds;
  session.dependencyGraph = dependenciesByEntity;
  session.jobStatuses = jobStatuses;
  await session.save();

  logger.info(`[${SERVICE}] computed execution order`, {
    tenantId, sessionId, entityKeys, orderedIds,
  });

  return session;
}

/**
 * Populate externalId on every ImportStagedRecord in a session's jobs.
 *
 * After mapping, the staged records have mappedFields populated. This function
 * reads the identityField from each job's target descriptor and copies its
 * value into the staged record's externalId field so session-scoped reference
 * resolution can find it efficiently.
 *
 * Uses a cursor + batch-update approach rather than an aggregation pipeline
 * for maximum MongoDB version compatibility.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {import("mongoose").Connection} [conn]
 * @returns {Promise<number>} staged rows updated
 */
export async function populateSessionExternalIds(tenantId, sessionId, conn = mongoose) {
  const sessionModel = getMigrationSessionModel(conn);
  const ImportStagedRecord = getImportStagedRecordModel(conn);

  const session = await sessionModel.findById(sessionId).lean();
  if (!session) return 0;

  let totalUpdated = 0;
  const CHUNK_SIZE = 500;

  for (const job of session.jobs) {
    const descriptor = getTargetDescriptor(job.module, job.entityKey);
    const identityField = descriptor.identityField;

    // Use a cursor to find rows with null externalId but a populated identity value
    const cursor = ImportStagedRecord.find({
      importJobId: job.importJobId,
      [`mappedFields.${identityField}`]: { $exists: true, $ne: null },
      externalId: null,
    }).cursor();

    let bulkOps = [];
    for await (const record of cursor) {
      const identityValue = record.mappedFields?.[identityField];
      if (identityValue == null) continue;

      bulkOps.push({
        updateOne: {
          filter: { _id: record._id },
          update: {
            $set: {
              externalId: String(identityValue),
              entityKey: job.entityKey,
            },
          },
        },
      });

      if (bulkOps.length >= CHUNK_SIZE) {
        const result = await ImportStagedRecord.bulkWrite(bulkOps, { ordered: false });
        totalUpdated += result.modifiedCount ?? 0;
        bulkOps = [];
      }
    }
    if (bulkOps.length) {
      const result = await ImportStagedRecord.bulkWrite(bulkOps, { ordered: false });
      totalUpdated += result.modifiedCount ?? 0;
    }
  }

  if (totalUpdated > 0) {
    logger.info(`[${SERVICE}] populated externalIds`, {
      tenantId, sessionId, totalUpdated,
    });
  }

  return totalUpdated;
}
