// examples/offerberries-targets/cycle.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getCycleModel } from "#biz";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "businessops", entityKey: "cycle", label: "Cycle", icon: "RefreshCw", destination: "/finance/reports",
  fields: [
    { key: "name", label: "Cycle Name", type: "string", required: true, aliases: ["cycle", "period"] },
    { key: "startDate", label: "Start Date", type: "date", required: true, aliases: ["start", "from"] },
    { key: "endDate", label: "End Date", type: "date", required: true, aliases: ["end", "to"] },
    { key: "description", label: "Description", type: "string", required: false, aliases: ["desc"] },
    { key: "type", label: "Type", type: "string", required: false, aliases: [] },
    { key: "status", label: "Status", type: "string", required: false, aliases: [] },
  ],
  identityField: "name", commitInTransaction: true, dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const Cycle = getCycleModel(conn);
    const existing = await Cycle.find({ tenantId, name: { $in: identityValues } }).distinct("name");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const Cycle = getCycleModel(conn);
    const doc = { tenantId, name: mappedFields.name, startDate: mappedFields.startDate, endDate: mappedFields.endDate, description: mappedFields.description ?? "", type: mappedFields.type || "custom", status: mappedFields.status || "active" };
    const cycle = session ? (await Cycle.create([doc], { session }))[0] : await Cycle.create(doc);
    return { entityId: cycle._id, entityModel: "Cycle" };
  },
});
