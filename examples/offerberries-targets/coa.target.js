// examples/offerberries-targets/coa.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getSummaryModel, addSummary } from "#finance";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "finance", entityKey: "coa", label: "Chart of Accounts", icon: "BookOpen", destination: "/finance/accounting",
  fields: [
    { key: "accountCode", label: "Account Code", type: "string", required: true, aliases: ["code", "account code"] },
    { key: "name", label: "Account Name", type: "string", required: true, aliases: ["account name", "title"] },
    { key: "accountType", label: "Account Type", type: "string", required: true, aliases: ["type", "account type"] },
    { key: "summaryId", label: "Account Number", type: "number", required: false, aliases: ["number", "account number"] },
    { key: "parentId", label: "Parent Account Number", type: "number", required: false, aliases: ["parent", "parent number"] },
  ],
  identityField: "accountCode", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getSummaryModel(conn).find({ tenantId, accountCode: { $in: identityValues } }).distinct("accountCode");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const summary = await addSummary({ tenantId, accountCode: mappedFields.accountCode, summaryId: mappedFields.summaryId ?? null, name: mappedFields.name, accountType: mappedFields.accountType, parentId: mappedFields.parentId ?? null, actorId, conn });
    return { entityId: summary._id, entityModel: "Summary" };
  },
});
