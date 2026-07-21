/**
 * QueueAdapter contract tests.
 *
 * Every QueueAdapter implementation must pass these exact same assertions.
 * Run with: node --experimental-vm-modules .../jest core/__contract-tests__/QueueAdapter.contract.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

/**
 * Run contract tests against a QueueAdapter implementation.
 * @param {string} label
 * @param {import("../../queueing/QueueAdapter.js").QueueAdapter} adapter
 */
export function runQueueAdapterContract(label, adapter) {
  describe(`QueueAdapter contract: ${label}`, () => {
    beforeEach(() => {
      adapter._handler = null; // reset in-memory handler
    });

    it("enqueue calls the handler with tenantId and importJobId", async () => {
      const handled = [];
      adapter.startConsumer((payload) => { handled.push(payload); });
      await adapter.enqueue("tenant-1", "job-123");
      expect(handled).toHaveLength(1);
      expect(handled[0].tenantId).toBe("tenant-1");
      expect(handled[0].importJobId).toBe("job-123");
    });

    it("enqueue without handler does not throw", async () => {
      await expect(adapter.enqueue("t1", "j1")).resolves.toBeUndefined();
    });

    it("startConsumer replaces the handler", async () => {
      const calls = [];
      adapter.startConsumer((p) => calls.push("first:" + p.importJobId));
      await adapter.enqueue("t1", "j1");
      adapter.startConsumer((p) => calls.push("second:" + p.importJobId));
      await adapter.enqueue("t2", "j2");
      expect(calls).toEqual(["first:j1", "second:j2"]);
    });

    it("stopConsumer clears the handler", async () => {
      adapter.startConsumer(() => { throw new Error("should not be called"); });
      await adapter.stopConsumer();
      await expect(adapter.enqueue("t1", "j1")).resolves.toBeUndefined();
    });

    it("enqueue twice calls the handler twice", async () => {
      const calls = [];
      adapter.startConsumer((p) => calls.push(p.importJobId));
      await adapter.enqueue("t1", "a");
      await adapter.enqueue("t1", "b");
      expect(calls).toEqual(["a", "b"]);
    });
  });
}
test('contract suite placeholder — implement per-adapter tests here', () => {});
