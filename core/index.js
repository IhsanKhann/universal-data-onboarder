/**
 * @offerberries/universal-data-onboarder — Public API
 *
 * Re-exports the engine's primary public API. Consumers can:
 *
 *   import { commitBatch } from "@offerberries/universal-data-onboarder";
 *   import { registerTarget } from "@offerberries/universal-data-onboarder/registry/registerTarget.js";
 *
 * Or import individual subpath exports as needed.
 */

// Core engine
export { checkGuardrailStreaming, checkImportFileSize } from "./guardrail/streamingGuardrail.js";
export { envTierPolicy } from "./guardrail/tierPolicy.js";
export { parseStreaming, detectSourceFormat } from "./parsing/streamingParser.js";
export { extractTablesFromDump } from "./parsing/sqlDumpParser.js";
export { suggestMappingForJob, applyMapping, listMappingProfiles } from "./mapping/applyMapping.js";
export { validateImportJob, getSampleErrors, patchStagedRecordFields } from "./validation/validateRows.js";
export { commitBatch, commitImportJob, emitImportCompletedEvent } from "./commit/commitBatch.js";
export { isDuplicateKeyError, connectionSupportsTransactions } from "./commit/idempotency.js";

// Registry
export { registerTarget, getTargetDescriptor, listTargetModules, listTargetEntities, resetRegistry } from "../registry/registerTarget.js";

// Interfaces (default implementations)
export { createMongooseJobStore } from "../orchestration/jobStore.js";
export { inMemoryQueueAdapter, bullmqQueueAdapter } from "../queueing/QueueAdapter.js";
export { localFsStorageAdapter, gcsStorageAdapter } from "../storage/StorageAdapter.js";
export { singleConnectionResolver, mongooseTenantConnectionResolver } from "../topology/ConnectionResolver.js";
