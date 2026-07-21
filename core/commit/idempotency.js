/**
 * Idempotency helpers for the commit engine.
 *
 * Extracted from commitBatch.js per the extraction plan — these are shared
 * between the sync commit path, the async worker, and any retry logic that
 * needs to detect duplicate-key errors or verify transaction support.
 *
 * No OfferBerries domain knowledge, no Mongoose model imports — pure
 * utility functions that inspect connection topology and error codes.
 */

/**
 * Detect a MongoDB duplicate-key error (E11000) from any Error-like object.
 * Covers both numeric `code` (11000, 11001) and string-prefix `message`
 * checks so it works across the Mongo / Mongoose driver boundary.
 */
export const isDuplicateKeyError = (err) =>
  Boolean(err) && (err.code === 11000 || err.code === 11001 || /E11000/.test(err.message || ""));

/**
 * Check whether the Mongoose connection points at a MongoDB topology that
 * supports multi-document transactions (replica set, sharded cluster, or
 * load-balanced). The result is cached on the connection as `__obeTxnSupport`
 * so subsequent calls are O(1) — the topology type never changes for the
 * lifetime of a connection.
 *
 * Returns `false` for standalone mongod (most shared/dev instances) so the
 * engine falls back to row-level idempotency (the crash-retry pattern based
 * on `commitStatus` + duplicate-key detection) instead of attempting a
 * `session.withTransaction()` that would fail.
 */
export const connectionSupportsTransactions = (conn) => {
  if (conn.__obeTxnSupport !== undefined) return conn.__obeTxnSupport;
  let supported = false;
  try {
    const client = typeof conn.getClient === "function"
      ? conn.getClient()
      : conn.connection?.getClient?.();
    const type = client?.topology?.description?.type;
    supported = ["ReplicaSetWithPrimary", "Sharded", "LoadBalanced"].includes(type);
  } catch {
    supported = false;
  }
  conn.__obeTxnSupport = supported;
  return supported;
};
