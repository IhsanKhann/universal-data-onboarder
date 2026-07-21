// workers/migration/importPipeline.js
// Cloud Run migration entrypoint's pipeline: GCS download → bounded parse →
// guardrail → stage → auto-map → validate → commit.
//
// This file owns ALL pipeline orchestration logic. The entrypoint
// (cloudRunEntrypoint.js) is a thin composition root that reads env vars,
// constructs adapters, and calls the exported functions here — no business
// logic lives there.
//
// ── Adapter injection ─────────────────────────────────────────────────────
// The pipeline functions accept an `adapters` options bag:
//   { jobStore, storage, connectionResolver }
// so the calling entrypoint decides which implementations to wire.
// Defaults are applied where callers omit them, but explicit injection is
// preferred in production.
import fs from "fs";
import { Storage } from "@google-cloud/storage";
import { getImportStagedRecordModel } from "../orchestration/adapters/mongoose/schemas/ImportStagedRecord.model.js";
import { getImportJobModel } from "../orchestration/adapters/mongoose/schemas/ImportJob.model.js";
import { getMigrationSessionModel } from "../orchestration/adapters/mongoose/schemas/MigrationSession.model.js";
import { getTargetDescriptor } from "../registry/registerTarget.js";
import { checkGuardrailStreaming } from "../core/guardrail/streamingGuardrail.js";
import { parseStreaming, detectSourceFormat } from "../core/parsing/streamingParser.js";
import { applyMapping, suggestMappingForJob } from "../core/mapping/applyMapping.js";
import { validateImportJob } from "../core/validation/validateRows.js";
import { commitBatch, emitImportCompletedEvent } from "../core/commit/commitBatch.js";
import {
  populateSessionExternalIds,
  computeSessionOrder,
  listTargetEntities,
} from "../orchestration/sessionManager.js";
import { createMongooseJobStore } from "../orchestration/jobStore.js";
import { singleConnectionResolver } from "../topology/ConnectionResolver.js";
import logger from "../utils/logger.js";

const SERVICE = "importPipeline";

// ── Re-exports ──────────────────────────────────────────────────────────────
// So the entrypoint and any test suites keep importing from this file.
export { parseStreaming, detectSourceFormat, checkGuardrailStreaming };

// ── Helpers ──────────────────────────────────────────────────────────────────
const STAGE_CHUNK_SIZE = 1_000;

let _storageClient = null;

export function getGcsStorageClient() {
  if (!_storageClient) {
    _storageClient = new Storage();
  }
  return _storageClient;
}

export async function downloadFromGcs(bucketName, objectPath, destPath) {
  const storage = getGcsStorageClient();
  const bucket = storage.bucket(bucketName);
  const gcsFile = bucket.file(objectPath);

  if (!destPath) {
    const basename = objectPath.split("/").pop() || `import-${Date.now()}`;
    destPath = `/tmp/${basename}`;
  }

  logger.info(`[${SERVICE}] downloading gs://${bucketName}/${objectPath} → ${destPath}`);
  await gcsFile.download({ destination: destPath });

  const stat = fs.statSync(destPath);
  logger.info(`[${SERVICE}] download complete`, { sizeBytes: stat.size, destPath });
  return destPath;
}

export async function clearStagedRows(importJobId, conn) {
  const ImportStagedRecord = getImportStagedRecordModel(conn);
  const { deletedCount } = await ImportStagedRecord.deleteMany({ importJobId });
  if (deletedCount > 0) {
    logger.info(`[${SERVICE}] cleared stale staged rows`, {
      importJobId: String(importJobId), deletedCount,
    });
  }
  return deletedCount ?? 0;
}

export async function stageRows(tenantId, importJobId, records, conn) {
  if (!records || records.length === 0) return 0;
  const ImportStagedRecord = getImportStagedRecordModel(conn);
  let inserted = 0;

  for (let offset = 0; offset < records.length; offset += STAGE_CHUNK_SIZE) {
    const chunk = records.slice(offset, offset + STAGE_CHUNK_SIZE);
    const docs = chunk.map((row, indexInChunk) => ({
      tenantId, importJobId,
      rowIndex: offset + indexInChunk,
      rawRow: row, customFields: { ...row },
    }));
    await ImportStagedRecord.insertMany(docs, { ordered: false });
    inserted += docs.length;
  }
  return inserted;
}

