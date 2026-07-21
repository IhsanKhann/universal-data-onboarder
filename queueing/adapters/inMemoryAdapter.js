/**
 * In-memory QueueAdapter — resolves commit jobs synchronously. No Redis needed.
 * Suitable for the testbed and single-process deployments.
 *
 * @type {import("../QueueAdapter.js").QueueAdapter}
 */
export const inMemoryQueueAdapter = {
  /** @type {((payload: {tenantId: string, importJobId: string}) => Promise<any>) | null} */
  _handler: null,

  async enqueue(tenantId, importJobId) {
    if (this._handler) {
      await this._handler({ tenantId, importJobId });
    }
  },

  startConsumer(handler) {
    this._handler = handler;
  },

  async stopConsumer() {
    this._handler = null;
  },
};
