// services/shared/importCommit.service.js
// Migration Wizard — full build (Party Model Standardization "Phase 6").
// Commits every valid, pending-commit staged row to a real business model
// through the target registry's commitRow — each row independently (per the
// "commit valid rows, report errors on the rest" scope decision), never one
// all-or-nothing transaction across the whole import.
//
// commitBatch is the SHARED engine: both the sync path below (small imports,
// committed inline in the request) and the async worker
// (workers/platform/migrationCommit.worker.js, chunked BullMQ) call this
// exact same function — only how many rows are pulled per call differs.
import mongoose from "mongoose";
import { getTargetDescriptor } from "../../registry/registerTarget.js";
import { enqueueMigrationCommit } from "../../queueing/adapters/bullmqAdapter.js";
import { consoleEventBus, EVENT_TYPES } from "../../utils/eventBus.js";
import { createMongooseJobStore } from "../../orchestration/jobStore.js";
import { isDuplicateKeyError, connectionSupportsTransactions } from "./idempotency.js";
import logger from "../../utils/logger.js";

const jobStore = createMongooseJobStore();

const SERVICE = "importCommit.service";

// ── emitImportCompletedEvent ────────────────────────────────────────────────
export const emitImportCompletedEvent = async (tenantId, job, { status, committed, failed, skipped }, _conn) => {
  try {
    await consoleEventBus.emit(
      EVENT_TYPES.MIGRATION_IMPORT_COMPLETED,
      {
        importJobId: String(job._id),
        module:      job.module,
        entityKey:   job.entityKey,
        status,
        counts: {
          committedRows:    committed,
          commitFailedRows: failed,
          skippedRows:      skipped,
          validRows:        job.counts?.validRows ?? null,
        },
        tenantId,
      }
    );
  } catch (err) {
    logger.error(`[${SERVICE}] failed to enqueue MIGRATION_IMPORT_COMPLETED`, {
      tenantId, importJobId: String(job._id), error: err.message,
    });
  }
};

const MIGRATION_SYNC_COMMIT_THRESHOLD =
  Number(process.env.MIGRATION_SYNC_COMMIT_THRESHOLD) || 200;

