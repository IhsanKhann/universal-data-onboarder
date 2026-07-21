// examples/offerberries-targets/branch.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getBranchModel } from "#sharedModels/BranchModel";
import { createBranch } from "#hr";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "shared", entityKey: "branch", label: "Branch", icon: "MapPin", destination: "/hr/people",
  fields: [
    { key: "name", label: "Branch Name", type: "string", required: true, aliases: ["name", "office"] },
    { key: "code", label: "Branch Code", type: "string", required: true, aliases: ["code", "branch code"] },
    { key: "city", label: "City", type: "string", required: false, aliases: [] },
    { key: "address", label: "Address", type: "string", required: false, aliases: [] },
    { key: "branchType", label: "Branch Type", type: "string", required: false, aliases: ["type"] },
  ],
  identityField: "code", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getBranchModel(conn).find({ tenantId, code: { $in: identityValues.map((v) => v.toUpperCase()) } }).distinct("code");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const meta = { actorId, ip: "127.0.0.1", userAgent: "migration-wizard" };
    const branch = await createBranch({
      name: mappedFields.name, code: mappedFields.code,
      location: { city: mappedFields.city ?? "", address: mappedFields.address ?? "", state: "", country: "", postalCode: "" },
      branchType: mappedFields.branchType || "Local",
    }, meta, tenantId, conn);
    return { entityId: branch._id, entityModel: "Branch" };
  },
});
