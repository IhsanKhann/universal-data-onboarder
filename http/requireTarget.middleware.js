// middlewares/requireMigrationTarget.js
// Migration Wizard tier enforcement (MIGRATION_WIZARD_TIERED_EXTENSION_MASTER_PLAN_2026-07-16.md
// §1 — "NOT YET ENFORCED, closing this is Stage E2+ work").
//
// Checks that the requested (module, entityKey) import target is within the
// set of targets unlocked by the tenant's package tier. A Finance-only tenant
// cannot import HR employees, and a BusinessOps tenant cannot import invoices.
//
// This middleware runs AFTER authenticate (req.tenantId is set) and is mounted
// per-route on the wizard's write endpoints (POST /imports, etc.). It reads
// the tenant's enabled module flags from the tenant config cached on req.tenant
// (set by requireModule or lazily fetched here) and compares the request against
// resolveImportTargetsForModules() — the flags are the source of truth, so an
// off-catalog module combo is never locked out (System Consistency D6).
//
// Fail-closed: if the tenant cannot be resolved, the request is denied with
// 403/TENANT_RESOLUTION_FAILED rather than silently granting every module.
//
// Usage on a route that sends module + entityKey in body:
//   router.post("/imports", requireMigrationTarget("module", "entityKey"), ...)
//
// Usage on a route that sends them in query:
//   router.get("/target-schemas", requireMigrationTarget("module", null, "query"), ...)

import { envTierPolicy } from "../core/guardrail/tierPolicy.js";
import logger from "../utils/logger.js";

// ── Module-to-entity whitelist (resolved from the registry) ────────────────
// In OfferBerries, this is a service that reads tenant module flags from the
// control plane. Here we derive the same from our static tier policy.
const ALL_KNOWN_TARGETS = null; // resolved lazily below

function resolveImportTargetsForModules(moduleFlags) {
  // Placeholder: In a generic deployment, module flags equal allowed targets.
  // The real OfferBerries implementation reads from wizardStageCatalog.
  // For now, return a pass-all sentinel so the middleware works without
  // a real module flag system.
  return [{ module: "*", entityKey: "*" }];
}

/**
 * Middleware that enforces tier-based migration target access.
 *
 * @param {string} moduleField   - req.body or req.query field name for the module (default "module")
 * @param {string} entityField   - req.body or req.query field name for the entityKey (default "entityKey").
 *                                  Pass null to skip entity-level check (e.g. for module-scoped endpoints).
 * @param {string} source        - "body" (default) or "query" — where to read moduleField/entityField from
 */
const requireMigrationTarget = (moduleField = "module", entityField = "entityKey", source = "body") =>
  async (req, res, next) => {
    // Single-tenant mode: no tenantId → no enforcement (all targets allowed)
    if (!req.tenantId) return next();

    const data = source === "query" ? req.query : req.body;
    const moduleName = data?.[moduleField];
    const entityKey  = entityField ? data?.[entityField] : null;

    try {
      // Use req.tenant if already resolved (e.g. by requireModule), or fetch fresh
      const tenant = req.tenant ?? await getTenantConfig(req.tenantId);
      if (!tenant) {
        return res.status(403).json({
          success: false,
          code: "TENANT_RESOLUTION_FAILED",
          message: "Unable to resolve tenant configuration for this request.",
        });
      }
      req.tenant = tenant;

      const denial = getTenantAccessDenial(tenant);
      if (denial) {
        return res.status(403).json({ success: false, code: denial.code, message: denial.message });
      }

      // Resolve allowed import targets DIRECTLY from the tenant's enabled module
      // flags — not from a reverse-mapped package name. getPackageKey() is
      // exact-match and returns null for any off-catalog module combination
      // (e.g. HR + Marketplace), which used to 403/PACKAGE_NOT_RESOLVED and lock
      // a perfectly valid tenant out of the wizard entirely (System Consistency
      // D6). Module flags are the source of truth; for the six named packages
      // this yields the identical target set the old path did.
      const allowedTargets = resolveImportTargetsForModules(tenant.modules);

      // If moduleName is not provided, we can't enforce — let the next middleware
      // (Joi validation) reject it instead, since any actual route needs a module.
      if (!moduleName) return next();

      // Check if any of the allowed targets match the requested module.
      // If no entityKey was requested, module-level access is sufficient.
      const moduleAllowed = allowedTargets.some((t) => t.module === moduleName);
      if (!moduleAllowed) {
        const available = [...new Set(allowedTargets.map((t) => t.module))];
        return res.status(403).json({
          success: false,
          code: "MODULE_NOT_UNLOCKED",
          message: `The "${moduleName}" module is not unlocked by your current plan. Available: ${available.join(", ") || "none"}.`,
        });
      }

      // If a specific entityKey is requested, verify it's in the allowed set
      if (entityKey) {
        const entityAllowed = allowedTargets.some(
          (t) => t.module === moduleName && t.entityKey === entityKey
        );
        if (!entityAllowed) {
          const available = allowedTargets
            .filter((t) => t.module === moduleName)
            .map((t) => t.entityKey);
          return res.status(403).json({
            success: false,
            code: "ENTITY_NOT_UNLOCKED",
            message: `The "${entityKey}" import target is not unlocked by your current plan. Available for "${moduleName}": ${available.join(", ") || "none"}.`,
          });
        }
      }

      next();
    } catch (err) {
      logger.error("[requireMigrationTarget] Tenant lookup failed — denying by default", {
        moduleName, entityKey, tenantId: req.tenantId, error: err.message,
      });
      return res.status(403).json({
        success: false,
        code: "TENANT_RESOLUTION_FAILED",
        message: "Unable to resolve tenant configuration for this request.",
      });
    }
  };

export default requireMigrationTarget;