/**
 * Update an ImportJob field and log the change. Returns the updated doc.
 * Uses the jobStore adapter when available; falls back to direct model getter
 * for backward compat with existing callers that pass ImportJob directly.
 */
async function updateJobStatus(jobId, updates, { conn, ImportJob } = {}) {
  if (ImportJob) {
    const job = await ImportJob.findByIdAndUpdate(jobId, { $set: updates }, { new: true });
    logger.info(`[${SERVICE}] job status update`, { jobId: String(jobId), updates });
    return job;
  }
  // Fallback: use the Mongoose job store adapter
  const jobStore = createMongooseJobStore();
  return jobStore.updateJobModel(conn, { _id: jobId }, updates);
}

/**
 * Resolve a tenant DB connection using the configured connection resolver.
 * Exported so entrypoint and test code can share the same resolution path.
 */
export async function resolveTenantConnection(tenantId, connectionResolver) {
  const resolver = connectionResolver || singleConnectionResolver;
  return resolver.resolve(tenantId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline step functions
// ═══════════════════════════════════════════════════════════════════════════

export async function stepParseAndStage(job, conn, bucketName, objectPath, adapters = {}) {
  if (!["uploaded", "guardrail_rejected"].includes(job.status)) {
    logger.info(`[${SERVICE}] stepParseAndStage: skipping (status=${job.status})`);
    return job;
  }

  const localPath = await downloadFromGcs(bucketName, objectPath);
  const ImportJob = getImportJobModel(conn);

  let guardrail;
  try {
    const sourceFormat = detectSourceFormat(localPath);
    logger.info(`[${SERVICE}] detected format`, { sourceFormat, originalName: job.file?.originalName });

    guardrail = await checkGuardrailStreaming(job.tenantId, localPath, sourceFormat, { sqlTable: job.sqlTable });

    if (!guardrail.allowed) {
      logger.info(`[${SERVICE}] guardrail rejected`, { reason: guardrail.reason, limit: guardrail.limit });
      return updateJobStatus(job._id, {
        sourceFormat,
        status: "guardrail_rejected",
        "guardrail.passed": false,
        "guardrail.reason": guardrail.reason,
        "guardrail.limit": guardrail.limit,
        "guardrail.checkedAt": new Date(),
        "guardrail.upgrade": guardrail.details?.upgrade ?? null,
      }, { conn, ImportJob });
    }

    const rowCount = guardrail.records?.length ?? 0;
    logger.info(`[${SERVICE}] guardrail passed`, { rowCount });

    await updateJobStatus(job._id, {
      sourceFormat,
      status: "uploaded",
      "counts.totalRows": rowCount,
      "guardrail.passed": true,
      "guardrail.limit": guardrail.limit,
      "guardrail.checkedAt": new Date(),
    }, { conn, ImportJob });
  } finally {
    try { fs.unlinkSync(localPath); } catch (err) {
      logger.warn(`[${SERVICE}] could not remove temp file`, { localPath, error: err.message });
    }
  }

  const records = guardrail.records ?? [];
  await clearStagedRows(job._id, conn);
  const stagedRows = await stageRows(job.tenantId, job._id, records, conn);

  const finalJob = await updateJobStatus(job._id, {
    status: "staged",
    "counts.stagedRows": stagedRows,
  }, { conn, ImportJob });

  logger.info(`[${SERVICE}] stage complete`, { importJobId: String(job._id), stagedRows });
  return finalJob;
}

export async function stepAutoMap(job, conn, adapters = {}) {
  if (job.status !== "staged") {
    logger.info(`[${SERVICE}] stepAutoMap: skipping (status=${job.status})`);
    return job;
  }

  if (job.fieldMap && job.entityKey) {
    const mappedJob = await applyMapping(job.tenantId, job._id, {
      entityKey: job.entityKey,
      fieldMap: job.fieldMap,
      saveAsProfile: false,
    }, conn);
    logger.info(`[${SERVICE}] applied pre-set fieldMap`, {
      entityKey: job.entityKey,
      fieldCount: Object.keys(job.fieldMap).length,
    });
    return mappedJob;
  }

  if (!job.module) {
    logger.info(`[${SERVICE}] stepAutoMap: no module set — skipping auto-mapping`);
    return job;
  }

  try {
    const entities = listTargetEntities(job.module);
    if (entities.length === 0) {
      logger.info(`[${SERVICE}] stepAutoMap: no target entities for module "${job.module}"`);
      return job;
    }

    for (const entity of entities) {
      const suggestion = await suggestMappingForJob(
        job.tenantId, job._id, job.module, entity.entityKey, conn
      );
      if (suggestion.suggestedFieldMap && Object.keys(suggestion.suggestedFieldMap).length > 0) {
        const mappedJob = await applyMapping(job.tenantId, job._id, {
          entityKey: entity.entityKey,
          fieldMap: suggestion.suggestedFieldMap,
          saveAsProfile: false,
        }, conn);
        logger.info(`[${SERVICE}] auto-mapped to ${entity.entityKey}`, {
          mappedFields: Object.keys(suggestion.suggestedFieldMap).length,
        });
        return mappedJob;
      }
    }
    logger.info(`[${SERVICE}] stepAutoMap: no matching entity found`);
  } catch (err) {
    logger.warn(`[${SERVICE}] auto-mapping attempted but failed`, { error: err.message });
  }
  return job;
}

export async function stepValidate(job, conn, adapters = {}) {
  if (job.status !== "mapped") {
    logger.info(`[${SERVICE}] stepValidate: skipping (status=${job.status})`);
    return job;
  }

  logger.info(`[${SERVICE}] validating...`, { importJobId: String(job._id) });
  const jobStore = adapters.jobStore || createMongooseJobStore();

  try {
    const { validCount, invalidCount } = await validateImportJob(job.tenantId, job._id, conn);
    logger.info(`[${SERVICE}] validation complete`, { validCount, invalidCount });
  } catch (err) {
    logger.warn(`[${SERVICE}] validation failed`, { error: err.message });
    await jobStore.updateJob(job.tenantId, job._id, { status: "failed", error: err.message }, conn);
  }

  const refreshed = await jobStore.getJob(job.tenantId, job._id, conn).catch(() => null);
  return refreshed ?? job;
}

export async function stepCommit(job, conn, adapters = {}) {
  if (job.status !== "validated") {
    logger.info(`[${SERVICE}] stepCommit: skipping (status=${job.status})`);
    return job;
  }

  const jobStore = adapters.jobStore || createMongooseJobStore();

  if (!job.module || !job.entityKey) {
    logger.error(`[${SERVICE}] stepCommit: module or entityKey missing`, {
      importJobId: String(job._id), module: job.module, entityKey: job.entityKey,
    });
    await jobStore.updateJob(job.tenantId, job._id, {
      status: "failed",
      error: "Import job reached commit with no module/entityKey",
    }, conn);
    return jobStore.getJob(job.tenantId, job._id, conn);
  }

  const descriptor = getTargetDescriptor(job.module, job.entityKey);
  logger.info(`[${SERVICE}] committing...`, {
    importJobId: String(job._id), module: job.module, entityKey: job.entityKey,
  });

  await jobStore.updateJob(job.tenantId, job._id, {
    status: "committing",
    "commit.startedAt": new Date(),
    "commit.mode": "async",
  }, conn);

  const { committed, failed } = await commitBatch(
    job.tenantId, job._id, descriptor,
    { conn, actorId: null, limit: null }
  );

  const validCount = job.counts?.validRows ?? 0;
  const skipped = Math.max(validCount - committed - failed, 0);
  const finalStatus = (failed > 0 || skipped > 0) ? "completed_with_errors" : "completed";

  await jobStore.updateJob(job.tenantId, job._id, {
    status: finalStatus,
    "commit.completedAt": new Date(),
    "counts.committedRows": committed,
    "counts.commitFailedRows": failed,
    "counts.skippedRows": skipped,
  }, conn);

  logger.info(`[${SERVICE}] commit complete`, {
    importJobId: String(job._id), committed, failed, skipped, finalStatus,
  });

  return jobStore.getJob(job.tenantId, job._id, conn);
}

/**
 * Run the full pipeline for a single import job.
 * Accepts an optional `adapters` bag for adapter injection.
 */
export async function runJobPipeline(job, conn, bucketName, objectPath, adapters = {}) {
  let current = job;
  const jobBucket = bucketName || job.gcs?.bucketName;
  const jobObject = objectPath || job.gcs?.objectPath;

  if (jobBucket && jobObject) {
    current = await stepParseAndStage(current, conn, jobBucket, jobObject, adapters);
  }
  current = await stepAutoMap(current, conn, adapters);
  current = await stepValidate(current, conn, adapters);
  current = await stepCommit(current, conn, adapters);
  return current;
}

/**
 * Update a session's per-job status entry.
 * Exported for use by the entrypoint when running session pipelines.
 */
export async function advanceSessionJobStatus(sessionId, importJobId, status, error = null, conn) {
  const MigrationSession = getMigrationSessionModel(conn);
  const session = await MigrationSession.findById(sessionId);
  if (!session) return;

  const entry = session.jobStatuses.find(
    (js) => js.importJobId.toString() === importJobId.toString()
  );
  if (entry) {
    entry.status = status;
    if (error) entry.error = error;
  }

  const completed = session.jobStatuses.filter((js) =>
    ["completed", "completed_with_errors"].includes(js.status)
  ).length;
  const failed = session.jobStatuses.filter((js) =>
    ["failed", "skipped"].includes(js.status)
  ).length;

  session.counts.completed = completed;
  session.counts.failed = failed;

  const total = session.jobStatuses.length;
  const processed = completed + failed;
  if (processed === total) {
    session.status = failed > 0 ? "completed_with_errors" : "completed";
  } else if (status === "failed") {
    session.status = "completed_with_errors";
  } else {
    session.status = "processing";
  }
  await session.save();
}

/**
 * Run a multi-job migration session.
 * Loads all jobs in the session's execution order and runs each through
 * the full pipeline. Exported for use by the entrypoint.
 */
export async function runSessionPipeline(tenantId, sessionId, conn, adapters = {}) {
  const MigrationSession = getMigrationSessionModel(conn);
  const ImportJob = getImportJobModel(conn);
  const jobStore = adapters.jobStore || createMongooseJobStore();

  const session = await MigrationSession.findById(sessionId);
  if (!session) throw new Error(`MigrationSession ${sessionId} not found`);
  if (session.status !== "pending") {
    logger.info(`[${SERVICE}] session skipping: already ${session.status}`, { sessionId });
    return { status: session.status, statuses: session.jobStatuses };
  }

  session.status = "processing";
  await session.save();

  await computeSessionOrder(tenantId, sessionId, conn);
  const freshSession = await MigrationSession.findById(sessionId);
  if (!freshSession) throw new Error(`MigrationSession ${sessionId} disappeared`);

  const orderedJobIds = freshSession.executionOrder;
  logger.info(`[${SERVICE}] session has ${orderedJobIds.length} jobs`, { sessionId });

  const bucketName = process.env.GCS_BUCKET_NAME || null;
  const statuses = [];

  for (const jobId of orderedJobIds) {
    const job = await ImportJob.findById(jobId);
    if (!job) {
      logger.error(`[${SERVICE}] session job ${jobId} not found — skipping`, { sessionId });
      await advanceSessionJobStatus(sessionId, jobId, "skipped", "ImportJob not found", conn);
      statuses.push({ importJobId: String(jobId), status: "skipped" });
      continue;
    }

    logger.info(`[${SERVICE}] session processing job`, {
      sessionId, jobId: String(jobId), entityKey: job.entityKey, status: job.status,
    });

    try {
      await advanceSessionJobStatus(sessionId, jobId, "processing", null, conn);
      const objectPath = job.gcs?.objectPath || process.env.GCS_OBJECT_PATH;
      const result = await runJobPipeline(job, conn, bucketName, objectPath, adapters);
      const jobFinal = result?.status || "failed";
      await advanceSessionJobStatus(sessionId, jobId, jobFinal, null, conn);
      statuses.push({ importJobId: String(jobId), status: jobFinal });

      if (["completed", "completed_with_errors"].includes(jobFinal)) {
        await populateSessionExternalIds(tenantId, sessionId, conn).catch((err) => {
          logger.warn(`[${SERVICE}] could not populate externalIds`, {
            sessionId, jobId: String(jobId), error: err.message,
          });
        });
      }
    } catch (err) {
      logger.error(`[${SERVICE}] session job failed`, {
        sessionId, jobId: String(jobId), error: err.message,
      });
      await advanceSessionJobStatus(sessionId, jobId, "failed", err.message, conn);
      statuses.push({ importJobId: String(jobId), status: "failed" });
    }
  }

  const finalSession = await MigrationSession.findById(sessionId);
  const finalStatus = finalSession?.status || "failed";
  logger.info(`[${SERVICE}] session pipeline complete`, { sessionId, status: finalStatus });
  return { status: finalStatus, statuses };
}
