// models/SharedModels/ImportStagedRecord.model.js
// Migration Wizard — full build (Party Model Standardization "Phase 6",
// MIGRATION_WIZARD_PLAN_2026-07-07.md §7). One document per source row, held
// in the staging area described in plan §5 ("nothing here is 'real' data
// yet") until it's committed to a real business model.
//
// `rawRow` is the parsed row exactly as it arrived — never mutated, so
// re-mapping always has the untouched source to re-derive from. `customFields`
// starts as a byte-for-byte copy of `rawRow`; the mapping step
// (importMapping.service.js) narrows it down to only the columns that were
// NOT matched to a target field, moving matched values into `mappedFields`
// instead — exactly the "narrows down as columns get matched" behavior this
// header always described, now implemented.
import mongoose from "mongoose";

const { Schema } = mongoose;

const ImportStagedRecordSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      "Tenant",
      required: true,
      index:    true,
    },

    importJobId: {
      type:     Schema.Types.ObjectId,
      ref:      "ImportJob",
      required: true,
      index:    true,
    },

    rowIndex: { type: Number, required: true }, // 0-based position in the source file

    rawRow:      { type: Schema.Types.Mixed, required: true },
    customFields: { type: Schema.Types.Mixed, required: true },

    // Populated by the mapping step: resolved target-field values, keyed by
    // the target schema's field key (e.g. { name: "Acme Store", externalId:
    // "V-1001" }). Empty object until mapping runs.
    mappedFields: { type: Schema.Types.Mixed, default: {} },

    // The entity's external identity value extracted from mappedFields after
    // mapping, for use in multi-job migration sessions. Populated by the
    // session-aware mapping step (or left null for standalone jobs).
    // Example: for a Party seller, this would be "SEL-001" (the mapped
    // externalId); for an employee it's the officialEmail.
    // Indexed together with tenantId + entityKey so session-scoped
    // reference resolution ("find the OrgUnit with externalId X in this
    // session") stays efficient.
    externalId: { type: String, default: null },

    // Which entity type this staged row represents, populated when the
    // target entityKey is resolved during mapping. Used together with
    // externalId for session-scoped cross-referencing.
    entityKey: { type: String, default: null },

    validationStatus: {
      type: String,
      enum: ["unvalidated", "valid", "invalid"],
      default: "unvalidated",
    },
    validationErrors: { type: [String], default: [] },

    // Commit outcome — distinct from validationStatus: a row can be "valid"
    // at validation time and still fail at commit time for an unrelated
    // reason (e.g. HR's required-document check, a DB error). See Phase 6
    // plan's note on submitEmployee's document requirement.
    // "committing" is the crash-recovery marker: a row is flipped to
    // "committing" the instant BEFORE its non-transactional commitRow runs, so a
    // process that dies mid-write leaves the row here (not "pending"). On re-run,
    // a "committing" row whose write throws a duplicate-key error is recognised
    // as its OWN prior partial write (idempotent success) rather than a genuine
    // in-file duplicate — that distinction is the whole point of the marker. See
    // importCommit.service.js::commitBatch. Transaction-path descriptors never
    // use it (the transaction makes the entity write and the status flip atomic).
    commitStatus: {
      type:    String,
      enum:    ["pending", "committing", "committed", "skipped", "failed"],
      default: "pending",
    },
    committedEntityId: {
      type:    Schema.Types.ObjectId,
      default: null,
    },
    committedEntityModel: {
      type:    String, // "Party" | "FinalizedEmployee" — lets the review UI link to the real record
      default: null,
    },
    commitError: { type: String, default: null },
  },
  { timestamps: true }
);

ImportStagedRecordSchema.index({ importJobId: 1, rowIndex: 1 }, { unique: true });
ImportStagedRecordSchema.index({ tenantId: 1, importJobId: 1 });
// Commit worker pagination: fetch valid+pending rows in chunks, and the
// review screen's "show me the invalid ones" filter.
ImportStagedRecordSchema.index({ importJobId: 1, validationStatus: 1, commitStatus: 1 });
// Session-scoped external-ID lookup: find a staged row by entity type and
// external ID, used by session-aware reference resolution (child jobs
// looking up still-staged parent rows within the same migration session).
ImportStagedRecordSchema.index({ importJobId: 1, entityKey: 1, externalId: 1 },
  { sparse: true });

export const getImportStagedRecordModel = (conn = mongoose) =>
  conn.models["ImportStagedRecord"] ?? conn.model("ImportStagedRecord", ImportStagedRecordSchema);

export default getImportStagedRecordModel();
