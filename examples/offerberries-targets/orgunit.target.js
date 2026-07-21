// examples/offerberries-targets/orgunit.target.js
// OfferBerries reference implementation — imports OfferBerries models.
//
// NOTE: This file uses OfferBerries Node subpath imports (#offerberries-models/, #offerberries-services/)
// and will ONLY work within the OfferBerries backend (Backend A) project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getOrgUnitModel } from "#sharedModels/OrgUnit";
import { createOrgUnit } from "#sharedServices/orgUnit.service";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "shared",
  entityKey: "orgunit",
  label: "Org Unit",
  icon: "Building2",
  destination: "/hr/people",
  fields: [
    { key: "name",           label: "Org Unit Name",  type: "string", required: true,  aliases: ["name", "org unit", "organization unit"] },
    { key: "type",           label: "Type",           type: "string", required: true,  aliases: [] },
    { key: "departmentCode", label: "Department Code", type: "string", required: true, aliases: ["department", "dept"] },
    { key: "parentName",     label: "Parent Org Unit", type: "string", required: false, aliases: ["parent", "parent org"] },
  ],
  identityField: "name",
  dependencies: [],
  referenceFields: ["parentName"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const parentValues = distinctValuesByKey.parentName ?? [];
    if (!parentValues.length) return { parentName: new Map() };
    const parents = await getOrgUnitModel(conn).find({ tenantId, name: { $in: parentValues } }).select("name _id").lean();
    return { parentName: new Map(parents.map((p) => [p.name, p])) };
  },
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getOrgUnitModel(conn).find({ tenantId, name: { $in: identityValues } }).distinct("name");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    let parent = null;
    if (mappedFields.parentName) {
      const parentUnit = await getOrgUnitModel(conn).findOne({ tenantId, name: mappedFields.parentName }).lean();
      if (parentUnit) parent = parentUnit._id;
    }
    const result = await createOrgUnit({
      name: mappedFields.name, type: mappedFields.type, departmentCode: mappedFields.departmentCode,
      parent, branchId: null, metadata: {}, fullPath: null,
    }, actorId, "127.0.0.1", "migration-wizard", tenantId, conn);
    return { entityId: result.data._id, entityModel: "OrgUnit" };
  },
});
