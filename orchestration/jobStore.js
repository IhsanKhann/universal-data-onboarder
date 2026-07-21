/**
 * JobStore — abstract interface for the import job persistence layer.
 *
 * The engine's core/ and orchestration/ code depends ONLY on this module,
 * never on concrete Mongoose model getters. Adapters in ./adapters/ implement
 * the actual persistence.
 *
 * By default, this module exports the Mongoose-backed implementation
 * (createMongooseJobStore). To swap:
 *
 *   import { createInMemoryJobStore } from "./adapters/inMemoryJobStore.js";
 *
 * The composition root (cloudRunEntrypoint.js, server.js) should select the
 * adapter at startup via env var (JOB_STORE_ADAPTER) and pass it — or
 * replace `createMongooseJobStore` on this module before the first import.
 *
 * ── Interface contract ─────────────────────────────────────────────────────
 * A JobStore adapter MUST implement these methods:
 *
 *   getJob(tenantId, importJobId, conn)         → Promise<ImportJob>
 *   updateJob(tenantId, importJobId, updates, conn) → Promise<ImportJob>
 *   saveJob(job)                                → Promise<ImportJob>
 *   insertRows(tenantId, importJobId, records, conn) → Promise<number>
 *   findOneStaged(filter, conn)                 → Promise<object|null>
 *   saveRow(record)                             → Promise<object>
 *   bulkWriteStaged(conn, ops)                  → Promise<BulkWriteResult>
 *   aggregateStaged(conn, pipeline)             → Promise<Array>
 *   distinctStaged(conn, field, filter)         → Promise<Array>
 *   cursorStaged(conn, filter, opts?)           → Cursor
 *   updateOneStaged(filter, update, conn, opts?) → Promise
 *   updateJobModel(conn, filter, updates, opts?) → Promise
 *   listMappingProfiles(tenantId, filter, conn)  → Promise<Array>
 *   upsertMappingProfile(...)                   → Promise<object>
 *   findSampleErrors(tenantId, importJobId, limit, conn) → Promise<Array>
 *   getSession(tenantId, sessionId, conn)       → Promise<object>
 */

export { createMongooseJobStore } from "./adapters/mongooseJobStore.js";
export { createInMemoryJobStore } from "./adapters/inMemoryJobStore.js";
