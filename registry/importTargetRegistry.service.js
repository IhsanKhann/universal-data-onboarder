// registry/importTargetRegistry.service.js
// REFACTORED (Phase 3) — This file now REGISTERS OfferBerries-specific target
// descriptors into the generic registry (registry/registerTarget.js).
//
// All descriptor definitions have been extracted to individual files under
// examples/offerberries-targets/*.target.js. This file re-exports shared
// utilities (coerceFieldValue, MODULE_LABELS) and re-exports the generic
// registry's lookup functions so existing importers continue to work.
//
// New code should import directly from registry/registerTarget.js instead.
// @ts-nocheck

import mongoose from "mongoose";

// ── Re-export the generic registry API ───────────────────────────────────────
export { getTargetDescriptor, listTargetModules, listTargetEntities } from "./registerTarget.js";

// ── Value coercion (shared by importMapping.service.js's applyMapping) ───────
export const coerceFieldValue = (type, rawValue, fieldLabel) => {
  if (rawValue == null || rawValue === "") return null;
  switch (type) {
    case "number": {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) throw Object.assign(new Error(`"${fieldLabel}" value "${rawValue}" is not a valid number`), { statusCode: 400 });
      return n;
    }
    case "date": {
      const d = new Date(rawValue);
      if (Number.isNaN(d.getTime())) throw Object.assign(new Error(`"${fieldLabel}" value "${rawValue}" is not a valid date`), { statusCode: 400 });
      return d;
    }
    case "boolean":
      if (typeof rawValue === "boolean") return rawValue;
      return /^(true|1|yes|y)$/i.test(String(rawValue));
    case "string":
    default:
      return String(rawValue).trim();
  }
};

// ── Module labels (tenant-facing UI labels) ──────────────────────────────────
export const MODULE_LABELS = {
  shared:        "Organization",
  hr:            "HR",
  businessops:   "Marketplace",
  communication: "Communication",
  finance:       "Finance",
};

// ── OfferBerries descriptor registration ─────────────────────────────────────
// Each .target.js file in examples/offerberries-targets/ calls registerTarget()
// and is imported here for registration. To register all OfferBerries targets,
// import the target files:
//
//   import "./examples/offerberries-targets/role.target.js";
//   import "./examples/offerberries-targets/orgunit.target.js";
//   import "./examples/offerberries-targets/employee.target.js";
//   // ... etc
//
// For backwards compatibility with the old TARGET_REGISTRY object, consumers
// should switch to registry/registerTarget.js's getTargetDescriptor API.