// ── commitBatch ───────────────────────────────────────────────────────────────
// Row-level cursor + updateOne patterns go through the jobStore interface,
// not direct Mongoose model getters — no #-alias imports, no OfferBerries
// domain coupling. The jobStore is Mongoose-backed by default but swappable.
export const commitBatch = async (
  tenantId, importJobId, descriptor,
  { conn = mongoose, actorId = null, limit = null } = {}
) => {
  const useTransaction = Boolean(descriptor.commitInTransaction) && connectionSupportsTransactions(conn);
  if (descriptor.commitInTransaction && !useTransaction) {
    logger.warn(
      `[${SERVICE}] commitInTransaction descriptor "${descriptor.entityKey}" on a non-transactional ` +
      `connection — crash-retry idempotency is NOT guaranteed for this import. Use a replica set.`,
      { tenantId, importJobId: String(importJobId) }
    );
  }

  // Warm the jobStore cache by fetching the job once (ensures models are
  // loaded into conn.__stagedRecordModel before cursorStaged is called).
  await jobStore.getJob(tenantId, importJobId, conn);

  let committed = 0;
  let failed = 0;

  const filter = {
    tenantId, importJobId,
    validationStatus: "valid",
    commitStatus: { $in: ["pending", "committing"] },
  };
  const cursor = jobStore.cursorStaged(conn, filter, { sort: { rowIndex: 1 }, limit });

  for await (const record of cursor) {
    if (useTransaction) {
      const session = await conn.startSession();
      try {
        await session.withTransaction(async () => {
          const { entityId, entityModel } =
            await descriptor.commitRow(tenantId, record.mappedFields, { conn, actorId, session });
          await jobStore.updateOneStaged(
            { _id: record._id },
            { $set: { commitStatus: "committed", committedEntityId: entityId, committedEntityModel: entityModel, commitError: null } },
            conn,
            { session }
          );
        });
        committed += 1;
      } catch (err) {
        await jobStore.updateOneStaged(
          { _id: record._id },
          { $set: { commitStatus: "failed", commitError: err.message } },
          conn
        );
        failed += 1;
        logger.warn(`[${SERVICE}] row commit failed (txn)`, {
          tenantId, importJobId: String(importJobId), rowId: String(record._id), error: err.message,
        });
      } finally {
        await session.endSession();
      }
      continue;
    }

    const wasReserved = record.commitStatus === "committing";
    await jobStore.updateOneStaged(
      { _id: record._id },
      { $set: { commitStatus: "committing" } },
      conn
    );

    try {
      const { entityId, entityModel } =
        await descriptor.commitRow(tenantId, record.mappedFields, { conn, actorId });
      await jobStore.updateOneStaged(
        { _id: record._id },
        { $set: { commitStatus: "committed", committedEntityId: entityId, committedEntityModel: entityModel, commitError: null } },
        conn
      );
      committed += 1;
    } catch (err) {
      if (isDuplicateKeyError(err) && wasReserved) {
        await jobStore.updateOneStaged(
          { _id: record._id },
          { $set: { commitStatus: "committed", commitError: null } },
          conn
        );
        committed += 1;
        logger.info(`[${SERVICE}] row already committed on a prior run — idempotent`, {
          tenantId, importJobId: String(importJobId), rowId: String(record._id),
        });
      } else {
        await jobStore.updateOneStaged(
          { _id: record._id },
          { $set: { commitStatus: "failed", commitError: err.message } },
          conn
        );
        failed += 1;
        logger.warn(`[${SERVICE}] row commit failed`, {
          tenantId, importJobId: String(importJobId), rowId: String(record._id), error: err.message,
        });
      }
    }
  }

  return { committed, failed, processed: committed + failed };
};

// ── commitImportJob ───────────────────────────────────────────────────────────
export const commitImportJob = async (tenantId, importJobId, { actorId = null } = {}, conn = mongoose) => {
  const job = await jobStore.getJob(tenantId, importJobId, conn);
  if (job.status !== "validated") {
    throw Object.assign(
      new Error(`Cannot commit an import job in status "${job.status}" — expected "validated"`),
      { statusCode: 409 }
    );
  }

  const descriptor = getTargetDescriptor(job.module, job.entityKey);
  const validCount = job.counts?.validRows ?? 0;
  const mode = validCount > MIGRATION_SYNC_COMMIT_THRESHOLD ? "async" : "sync";

  await jobStore.updateJobModel(conn,
    { _id: job._id, tenantId },
    { status: "committing", "commit.mode": mode, "commit.startedAt": new Date() }
  );

  if (mode === "async") {
    await enqueueMigrationCommit(tenantId, String(job._id));
    logger.info(`[${SERVICE}] enqueued async commit`, { tenantId, importJobId: String(job._id), validCount });
    return { mode, status: "committing" };
  }

  const { committed, failed } = await commitBatch(tenantId, job._id, descriptor, { conn, actorId, limit: null });
  const skipped = Math.max(validCount - committed - failed, 0);
  const finalStatus = (failed > 0 || skipped > 0) ? "completed_with_errors" : "completed";

  await jobStore.updateJobModel(conn,
    { _id: job._id, tenantId },
    { status: finalStatus, "commit.completedAt": new Date(), "counts.committedRows": committed, "counts.commitFailedRows": failed, "counts.skippedRows": skipped }
  );

  await emitImportCompletedEvent(tenantId, job, { status: finalStatus, committed, failed, skipped }, conn);

  logger.info(`[${SERVICE}] sync commit finished`, { tenantId, importJobId: String(job._id), committed, failed, finalStatus });
  return { mode, status: finalStatus, committed, failed };
};
