// routes/migration.routes.js
// Migration Wizard — full build (Party Model Standardization "Phase 6",
// MIGRATION_WIZARD_PLAN_2026-07-07.md §7). Mounted at /api/migration. Not
// gated behind requireModule(...) — a migration import can target any
// module (HR, BusinessOps), so this is an admin-only capability rather than
// a per-module one.
//
// Every handler passes req.db (the tenant connection resolved globally by
// middlewares/connectionContext.js, mounted app-wide in server.js) into the
// service layer — a dedicated/local-storage tenant's imports must land on
// their own DB, not the shared default. See migrationImport.service.js's
// header for the isolation gap this closes.
//
// Follows the same inline try/catch pattern as routes/finance/party.routes.js
// (no separate controller file — this route group is small enough that a
// controller indirection would just be ceremony).
import express from "express";
import multer from "multer";
import Joi from "joi";
import { SHARED_MAX_IMPORT_BYTES, describeGuardrailRejection } from "../core/guardrail/streamingGuardrail.js";
import { envTierPolicy } from "../core/guardrail/tierPolicy.js";
import {
  createImportJob,
  createImportJobDedicated,
  completeImportUpload,
  getImportJob,
  listImportJobs,
  listStagedRows,
} from "../orchestration/migrationImport.service.js";
import {
  listTargetModules,
  listTargetEntities,
} from "../registry/registerTarget.js";
import { MODULE_LABELS } from "../registry/importTargetRegistry.service.js";
import {
  applyMapping,
  suggestMappingForJob,
  listMappingProfiles,
} from "../core/mapping/applyMapping.js";
import {
  validateImportJob,
  getSampleErrors,
  patchStagedRecordFields,
} from "../core/validation/validateRows.js";
import { commitImportJob } from "../core/commit/commitBatch.js";
import {
  createSession,
  getSession,
  listSessions,
  addJobToSession,
  computeSessionOrder,
  populateSessionExternalIds,
} from "../orchestration/sessionManager.js";
import requireMigrationTarget from "./requireTarget.middleware.js";

const router = express.Router();
router.use(authenticate);

// Shared-tier uploads are bounded by the SAME constant the guardrail reasons
// about, not by the global 20MB default that happened to disagree with it.
// Multer rejects before any handler runs, so this — not importGuardrail's
// checkImportFileSize, which only dedicated-tier callers reach — is what
// actually enforces the shared byte ceiling.
const upload = makeUploader(SHARED_MAX_IMPORT_BYTES);

// ── Joi schemas ────────────────────────────────────────────────────────────────

// Only "hr"/"businessops" have a target schema registered today (Finance
// deferred — see importTargetRegistry.service.js's header). Caught here, at
// upload time, rather than waiting until the mapping step to disappoint.
//
// fileName/fileSizeBytes are what select the dedicated-tier (pre-signed GCS
// URL) path. They MUST be declared here: validationMiddleware runs with
// stripUnknown:true and reassigns req.body, so any key missing from this
// schema is silently deleted before the handler runs — which is exactly how
// the dedicated branch came to be unreachable dead code.
const createImportSchema = Joi.object({
  module: Joi.string().valid(...listTargetModules()).required(),
  fileName: Joi.string().max(255).optional(),
  fileSizeBytes: Joi.number().integer().min(1).optional(),
  // Phase 5: which table to import from a multi-table SQL dump. Optional —
  // a single-table dump auto-selects, and non-SQL uploads ignore it. Like
  // fileName above, it MUST be declared here or validationMiddleware's
  // stripUnknown:true deletes it before the handler runs.
  sqlTable: Joi.string().max(128).optional(),
});

