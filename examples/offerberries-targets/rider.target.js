// examples/offerberries-targets/rider.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getFinalizedEmployeeModel } from "#sharedModels/FinalizedEmployees.model";
import { getRiderModel } from "#biz";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "businessops", entityKey: "rider", label: "Rider", icon: "Bike", destination: "/ops/overview",
  fields: [
    { key: "riderId", label: "Rider ID", type: "string", required: true, aliases: ["id", "rider"] },
    { key: "employeeEmail", label: "Employee Email", type: "string", required: false, aliases: ["email", "employee"] },
    { key: "vehicleType", label: "Vehicle Type", type: "string", required: false, aliases: ["vehicle"] },
    { key: "assignedZone", label: "Assigned Zone", type: "string", required: false, aliases: ["zone", "area"] },
    { key: "status", label: "Status", type: "string", required: false, aliases: [] },
  ],
  identityField: "riderId", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const Rider = getRiderModel(conn);
    const existing = await Rider.find({ tenantId, riderId: { $in: identityValues } }).distinct("riderId");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    let employeeId = null;
    if (mappedFields.employeeEmail) {
      const emp = await getFinalizedEmployeeModel(conn).findOne({ tenantId, officialEmail: mappedFields.employeeEmail }).lean();
      if (emp) employeeId = emp._id;
    }
    const Rider = getRiderModel(conn);
    const rider = await Rider.create({
      tenantId, riderId: mappedFields.riderId, employeeId,
      vehicleType: mappedFields.vehicleType ?? null, assignedZone: mappedFields.assignedZone ?? null,
      status: mappedFields.status || "available",
    });
    return { entityId: rider._id, entityModel: "Rider" };
  },
});
