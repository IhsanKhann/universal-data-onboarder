/**
 * Mongoose tenant-aware ConnectionResolver.
 *
 * Resolves tenant database connections from a control plane. In OfferBerries,
 * this reads the Tenant model from the control plane DB to get the tenant's
 * dedicated connection string, decrypts it, and connects directly.
 *
 * For environments without a control plane, falls back to singleConnectionResolver.
 *
 * @type {import("../ConnectionResolver.js").ConnectionResolver}
 */
export const mongooseTenantAdapter = {
  async resolve(tenantId) {
    const mongoose = await import("mongoose");
    // In OfferBerries, this connects to the control plane, loads Tenant.model,
    // decrypts dbConnectionString, and creates a dedicated connection.
    // For generic deployments, read from env vars:
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (mongoUri) {
      const conn = await mongoose.default.createConnection(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
      }).asPromise();
      return { conn, storageMode: process.env.ONBOARDER_TIER_STORAGE_MODE || "dedicated" };
    }
    // Fallback: single connection
    const { singleConnectionResolver } = await import("./singleConnectionAdapter.js");
    return singleConnectionResolver.resolve(tenantId);
  },
  hasOwnDatabase(storageMode) {
    return storageMode === "dedicated" || storageMode === "byod";
  },
};
