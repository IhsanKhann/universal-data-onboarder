/**
 * Single-connection ConnectionResolver — always returns the default mongoose
 * connection. Suitable for the testbed and single-tenant deployments.
 *
 * @type {import("../ConnectionResolver.js").ConnectionResolver}
 */
export const singleConnectionResolver = {
  async resolve(tenantId) {
    const { default: mongoose } = await import("mongoose");
    return { conn: mongoose, storageMode: process.env.ONBOARDER_TIER_STORAGE_MODE || "shared" };
  },
  hasOwnDatabase(storageMode) {
    return storageMode === "dedicated" || storageMode === "byod";
  },
};
