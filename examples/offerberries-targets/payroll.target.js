// examples/offerberries-targets/payroll.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getFinalizedEmployeeModel } from "#sharedModels/FinalizedEmployees.model";
import { getRoleAssignmentModel } from "#sharedModels/RoleAssignment.model";
import { getSalaryBreakupModel } from "#finance";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "hr", entityKey: "payroll", label: "Payroll", icon: "Banknote", destination: "/finance/salaries",
  fields: [
    { key: "employeeEmail", label: "Employee Email", type: "string", required: true, aliases: ["email", "official email", "employee"] },
    { key: "month", label: "Month", type: "string", required: true, aliases: ["pay month"] },
    { key: "year", label: "Year", type: "number", required: true, aliases: ["pay year"] },
    { key: "baseSalary", label: "Base Salary", type: "number", required: true, aliases: ["salary", "basic"] },
    { key: "paymentStatus", label: "Payment Status", type: "string", required: false, aliases: ["status"] },
  ],
  identityField: "_skip_dedup", dependencies: ["employee", "role"],
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
    const RoleAssignment = getRoleAssignmentModel(conn);
    const roleAssignment = await RoleAssignment.findOne({ employeeId: employee._id, isActive: true }).lean();
    const SalaryBreakup = getSalaryBreakupModel(conn);
    const breakup = await SalaryBreakup.create({
      employeeId: employee._id, roleId: roleAssignment?.roleId ?? null,
      month: mappedFields.month, year: mappedFields.year,
      salaryRules: { baseSalary: mappedFields.baseSalary, salaryType: "monthly", currency: "PKR", allowances: [], deductions: [], terminalBenefits: [] },
      calculatedBreakup: {}, paymentStatus: mappedFields.paymentStatus || "pending", tenantId,
    });
    return { entityId: breakup._id, entityModel: "SalaryBreakupfiles" };
  },
});
