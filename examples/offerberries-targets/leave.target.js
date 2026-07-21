// examples/offerberries-targets/leave.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getFinalizedEmployeeModel } from "#sharedModels/FinalizedEmployees.model";
import { getLeaveRecordModel } from "#hr";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "hr", entityKey: "leave", label: "Leave", icon: "Palmtree", destination: "/hr/leave-applications",
  fields: [
    { key: "employeeEmail", label: "Employee Email", type: "string", required: true, aliases: ["email", "official email", "employee"] },
    { key: "leaveType", label: "Leave Type", type: "string", required: true, aliases: ["type"] },
    { key: "leaveReason", label: "Reason", type: "string", required: false, aliases: ["reason", "notes"] },
    { key: "leaveStartDate", label: "Start Date", type: "date", required: true, aliases: ["start date", "from", "start"] },
    { key: "leaveEndDate", label: "End Date", type: "date", required: true, aliases: ["end date", "to", "end"] },
  ],
  identityField: "_skip_dedup", commitInTransaction: true, dependencies: ["employee"],
  referenceFields: ["employeeEmail"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const emails = distinctValuesByKey.employeeEmail ?? [];
    if (!emails.length) return { employeeEmail: new Map() };
    const employees = await getFinalizedEmployeeModel(conn).find({ tenantId, officialEmail: { $in: emails } }).select("officialEmail").lean();
    return { employeeEmail: new Map(employees.map((e) => [e.officialEmail, e])) };
  },
  findExistingIdentities: async () => new Set(),
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const employee = await getFinalizedEmployeeModel(conn).findOne({ tenantId, officialEmail: mappedFields.employeeEmail }).select("_id").lean();
    if (!employee) throw commitErr(`Employee with email "${mappedFields.employeeEmail}" not found`);
    if (mappedFields.leaveEndDate < mappedFields.leaveStartDate) throw commitErr('"End Date" is before "Start Date"');
    const doc = { tenantId, employeeId: employee._id, leaveType: mappedFields.leaveType, leaveReason: mappedFields.leaveReason ?? null, startDate: mappedFields.leaveStartDate, endDate: mappedFields.leaveEndDate, status: "taken", importedFromMigration: true };
    const record = session ? (await getLeaveRecordModel(conn).create([doc], { session }))[0] : await getLeaveRecordModel(conn).create(doc);
    return { entityId: record._id, entityModel: "LeaveRecord" };
  },
});
