/**
 * TargetDescriptor — the contract every import target must satisfy.
 *
 * This is the ONLY interface the engine's core/ and orchestration/ code
 * depends on. Implementations live in examples/offerberries-targets/
 * (the OfferBerries reference) or any consumer's own target files.
 *
 * @property {string} namespace - Caller-defined grouping, e.g. "hr", "finance", "crm"
 * @property {string} entityKey - Unique identifier within namespace, e.g. "employee"
 * @property {string} [label] - Human-readable name
 * @property {string} [icon] - Icon identifier for UI
 * @property {string} [destination] - UI navigation target
 * @property {FieldSpec[]} fields - Field definitions for mapping/validation UI
 * @property {string} [identityField] - Natural key for idempotency (e.g. "externalId")
 * @property {boolean} [commitInTransaction] - If true, commitRow + row status flip
 *   run in one atomic transaction. Required for entities with NO usable unique
 *   identity to dedup on.
 * @property {(row: Record<string, any>) => Promise<boolean> | boolean} [validateRow]
 *   Optional per-row validation hook. Runs during the validation phase.
 * @property {(tenantId: string, mappedFields: Record<string, any>, ctx: { conn: any, actorId?: string|null, session?: any }) => Promise<{ entityId: string, entityModel: string }>} commitRow
 *   Commit a single row to the target system. Throws on failure — the engine
 *   catches per-row and continues the batch.
 * @property {(tenantId: string, identityValues: any[], conn: any) => Promise<Set<string>>} [findExistingIdentities]
 *   Batched identity lookup for existing-record dedup. Returns a Set of
 *   identity values that already exist.
 * @property {string[]} [dependencies] - Entity keys this descriptor depends on
 *   (for session ordering).
 * @property {string[]} [referenceFields] - Field keys that reference other entities
 *   by name (resolved at commit time).
 * @property {(tenantId: string, distinctValuesByKey: Record<string, any[]>, conn: any) => Promise<Record<string, Map<string, any>>>} [resolveReferences]
 *   Resolve reference field values to entity IDs. Called during validation.
 */

/**
 * @typedef {Object} FieldSpec
 * @property {string} key - Field identifier
 * @property {string} label - Human-readable label
 * @property {"string"|"number"|"date"|"boolean"} type - Field type
 * @property {boolean} [required] - Whether this field is required
 * @property {string[]} [aliases] - Alternative column names for auto-mapping
 * @property {string[]} [enum] - Allowed values (enum constraint)
 * @property {string} [helper] - Help text for UI
 */