const listImportsQuerySchema = Joi.object({
  status: Joi.string().valid(
    "pending_upload", "uploaded", "guardrail_rejected", "staged", "mapped", "validated",
    "committing", "completed", "completed_with_errors", "commit_failed", "failed"
  ).optional(),
  page:  Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

const importIdParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const rowIdParamSchema = Joi.object({
  id:    Joi.string().hex().length(24).required(),
  rowId: Joi.string().hex().length(24).required(),
});

// `module` is OPTIONAL: omitting it returns every module the tenant's tier
// unlocks. That is what lets the wizard render its target list without knowing
// module names in advance — it used to hardcode businessops+hr, which is why
// finance and communication targets were unreachable in the GUI even after
// their descriptors shipped.
const targetSchemasQuerySchema = Joi.object({
  module: Joi.string().valid(...listTargetModules()).optional(),
});

const mappingSuggestionsQuerySchema = Joi.object({
  module:    Joi.string().valid(...listTargetModules()).required(),
  entityKey: Joi.string().required(),
});

const mappingProfilesQuerySchema = Joi.object({
  module:    Joi.string().valid(...listTargetModules()).optional(),
  entityKey: Joi.string().optional(),
});

const applyMappingSchema = Joi.object({
  entityKey: Joi.string().required(),
  // sourceColumn -> targetFieldKey. Values validated against the target's
  // known field keys inside applyMapping itself (server-side whitelist) —
  // Joi only needs to confirm the shape here.
  fieldMap: Joi.object().pattern(Joi.string(), Joi.string()).min(1).required(),
  saveAsProfile: Joi.boolean().optional(),
  profileLabel: Joi.string().when("saveAsProfile", { is: true, then: Joi.required(), otherwise: Joi.optional() }),
});

const listRowsQuerySchema = Joi.object({
  status: Joi.string().valid("unvalidated", "valid", "invalid").optional(),
  page:   Joi.number().integer().min(1).optional(),
  limit:  Joi.number().integer().min(1).max(200).optional(),
});

const patchRowSchema = Joi.object({
  mappedFields: Joi.object().optional(),
  exclude: Joi.boolean().optional(),
}).or("mappedFields", "exclude");

// ── POST /imports — upload (shared-tier) or initiate (own-database) import ──
//
// Shared tier (storageMode "shared"): receives the file via multer, parses
// inline, stages rows, returns the completed ImportJob. Same as before.
//
// Own-database tier (storageMode "dedicated" or "byod"): creates an ImportJob
// with status "pending_upload", generates a pre-signed GCS PUT URL, returns
// both. The browser uploads the file directly to GCS, then calls
// POST /imports/:id/upload-complete to verify and trigger the Cloud Run Job.
// Both own-database modes offload identically — createImportJobDedicated()
// asserts the mode and connects to whichever database the tenant owns.
//
// Which path runs is chosen by the client (fileName ⇒ offload, file ⇒ multer),
// informed by the tenant's storageMode; the server still asserts the mode in
// createImportJobDedicated, so a shared tenant cannot reach the offload path.
router.post(
  "/imports",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  requireMigrationTarget("module", null, "body"),
  upload.single("file"),
  validationMiddleware(createImportSchema),
  async (req, res) => {
    try {
      // Dedicated-tier path: req.body.fileName indicates a pre-signed URL
      // upload. req.file is absent (the browser uploads directly to GCS).
      if (req.body.fileName) {
        const result = await createImportJobDedicated(
          req.tenantId,
          req.body.module,
          req.body.fileName,
          req.user?._id ?? null,
          req.db,
          { fileSizeBytes: req.body.fileSizeBytes, sqlTable: req.body.sqlTable }
        );
        return res.status(201).json({ success: true, ...result });
      }

      // Shared-tier path (legacy): requires multer-uploaded file.
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (expected form field \"file\" for shared-tier uploads)" });
      }
      const job = await createImportJob(
        req.tenantId, req.body.module, req.file, req.user?._id ?? null, req.db,
        { sqlTable: req.body.sqlTable }
      );
      res.status(201).json({ success: true, importJob: job });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /imports/:id/upload-complete — verify GCS upload + trigger Cloud Run ──
// Called by the browser after it PUT the file to the pre-signed URL. The
// server issues a GCS HEAD request to verify the object exists, then updates
// the ImportJob status to "uploaded" and triggers the Cloud Run Job.
router.post(
  "/imports/:id/upload-complete",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const { importJob, executionName } = await completeImportUpload(
        req.tenantId, req.params.id, req.db
      );
      res.json({ success: true, importJob, executionName });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /imports — list this tenant's import jobs ─────────────────────────────
router.get(
  "/imports",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateQuery(listImportsQuerySchema),
  async (req, res) => {
    try {
      const result = await listImportJobs(req.tenantId, req.query, req.db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /imports/:id — single import job status ───────────────────────────────
router.get(
  "/imports/:id",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const job = await getImportJob(req.tenantId, req.params.id, req.db);
      res.json({ success: true, importJob: job });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /target-schemas?module= — entities + field descriptors for a module ───
// Job-independent on purpose — the "choose target" step of the wizard needs
// this before (or without) any specific import job in context.
router.get(
  "/target-schemas",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  requireMigrationTarget("module", null, "query"),
  validateQuery(targetSchemasQuerySchema),
  async (req, res) => {
    try {
      if (req.query.module) {
        const entities = listTargetEntities(req.query.module);
        return res.json({ success: true, module: req.query.module, entities });
      }

      // No module → every target this tenant's tier unlocks, grouped by module.
      // Built from resolveImportTargetsForModules (the same whitelist
      // requireMigrationTarget enforces with, derived straight from the tenant's
      // module flags), so the GUI can only ever offer what a POST would actually
      // accept — and an off-catalog module combo isn't locked out (D6). Single-
      // tenant mode (no tenantId → middleware never set req.tenant) falls back to
      // the full registry.
      const allowed = req.tenant ? resolveImportTargetsForModules(req.tenant.modules) : null;

      const modules = listTargetModules()
        .map((moduleName) => {
          const allowedKeys = allowed
            ? new Set(allowed.filter((t) => t.module === moduleName).map((t) => t.entityKey))
            : null;
          const entities = listTargetEntities(moduleName)
            .filter((e) => !allowedKeys || allowedKeys.has(e.entityKey));
          return { module: moduleName, label: MODULE_LABELS[moduleName] ?? moduleName, entities };
        })
        .filter((m) => m.entities.length > 0);

      return res.json({ success: true, modules });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /imports/:id/mapping-suggestions?module=&entityKey= ──────────────────
router.get(
  "/imports/:id/mapping-suggestions",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  requireMigrationTarget("module", "entityKey", "query"),
  validateParams(importIdParamSchema),
  validateQuery(mappingSuggestionsQuerySchema),
  async (req, res) => {
    try {
      const result = await suggestMappingForJob(
        req.tenantId, req.params.id, req.query.module, req.query.entityKey, req.db
      );
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /imports/:id/mapping — apply a field map, optionally save as profile ─
router.post(
  "/imports/:id/mapping",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  requireMigrationTarget("module", "entityKey", "body"),
  validateParams(importIdParamSchema),
  validationMiddleware(applyMappingSchema),
  async (req, res) => {
    try {
      const job = await applyMapping(req.tenantId, req.params.id, {
        entityKey: req.body.entityKey,
        fieldMap: req.body.fieldMap,
        saveAsProfile: req.body.saveAsProfile ?? false,
        profileLabel: req.body.profileLabel ?? null,
        createdBy: req.user?._id ?? null,
      }, req.db);
      res.json({ success: true, importJob: job });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /mapping-profiles?module=&entityKey= — saved profiles for reuse ──────
router.get(
  "/mapping-profiles",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateQuery(mappingProfilesQuerySchema),
  async (req, res) => {
    try {
      const profiles = await listMappingProfiles(req.tenantId, req.query, req.db);
      res.json({ success: true, profiles });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /imports/:id/validate — run required/dedup/FK checks ────────────────
router.post(
  "/imports/:id/validate",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const { validCount, invalidCount } = await validateImportJob(req.tenantId, req.params.id, req.db);
      const sampleErrors = await getSampleErrors(req.tenantId, req.params.id, 10, req.db);
      res.json({ success: true, validCount, invalidCount, sampleErrors });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /imports/:id/rows?status=&page=&limit= — paginated row review ────────
router.get(
  "/imports/:id/rows",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateParams(importIdParamSchema),
  validateQuery(listRowsQuerySchema),
  async (req, res) => {
    try {
      const result = await listStagedRows(req.tenantId, req.params.id, req.query, req.db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── PATCH /imports/:id/rows/:rowId — fix or exclude a single row ─────────────
router.patch(
  "/imports/:id/rows/:rowId",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(rowIdParamSchema),
  validationMiddleware(patchRowSchema),
  async (req, res) => {
    try {
      const row = await patchStagedRecordFields(
        req.tenantId, req.params.id, req.params.rowId,
        { mappedFields: req.body.mappedFields, exclude: req.body.exclude ?? false },
        req.db
      );
      res.json({ success: true, row });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /imports/:id/commit — commit every valid row (sync or chunked async) ─
router.post(
  "/imports/:id/commit",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const result = await commitImportJob(req.tenantId, req.params.id, { actorId: req.user?._id ?? null }, req.db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// Session routes (Stage E1 — multi-job migration sessions with dependency
// graph ordering and cross-job external-ID resolution)
// ═══════════════════════════════════════════════════════════════════════════

// ── Joi schemas for session routes ──────────────────────────────────────────

const createSessionSchema = Joi.object({
  label: Joi.string().max(255).optional(),
});

const sessionIdParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const listSessionsQuerySchema = Joi.object({
  status: Joi.string().valid("pending", "processing", "completed", "completed_with_errors", "failed").optional(),
  page:   Joi.number().integer().min(1).optional(),
  limit:  Joi.number().integer().min(1).max(100).optional(),
});

const addJobSessionParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const addJobToSessionSchema = Joi.object({
  importJobId: Joi.string().hex().length(24).required(),
  module:      Joi.string().valid(...listTargetModules()).required(),
  entityKey:   Joi.string().required(),
});

// ── POST /sessions — create a new migration session ──────────────────────────
router.post("/sessions",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validationMiddleware(createSessionSchema),
  async (req, res) => {
    try {
      const session = await createSession(
        req.tenantId, req.body.label ?? null, req.user?._id ?? null, req.db
      );
      res.status(201).json({ success: true, session });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /sessions — list this tenant's sessions ──────────────────────────────
router.get("/sessions",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateQuery(listSessionsQuerySchema),
  async (req, res) => {
    try {
      const result = await listSessions(req.tenantId, req.query, req.db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── GET /sessions/:id — single session status ────────────────────────────────
router.get("/sessions/:id",
  authorize(PERMISSIONS.VIEW_MIGRATIONS),
  validateParams(sessionIdParamSchema),
  async (req, res) => {
    try {
      const session = await getSession(req.tenantId, req.params.id, req.db);
      res.json({ success: true, session });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /sessions/:id/jobs — add an import job to a session ─────────────────
router.post("/sessions/:id/jobs",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  requireMigrationTarget("module", "entityKey", "body"),
  validateParams(addJobSessionParamSchema),
  validationMiddleware(addJobToSessionSchema),
  async (req, res) => {
    try {
      const session = await addJobToSession(
        req.tenantId, req.params.id,
        req.body.importJobId, req.body.module, req.body.entityKey,
        req.db
      );
      res.json({ success: true, session });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /sessions/:id/compute-order — compute execution order ───────────────
router.post("/sessions/:id/compute-order",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(sessionIdParamSchema),
  async (req, res) => {
    try {
      const session = await computeSessionOrder(req.tenantId, req.params.id, req.db);
      res.json({ success: true, session });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── POST /sessions/:id/populate-external-ids — populate externalIds ──────────
router.post("/sessions/:id/populate-external-ids",
  authorize(PERMISSIONS.MANAGE_MIGRATIONS),
  validateParams(sessionIdParamSchema),
  async (req, res) => {
    try {
      const updated = await populateSessionExternalIds(req.tenantId, req.params.id, req.db);
      res.json({ success: true, updated });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.details ? { code: err.details.code, upgrade: err.details.upgrade, guardrail: err.details } : {}),
      });
    }
  }
);

// ── Router-level multer error handler (resolved-spec early-detection CTA) ─────
// A shared-tier upload over SHARED_MAX_IMPORT_BYTES is aborted by multer BEFORE
// any handler runs — previously that surfaced as a generic "File too large"
// with no guidance, the exact dead-end the 2026-07-20 tier decision says the
// shared tier must not hit. Catch LIMIT_FILE_SIZE here and return the SAME
// structured upgrade CTA the guardrail emits, so early detection (byte, shared
// tier) is a guided upgrade prompt rather than a bare error. Multer aborts the
// stream, so the exact byte count is unknown — `current:null` in the envelope.
// Any other error (or non-migration multer error) falls through to the global
// handler unchanged.
router.use(async (err, req, res, next) => {
  if (!(err instanceof multer.MulterError) || err.code !== "LIMIT_FILE_SIZE") {
    return next(err);
  }
  let storageMode = "shared";
  try {
    const tier = req.tenantId ? await envTierPolicy.resolve(req.tenantId) : null;
    storageMode = tier?.storageMode ?? "shared";
  } catch {
    // Fall back to "shared" — the only tier multer's ceiling actually gates.
  }
  const details = describeGuardrailRejection(storageMode, "bytes", {
    limit: SHARED_MAX_IMPORT_BYTES,
    current: null,
  });
  return res.status(413).json({
    success: false,
    message: details.reason,
    code: details.code,
    upgrade: details.upgrade,
    guardrail: details,
  });
});

export default router;
