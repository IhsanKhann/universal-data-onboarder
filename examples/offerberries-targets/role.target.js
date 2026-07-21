// examples/offerberries-targets/role.target.js
// OfferBerries reference implementation — imports OfferBerries models.
//
// NOTE: This file uses OfferBerries Node subpath imports (#sharedModels/, #sharedServices/)
// and will ONLY work within the OfferBerries backend (Backend A) project context
// where those aliases are defined in package.json. When consuming this engine
// from a different project, provide your own descriptor implementations or
// configure equivalent import maps.
// @ts-nocheck
import mongoose from "mongoose";
import { getRoleModel } from "#sharedModels/Role.model";
import { createRole } from "#sharedServices/role.service";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "shared",
  entityKey: "role",
  label: "Role",
  icon: "UserCog",
  destination: "/hr/people",
  fields: [
    { key: "roleName",    label: "Role Name",    type: "string", required: true,  aliases: ["name", "job title"] },
    { key: "description", label: "Description",  type: "string", required: false, aliases: ["desc"] },
    { key: "category",    label: "Category",      type: "string", required: false, aliases: [] },
    { key: "baseSalary",  label: "Base Salary",   type: "number", required: true,  aliases: ["salary", "basic salary"] },
    { key: "salaryType",  label: "Salary Type",   type: "string", required: false, aliases: ["pay type"] },
  ],
  identityField: "roleName",
  dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getRoleModel(conn).find({ tenantId, roleName: { $in: identityValues } }).distinct("roleName");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const meta = { actorId, ip: "127.0.0.1", userAgent: "migration-wizard" };
    const role = await createRole({
      roleName: mappedFields.roleName,
      description: mappedFields.description ?? "",
      category: mappedFields.category ?? "Staff",
      salaryRules: {
        baseSalary: mappedFields.baseSalary,
        salaryType: mappedFields.salaryType || "monthly",
        allowances: [], deductions: [], terminalBenefits: [],
      },
      permissions: [],
    }, meta, tenantId, conn);
    return { entityId: role._id, entityModel: "Role" };
  },
});
