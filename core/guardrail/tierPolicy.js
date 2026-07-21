/**
 * TierPolicy interface — resolves a tenant's storage tier and its associated
 * import ceiling (rows + bytes).
 *
 * Replaces the old `getTenantConfig(tenantId)` call from #utils/tenantConfig.
 *
 * @typedef {Object} TierPolicy
 * @property {(tenantId: string) => Promise<{storageMode: string, limit: number, limitBytes: number}>} resolve
 *   Resolve a tenant's tier configuration. `storageMode` is one of
 *   "shared"|"dedicated"|"byod"|"local". `limit` is the row ceiling,
 *   `limitBytes` is the byte ceiling.
 */

/**
 * Default env-var-driven TierPolicy.
 *
 * Reads tier ceilings from environment variables, with a fallback that
 * always returns the shared-tier defaults. For the real OfferBerries
 * implementation, swap this for a policy that reads from the tenant DB.
 *
 * @type {TierPolicy}
 */
export const envTierPolicy = {
  async resolve(tenantId) {
    // In the real implementation, look up the tenant's storage mode from
    // the control plane DB. Here we read from env vars with shared defaults.
    const storageMode = process.env.ONBOARDER_TIER_STORAGE_MODE || "shared";
    const SHARED_LIMIT = Number(process.env.ONBOARDER_SHARED_MAX_ROWS) || 20000;
    const DEDICATED_LIMIT = Number(process.env.ONBOARDER_DEDICATED_MAX_ROWS) || 50000;
    const SHARED_BYTES = Number(process.env.ONBOARDER_SHARED_MAX_BYTES) || 20 * 1024 * 1024;
    const DEDICATED_BYTES = Number(process.env.ONBOARDER_DEDICATED_MAX_BYTES) || 512 * 1024 * 1024;

    const isOwnDb = storageMode !== "shared";
    return {
      storageMode,
      limit: isOwnDb ? DEDICATED_LIMIT : SHARED_LIMIT,
      limitBytes: isOwnDb ? DEDICATED_BYTES : SHARED_BYTES,
    };
  },
};
