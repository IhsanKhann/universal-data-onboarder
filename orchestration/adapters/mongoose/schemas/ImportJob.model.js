// models/SharedModels/ImportJob.model.js
// Migration Wizard — full build (Party Model Standardization "Phase 6",
// MIGRATION_WIZARD_PLAN_2026-07-07.md §7). Tracks one client-initiated data
// import end to end: upload -> guardrail -> staging -> field mapping ->
// validation -> commit.
//
// `module` is a free label ("hr" | "finance" | "businessops") — the target
// schema registry (services/shared/importTargetRegistry.service.js) only has
// entries for "hr" and "businessops" today (Finance targets deferred, see
// the Phase 6 plan); the model stays loose so adding Finance later needs no
// migration of this schema.
import mongoose from "mongoose";

const { Schema } = mongoose;

const ImportJobSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      "Tenant",
      required: true,
      index:    true,
    },

    // Free label — which module this import targets. Validated at the
    // service layer (createImportJob) against importTargetRegistry's known
    // modules, not a Mongoose enum — keeps the schema stable if a future
    // module (e.g. "finance") gets a registry entry without a migration.
    module: {
      type:     String,
      required: true,
    },

    // Which target entity within `module` this import resolves to, e.g.
    // "employee" (hr) or "party_seller"/"party_buyer"/"party_shipper"
    // (businessops). Null until the mapping step runs.
    entityKey: {
      type:    String,
      default: null,
    },

    // Session this import job belongs to (optional). When set, the job is
    // part of a MigrationSession and may depend on other jobs in the same
    // session for entity reference resolution.
    sessionId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "MigrationSession",
      default: null,
    },

    // The mapping actually used for THIS job, denormalized off
    // ImportMappingProfile at apply-time — editing/deleting the profile
    // afterward must never retroactively change what a past job's rows say
    // they were mapped with.
    mappingProfileId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "ImportMappingProfile",
      default: null,
    },
    fieldMap: {
      type:    mongoose.Schema.Types.Mixed, // { sourceColumn: targetFieldKey }
      default: null,
    },

    sourceFormat: {
      type:     String,
      enum:     ["csv", "json", "excel", "sql"], // sql = Phase 5 dump import (services/shared/sqlDump.parser.js)
      required: true,
    },

    // Phase 5 (SQL dump import) only. A dump holds many tables but the wizard
    // imports one entity per job, so this names the table whose rows to import.
    // Null for every other format, and for a single-table dump (auto-selected).
    // Set at upload time (shared tier) or on the pending_upload job (dedicated
    // tier), and read back by the Cloud Run entrypoint when it parses the dump.
    sqlTable: {
      type:    String,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "pending_upload",       // pre-signed URL issued, awaiting client PUT to GCS (dedicated tier only)
        "uploaded",             // file archived, not yet parsed
        "guardrail_rejected",   // size check failed — import stops here
        "staged",               // rows parsed and written to ImportStagedRecord, awaiting mapping
        "mapped",                // field map applied, mappedFields populated on every row
        "validated",             // required/type/dedup/FK checks run
        "committing",             // commit in progress (meaningful mainly for the async/chunked path)
        "completed",               // every valid row committed, zero invalid rows
        "completed_with_errors",   // valid rows committed; some rows were invalid/skipped/failed
        "commit_failed",            // systemic failure during commit (e.g. worker crash) — not the same as a per-row failure
        "failed",                    // parse or staging error
      ],
      default: "uploaded",
      index: true,
    },

    // Commit run metadata — when was it started/finished, and which path
    // (sync = inline in the request, async = chunked BullMQ worker) handled
    // it. `mode` lets the review UI explain why progress updates are
    // instantaneous vs. gradual.
    commit: {
      startedAt:   { type: Date, default: null },
      completedAt: { type: Date, default: null },
      mode:        { type: String, enum: ["sync", "async", null], default: null },
    },

    // Original file, archived permanently regardless of outcome (plan §4
    // step 9 "Confirm and archive" — "the original file ... is kept
    // permanently for support and trust").
    file: {
      originalName: { type: String, required: true },

      // fileStorage.service.js adapter key (Cloudinary), set by the shared-tier
      // path after uploadFileToCloudinary archives the original.
      //
      // The dedicated tier has no Cloudinary archive: the browser PUTs straight
      // to GCS and the file is located by gcs.objectPath, so there is no adapter
      // key to record. Required only when the job has no GCS object — that keeps
      // the shared tier's invariant intact instead of dropping it for everyone.
      //
      // Function form (not arrow) so `this` is the document. Note this only runs
      // on create/save: findByIdAndUpdate does not run validators unless
      // runValidators is passed, which is why the Cloud Run entrypoint's status
      // writes are unaffected.
      publicId: {
        type: String,
        default: null,
        required: function () { return !this.gcs?.objectPath; },
      },

      url:       { type: String, default: null },
      sizeBytes: { type: Number, required: true },
    },

    counts: {
      totalRows:        { type: Number, default: 0 },
      stagedRows:       { type: Number, default: 0 },
      validRows:        { type: Number, default: 0 },
      invalidRows:      { type: Number, default: 0 },
      committedRows:    { type: Number, default: 0 },
      skippedRows:      { type: Number, default: 0 },
      commitFailedRows: { type: Number, default: 0 },
      // errorRows kept for backward compatibility with Phase 1's
      // parse/staging-error counter — distinct from invalidRows (a
      // validation-stage concept) and commitFailedRows (a commit-stage one).
      errorRows:        { type: Number, default: 0 },
    },

    guardrail: {
      passed:    { type: Boolean, default: null },
      reason:    { type: String, default: null },
      limit:     { type: Number, default: null },
      checkedAt: { type: Date,   default: null },
      // Structured upgrade CTA (resolved spec 2026-07-20): machine-readable
      // {available, fromTier, toTier, currentLimit, targetLimit, actions[]} so
      // the wizard can render an upgrade button rather than parse the prose
      // `reason`. Null on the pass path. See importGuardrail.buildUpgradeCta.
      upgrade:   { type: Object, default: null },
    },

    // Populated for dedicated-tier (Cloud Run) imports: the GCS object path
    // and execution name so the operator can trace failures.
    gcs: {
      objectPath:    { type: String, default: null },
      bucketName:    { type: String, default: null },
      executionName: { type: String, default: null },
    },

    error: { type: String, default: null },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref:  "FinalizedEmployee",
      default: null,
    },
  },
  { timestamps: true }
);

ImportJobSchema.index({ tenantId: 1, createdAt: -1 });
ImportJobSchema.index({ tenantId: 1, status: 1 });

export const getImportJobModel = (conn = mongoose) =>
  conn.models["ImportJob"] ?? conn.model("ImportJob", ImportJobSchema);

export default getImportJobModel();
