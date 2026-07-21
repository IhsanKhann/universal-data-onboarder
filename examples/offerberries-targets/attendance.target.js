// examples/offerberries-targets/attendance.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getFinalizedEmployeeModel } from "#sharedModels/FinalizedEmployees.model";
import { markAttendance } from "#hr";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "hr", entityKey: "attendance", label: "Attendance", icon: "Calendar", destination: "/hr/attendance",
  fields: [
    { key: "employeeEmail", label: "Employee Email", type: "string", required: true, aliases: ["email", "official email", "employee"] },
    { key: "date", label: "Date", type: "string", required: true, aliases: ["attendance date", "day"] },
    { key: "status", label: "Status", type: "string", required: true, aliases: [] },
    { key: "checkInTime", label: "Check-in Time", type: "date", required: false, aliases: ["checkin", "clock in"] },
    { key: "checkOutTime", label: "Check-out Time", type: "date", required: false, aliases: ["checkout", "clock out"] },
    { key: "notes", label: "Notes", type: "string", required: false, aliases: [] },
  ],
  identityField: "_skip_dedup", dependencies: ["employee"],
  referenceFields: ["employeeEmail"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const emails = distinctValuesByKey.employeeEmail ?? [];
    if (!emails.length) return { employeeEmail: new Map() };
    const employees = await getFinalizedEmployeeModel(conn).find({ tenantId, officialEmail: { $in: emails } }).select("officialEmail").lean();
    return { employeeEmail: new Map(employees.map((e) => [e.officialEmail, e])) };
  },
  findExistingIdentities: async () => new Set(),
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const employee = await getFinalizedEmployeeModel(conn).findOne({ tenantId, officialEmail: mappedFields.employeeEmail }).lean();
    if (!employee) throw commitErr(`Employee with email "${mappedFields.employeeEmail}" not found`);
    const record = await markAttendance({
      employeeId: employee._id, date: mappedFields.date, status: mappedFields.status,
      checkInTime: mappedFields.checkInTime || null, checkOutTime: mappedFields.checkOutTime || null,
      notes: mappedFields.notes || "", markedBy: "admin", tenantId, conn,
    });
    return { entityId: record._id, entityModel: "Attendance" };
  },
});
