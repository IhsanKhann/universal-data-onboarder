// models/SharedModels/MigrationSession.model.js
// Migration Wizard — Stage E1 (MIGRATION_WIZARD_TIERED_EXTENSION_MASTER_PLAN
// 2026-07-16.md §3). Groups multiple ImportJobs into a single ordered session
// so cross-entity dependencies (e.g. an Employee job referencing an OrgUnit that
// hasn't been committed yet) can be resolved from still-staged rows.
//
// Each session has an executionOrder computed from the dependency graph of the
// entities it contains. The Cloud Run entrypoint reads the session, runs each
// job's pipeline in execution order, and advances the session's status.
import mongoose from "mongoose";

const { Schema } = mongoose;

const MigrationSessionSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      "Tenant",
      required: true,
      index:    true,
    },

    // Human-readable label for the session, e.g. "Initial org chart import — 2026-07-20".
    label: { type: String, default: null },

    status: {
      type: String,
      enum: [
        "pending",      // created, jobs being added
        "processing",   // being executed by the Cloud Run entrypoint
        "completed",    // all jobs finished successfully
        "completed_with_errors", // some jobs completed, some had errors
        "failed",       // systemic failure (e.g. dependency resolution failed)
      ],
      default: "pending",
    },

    // Unordered collection of jobs in this session. The Cloud Run entrypoint
    // topologically sorts these into executionOrder before running anything.
    jobs: [{
      importJobId: {
        type:     Schema.Types.ObjectId,
        ref:      "ImportJob",
        required: true,
      },
      module:    { type: String, required: true },    // "hr" | "businessops"
      entityKey: { type: String, required: true },    // "employee" | "party_seller" | ...
    }],

    // Computed execution order (array of ImportJob ObjectIds). Set by the
    // Cloud Run entrypoint before it starts processing, or by a pre-compute step.
    executionOrder: [{ type: Schema.Types.ObjectId, ref: "ImportJob" }],

    // The resolved dependency graph this session was sorted from.
    // keyed by entityKey -> [entityKeys it depends on].
    // Set by the Cloud Run entrypoint before topological sort.
    dependencyGraph: { type: Schema.Types.Mixed, default: {} },

    // Per-job status within the session
    jobStatuses: [{
      importJobId: {
        type: Schema.Types.ObjectId,
        ref:  "ImportJob",
      },
      status: {
        type: String,
        enum: [
          "pending",            // not started yet
          "processing",         // currently running
          "completed",          // job finished successfully
          "completed_with_errors", // job completed but some rows failed
          "failed",             // job failed
          "skipped",            // skipped because a dependency failed
        ],
        default: "pending",
      },
      error: { type: String, default: null },
    }],

    counts: {
      total:     { type: Number, default: 0 }, // total jobs
      completed: { type: Number, default: 0 },
      failed:    { type: Number, default: 0 },
      skipped:   { type: Number, default: 0 },
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

MigrationSessionSchema.index({ tenantId: 1, createdAt: -1 });
MigrationSessionSchema.index({ tenantId: 1, status: 1 });

export const getMigrationSessionModel = (conn = mongoose) =>
  conn.models["MigrationSession"] ?? conn.model("MigrationSession", MigrationSessionSchema);

export default getMigrationSessionModel();
