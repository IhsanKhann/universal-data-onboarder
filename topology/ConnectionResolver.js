/**
 * ConnectionResolver interface — resolves database connections for a tenant.
 *
 * Replaces the old `#conn/registry`, `#conn/controlPlane`, and
 * `#platformModels/Tenant.model` imports from OfferBerries.
 *
 * @typedef {Object} ConnectionResolver
 * @property {(tenantId: string) => Promise<{conn: object, storageMode: string}>} resolve
 *   Resolve a tenant-scoped database connection. Returns the mongoose
 *   Connection object and the tenant's storage mode.
 * @property {(storageMode: string) => boolean} hasOwnDatabase
 *   Returns true if the given storage mode means the tenant has their own
 *   database (dedicated or byod).
 */

export { singleConnectionResolver } from "./adapters/singleConnectionAdapter.js";
export { mongooseTenantAdapter } from "./adapters/mongooseTenantAdapter.js";
