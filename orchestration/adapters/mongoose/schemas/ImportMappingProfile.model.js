// models/SharedModels/ImportMappingProfile.model.js
// Migration Wizard — full build (Party Model Standardization "Phase 6",
// MIGRATION_WIZARD_PLAN_2026-07-07.md §4 step 5, §9's "mapping persistence"
// open question — resolved: yes, persist, reusable, multiple named profiles
// per entity).
//
// A saved column-name -> target-field-key translation for one
// (tenant, module, entityKey), so a client re-importing the same export
// format next month doesn't re-map from scratch.
//
// Distinct from PartyRoleMappingProfile.model.js (Party Plan Phase 4): that
// one translates a B2B integrator's field names to Party *role keys* for
// live event ingestion, scoped to a B2BCredential. This one translates a
// spreadsheet's columns to arbitrary *target schema field paths* for the
// wizard's human-driven GUI upload flow — no B2BCredential involved, a
// different bounded context. Don't merge them.
import mongoose from "mongoose";

const { Schema } = mongoose;

const ImportMappingProfileSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      "Tenant",
      required: true,
      index:    true,
    },

    module:    { type: String, required: true }, // "hr" | "businessops" (see importTargetRegistry.service.js)
    entityKey: { type: String, required: true }, // "employee" | "party_seller" | "party_buyer" | "party_shipper"

    label: { type: String, required: true }, // e.g. "Shopify export", "Old ERP export"

    // sourceColumn (as it appears in the uploaded file's header row) ->
    // targetFieldKey (as importTargetRegistry's field descriptors know it).
    fieldMap: {
      type:     Map,
      of:       String,
      required: true,
    },

    createdBy: {
      type:    Schema.Types.ObjectId,
      ref:     "FinalizedEmployee",
      default: null,
    },
  },
  { timestamps: true }
);

// Multiple named profiles per (tenant, module, entityKey) are allowed on
// purpose — a tenant with two different legacy source systems needs two
// profiles for the same target entity.
ImportMappingProfileSchema.index({ tenantId: 1, module: 1, entityKey: 1, label: 1 }, { unique: true });

export const getImportMappingProfileModel = (conn = mongoose) =>
  conn.models["ImportMappingProfile"] ?? conn.model("ImportMappingProfile", ImportMappingProfileSchema);

export default getImportMappingProfileModel();
