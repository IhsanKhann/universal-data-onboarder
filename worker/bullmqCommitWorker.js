/**
 * BullMQ worker for chunked async commit of large imports.
 *
 * Processes one chunk at a time via commitBatch(limit: CHUNK_SIZE) until
 * all rows are committed. Idempotent by design: commitBatch filters on
 * validationStatus:"valid" + commitStatus:"pending"/"committing", so
 * already-committed rows are never re-processed on worker restart.
 *
 * This is a thin worker bootstrap. No business logic — all commit orchestration
 * lives in core/commit/commitBatch.js. The jobStore adapter is injected as a
 * dependency from the composition root.
 */

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createMongooseJobStore } from "../orchestration/jobStore.js";
import { getTargetDescriptor } from "../registry/registerTarget.js";
import { commitBatch, emitImportCompletedEvent } from "../core/commit/commitBatch.js";
import { singleConnectionResolver } from "../topology/ConnectionResolver.js";
import logger from "../utils/logger.js";

const QUEUE_NAME = process.env.QUEUE_NAME || "onboarder-migration-commit";
const REDIS_URL  = process.env.REDIS_URL || "redis://localhost:6379";
const CHUNK_SIZE = 200;

// The jobStore adapter. Replace at module-level for testing or env-var-driven
// adapter selection (e.g. JOB_STORE_ADAPTER=in-memory).
let _jobStore = null;
function getJobStore() {
  if (!_jobStore) _jobStore = createMongooseJobStore();
  return _jobStore;
}

let _worker = null;

export const startMigrationCommitWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { tenantId, importJobId } = job.data;
      logger.info("[MigrationCommitWorker] processing", { jobId: job.id, tenantId, importJobId });

      const { conn } = tenantId ? await singleConnectionResolver.resolve(tenantId) : { conn: null };
      if (!conn) throw new Error("Could not resolve tenant connection");
      const jobStore = getJobStore();

      const importJob = await jobStore.getJob(tenantId, importJobId, conn);
      const descriptor = getTargetDescriptor(importJob.module, importJob.entityKey);
      const validCount = importJob.counts?.validRows ?? 0;

      let totalCommitted = 0;
      let totalFailed = 0;

      for (;;) {
        const { committed, failed, processed } = await commitBatch(
          tenantId, importJob._id, descriptor,
          { conn, actorId: importJob.createdBy, limit: CHUNK_SIZE }
        );
        totalCommitted += committed;
        totalFailed += failed;

        await jobStore.updateJobModel(conn,
          { _id: importJob._id, tenantId },
          { "counts.committedRows": totalCommitted, "counts.commitFailedRows": totalFailed }
        );

        if (processed < CHUNK_SIZE) break;
      }

      const skipped = Math.max(validCount - totalCommitted - totalFailed, 0);
      const finalStatus = (totalFailed > 0 || skipped > 0) ? "completed_with_errors" : "completed";

      await jobStore.updateJobModel(conn,
        { _id: importJob._id, tenantId },
        {
          status: finalStatus,
          "commit.completedAt": new Date(),
          "counts.committedRows": totalCommitted,
          "counts.commitFailedRows": totalFailed,
          "counts.skippedRows": skipped,
        }
      );

      await emitImportCompletedEvent(tenantId, importJob, {
        status: finalStatus, committed: totalCommitted, failed: totalFailed, skipped,
      }, conn);

      logger.info("[MigrationCommitWorker] done", {
        jobId: job.id, tenantId, importJobId, totalCommitted, totalFailed, finalStatus,
      });
      return { totalCommitted, totalFailed, finalStatus };
    },
    {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: 2,
    }
  );

  _worker.on("failed", (job, err) => {
    logger.error("[MigrationCommitWorker] job failed", {
      jobId: job?.id, importJobId: job?.data?.importJobId, attempt: job?.attemptsMade, error: err.message,
    });
  });

  logger.info("[MigrationCommitWorker] started");
  return _worker;
};

export const stopMigrationCommitWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info("[MigrationCommitWorker] stopped");
  }
};
