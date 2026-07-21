// routes/b2b/migration.b2b.routes.js
// External / B2B Migration Wizard API (System Consistency D7). Mounted at
// /api/b2b/migration. This is the machine-to-machine counterpart of the
// operator-facing routes/migration.routes.js — a Connected System can drive an
// import programmatically (initiate → map → validate → commit) and poll its
// status, then receive a MIGRATION_IMPORT_COMPLETED webhook (D8) when it lands.
//
// REUSE, NOT FORK: every handler calls the SAME service layer the internal
// wizard uses (migrationImport / importMapping / importValidation /
// importCommit). There is exactly one import code path; this router only swaps
// the auth model (b2bInboundAuth + per-credential scopes) for the operator's
// session auth, and threads req.tenantId / req.db exactly as the internal
// routes do. No business logic lives here.
//
// AUTH: b2bInboundAuth proves the credential belongs to the tenant and sets
// req.tenantId + req.db + req.b2bCredential. requireB2BScope then narrows to
// what THIS credential may do: `migration:read` for the GETs, `migration:write`
// for the mutating routes — so a read-only integration can poll status but
// never commit. Tier enforcement (which modules/entities the tenant's plan
// unlocks) still applies via requireMigrationTarget, identical to the internal
// router.
//
// UPLOAD MODEL: B2B partners use the own-database offload path only — POST
// /imports with { module, fileName, fileSizeBytes } returns a pre-signed GCS
// PUT URL; the partner uploads directly to GCS and calls /imports/:id/
// upload-complete. There is deliberately no multipart file field here: a
// server-to-server integration streams bytes to object storage, it does not
// POST multipart form-data through the API tier.

import express from "express";
import Joi from "joi";
import { listTargetModules, listTargetEntities } from "../registry/registerTarget.js";
import {
  createImportJobDedicated,
  completeImportUpload,
  getImportJob,
  listImportJobs,
} from "../orchestration/migrationImport.service.js";
import { applyMapping } from "../core/mapping/applyMapping.js";
import { validateImportJob } from "../core/validation/validateRows.js";
import { commitImportJob } from "../core/commit/commitBatch.js";
import requireMigrationTarget from "./requireTarget.middleware.js";
import logger from "../utils/logger.js";

const router = express.Router();

// Every route is authenticated by the tenant's B2B credential first.
router.use(b2bInboundAuth);

const requireMigrationRead  = requireB2BScope("migration", null, "read");
const requireMigrationWrite = requireB2BScope("migration", null, "write");

// ── Joi schemas ──────────────────────────────────────────────────────────────
// Deliberately self-contained (the internal router's schemas are module-private).
// These are defense-in-depth — every service re-validates server-side.
const initiateImportSchema = Joi.object({
  module:        Joi.string().valid(...listTargetModules()).required(),
  fileName:      Joi.string().max(255).required(),          // offload path only
  fileSizeBytes: Joi.number().integer().min(1).required(),
  sqlTable:      Joi.string().max(128).optional(),
});

const importIdParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const listImportsQuerySchema = Joi.object({
  status: Joi.string().valid(
    "pending_upload", "uploaded", "guardrail_rejected", "staged", "mapped", "validated",
    "committing", "completed", "completed_with_errors", "commit_failed", "failed"
  ).optional(),
  page:  Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

const targetSchemasQuerySchema = Joi.object({
  module: Joi.string().valid(...listTargetModules()).required(),
});

const applyMappingSchema = Joi.object({
  entityKey:     Joi.string().required(),
  fieldMap:      Joi.object().pattern(Joi.string(), Joi.string()).min(1).required(),
  saveAsProfile: Joi.boolean().optional(),
  profileLabel:  Joi.string().when("saveAsProfile", { is: true, then: Joi.required(), otherwise: Joi.optional() }),
});

// Uniform B2B error envelope, mirroring the rest of the inbound B2B surface.
const sendErr = (res, err, ctx) => {
  const status = err.statusCode || 500;
  if (status >= 500) logger.error(`[migration.b2b] ${ctx} failed`, { error: err.message });
  // Generic B2B error envelope (replaces b2bError from OfferBerries).
  const body = {
    success: false,
    code: err.details?.code || err.code || "MIGRATION_ERROR",
    message: err.message,
  };
  // Surface the structured upgrade CTA on tier-limit rejections (resolved spec
  // 2026-07-20) so a partner integration can react programmatically, not just
  // read a prose message.
  if (err.details?.upgrade) body.upgrade = err.details.upgrade;
  return res.status(status).json(body);
};

// ── POST /imports — initiate an own-database (offload) import ──────────────────
// Returns { importJob, uploadUrl }. Partner PUTs the file to uploadUrl, then
// calls /imports/:id/upload-complete.
router.post(
  "/imports",
  requireMigrationWrite,
  // Validate request SHAPE (→ 400) before tier authorization (→ 403), so a
  // nonsense module value is a clean bad-request and a valid-but-unentitled
  // module is a clear authorization failure.
  validationMiddleware(initiateImportSchema),
  requireMigrationTarget("module", null, "body"),
  async (req, res) => {
    try {
      const result = await createImportJobDedicated(
        req.tenantId,
        req.body.module,
        req.body.fileName,
        req.b2bCredential?._id ?? null,
        req.db,
        { fileSizeBytes: req.body.fileSizeBytes, sqlTable: req.body.sqlTable }
      );
      return res.status(201).json({ success: true, ...result });
    } catch (err) {
      return sendErr(res, err, "initiate import");
    }
  }
);

// ── POST /imports/:id/upload-complete — verify GCS upload + trigger commit run ─
router.post(
  "/imports/:id/upload-complete",
  requireMigrationWrite,
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const { importJob, executionName } = await completeImportUpload(req.tenantId, req.params.id, req.db);
      return res.json({ success: true, importJob, executionName });
    } catch (err) {
      return sendErr(res, err, "upload-complete");
    }
  }
);

// ── POST /imports/:id/mapping — apply a source→target column mapping ───────────
router.post(
  "/imports/:id/mapping",
  requireMigrationWrite,
  validateParams(importIdParamSchema),
  validationMiddleware(applyMappingSchema),
  async (req, res) => {
    try {
      const job = await applyMapping(
        req.tenantId, req.params.id,
        {
          entityKey:     req.body.entityKey,
          fieldMap:      req.body.fieldMap,
          saveAsProfile: req.body.saveAsProfile,
          profileLabel:  req.body.profileLabel,
          createdBy:     req.b2bCredential?._id ?? null,
        },
        req.db
      );
      return res.json({ success: true, importJob: job });
    } catch (err) {
      return sendErr(res, err, "apply mapping");
    }
  }
);

// ── POST /imports/:id/validate — run validation over the staged, mapped rows ───
router.post(
  "/imports/:id/validate",
  requireMigrationWrite,
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const result = await validateImportJob(req.tenantId, req.params.id, req.db);
      return res.json({ success: true, ...result });
    } catch (err) {
      return sendErr(res, err, "validate");
    }
  }
);

// ── POST /imports/:id/commit — commit valid rows (sync or async by size) ───────
// Fires MIGRATION_IMPORT_COMPLETED on the outbox when it lands (D8), which the
// tenant's outbound webhook (D9) delivers — so the partner need not poll.
router.post(
  "/imports/:id/commit",
  requireMigrationWrite,
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const result = await commitImportJob(
        req.tenantId, req.params.id, { actorId: req.b2bCredential?._id ?? null }, req.db
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      return sendErr(res, err, "commit");
    }
  }
);

// ── GET /imports — list this tenant's import jobs ──────────────────────────────
router.get(
  "/imports",
  requireMigrationRead,
  validateQuery(listImportsQuerySchema),
  async (req, res) => {
    try {
      const result = await listImportJobs(req.tenantId, req.query, req.db);
      return res.json({ success: true, ...result });
    } catch (err) {
      return sendErr(res, err, "list imports");
    }
  }
);

// ── GET /imports/:id — single import job status ────────────────────────────────
router.get(
  "/imports/:id",
  requireMigrationRead,
  validateParams(importIdParamSchema),
  async (req, res) => {
    try {
      const job = await getImportJob(req.tenantId, req.params.id, req.db);
      return res.json({ success: true, importJob: job });
    } catch (err) {
      return sendErr(res, err, "get import");
    }
  }
);

// ── GET /target-schemas?module= — importable entities + field descriptors ──────
router.get(
  "/target-schemas",
  requireMigrationRead,
  validateQuery(targetSchemasQuerySchema),
  requireMigrationTarget("module", null, "query"),
  async (req, res) => {
    try {
      const entities = listTargetEntities(req.query.module);
      return res.json({ success: true, module: req.query.module, entities });
    } catch (err) {
      return sendErr(res, err, "target-schemas");
    }
  }
);

export default router;
