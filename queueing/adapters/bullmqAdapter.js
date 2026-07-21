// queues/migrationCommit.queue.js — BullMQ Queue for chunked Migration Wizard
// commit jobs (imports over MIGRATION_SYNC_COMMIT_THRESHOLD rows). Producer
// is importCommit.service.js::commitImportJob; consumer is
// workers/platform/migrationCommit.worker.js.
import { Queue } from "bullmq";

let _queue = null;

function getRedisUrl() {
  return process.env.REDIS_URL || "redis://localhost:6379";
}

function getQueueName() {
  return process.env.QUEUE_NAME || "onboarder-migration-commit";
}

const getQueue = async () => {
  if (!_queue) {
    // Dynamic import for ESM compatibility
    const { default: IORedis } = await import("ioredis");
    _queue = new Queue(getQueueName(), {
      connection: new IORedis(getRedisUrl(), { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 100 },
      },
    });
  }
  return _queue;
};

/**
 * Enqueue a chunked commit run for one import job. Idempotent-safe to call
 * more than once for the same importJobId — commitBatch only ever pulls rows
 * still in commitStatus:"pending", so a duplicate/retried job just finds
 * nothing left to do on its second pass.
 * @param {string} tenantId
 * @param {string} importJobId
 */
export const enqueueMigrationCommit = (tenantId, importJobId) =>
  getQueue().add("commit", { tenantId, importJobId });

/**
 * BullMQ queue adapter conforming to the QueueAdapter interface.
 */
export const bullmqQueueAdapter = {
  async enqueue(tenantId, importJobId) {
    await enqueueMigrationCommit(tenantId, importJobId);
  },
  /**
   * @param {(payload: {tenantId: string, importJobId: string}) => Promise<any>} handler
   */
  startConsumer(handler) {
    // Consumer started separately via startMigrationCommitWorker
    // This is a placeholder for the QueueAdapter interface
  },
  async stopConsumer() {
    if (_queue) {
      await _queue.close();
      _queue = null;
    }
  },
};
