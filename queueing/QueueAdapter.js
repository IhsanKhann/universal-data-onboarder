/**
 * QueueAdapter interface — enqueue and process import commit jobs.
 *
 * Replaces the old `#queues/connection`, `#queues/queues`, and
 * `#queues/migrationCommit.queue` imports from OfferBerries.
 *
 * @typedef {Object} QueueAdapter
 * @property {(tenantId: string, importJobId: string) => Promise<void>} enqueue
 *   Enqueue a commit job for the given import. Must be idempotent-safe
 *   (calling it twice for the same import is a no-op on the second call).
 * @property {(handler: (payload: {tenantId: string, importJobId: string}) => Promise<any>) => void} startConsumer
 *   Start consuming jobs from the queue. The handler receives each job's
 *   payload. Only used in worker processes.
 * @property {() => Promise<void>} stopConsumer
 *   Gracefully stop the consumer.
 */

export { inMemoryQueueAdapter } from "./adapters/inMemoryAdapter.js";
export { bullmqQueueAdapter } from "./adapters/bullmqAdapter.js";
