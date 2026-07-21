// examples/offerberries-targets/employee.target.js
// OfferBerries reference implementation — imports OfferBerries models.
//
// NOTE: This file uses OfferBerries Node subpath imports and will ONLY work
// within the OfferBerries backend (Backend A) project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getFinalizedEmployeeModel } from "#sharedModels/FinalizedEmployees.model";
import { getOrgUnitModel } from "#sharedModels/OrgUnit";
import { getRoleModel } from "#sharedModels/Role.model";
import { getBranchModel } from "#sharedModels/BranchModel";
import { registerEmployee, assignEmployeePost, submitEmployee } from "#hr";
import { registerTarget } from "../../registry/registerTarget.js";

const FIELDS = [
  { key: "individualName", label: "Full Name",       type: "string", required: true, aliases: ["name", "employee name"] },
  { key: "fatherName",     label: "Father's Name",   type: "string", required: true, aliases: [] },
  { key: "dob",            label: "Date of Birth",   type: "date",   required: true, aliases: ["date of birth", "birthdate"] },
  { key: "officialEmail",  label: "Official Email",  type: "string", required: true, aliases: ["work email", "company email"] },
  { key: "personalEmail",  label: "Personal Email",  type: "string", required: true, aliases: [] },
  { key: "baseSalary",     label: "Base Salary",     type: "number", required: true, aliases: ["salary"] },
  { key: "roleName",       label: "Role",            type: "string", required: true, aliases: ["job role", "position"] },
  { key: "orgUnitName",    label: "Org Unit",        type: "string", required: true, aliases: ["department", "org unit", "organization unit"] },
  { key: "branchName",     label: "Branch",          type: "string", required: true, aliases: ["office", "location"] },
  { key: "govtId",     label: "Government ID", type: "string", required: false, aliases: ["cnic", "ssn", "national id", "nic"] },
  { key: "passportNo", label: "Passport No",   type: "string", required: false, aliases: ["passport"] },
  { key: "alienRegNo", label: "Alien Reg No",  type: "string", required: false, aliases: ["alien registration", "alien reg"] },
  { key: "city",       label: "City",       type: "string", required: true, aliases: ["town"] },
  { key: "country",    label: "Country",    type: "string", required: true, aliases: [] },
  { key: "contactNo",  label: "Contact No", type: "string", required: true, aliases: ["phone", "mobile", "phone number", "contact number"] },
  { key: "addressLine", label: "Address",   type: "string", required: false, aliases: ["street address", "address line"] },
  { key: "employmentStatus", label: "Employment Status", type: "string", required: false, aliases: ["status", "employment type"] },
  { key: "salaryType",       label: "Salary Type",        type: "string", required: false, aliases: ["pay type"] },
  { key: "salaryStartDate",  label: "Salary Start Date",  type: "date",   required: false, aliases: ["pay start date", "salary effective date"] },
];

registerTarget({
  namespace: "shared",
  entityKey: "employee",
  label: "Employee",
  icon: "Users",
  destination: "/hr/people",
  fields: FIELDS,
  identityField: "officialEmail",
  dependencies: ["orgunit", "role", "branch"],
  referenceFields: ["orgUnitName", "roleName", "branchName"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const [orgUnits, roles, branches] = await Promise.all([
      getOrgUnitModel(conn).find({ tenantId, name: { $in: distinctValuesByKey.orgUnitName ?? [] } }).select("name").lean(),
      getRoleModel(conn).find({ tenantId, roleName: { $in: distinctValuesByKey.roleName ?? [] } }).select("roleName").lean(),
      getBranchModel(conn).find({ tenantId, name: { $in: distinctValuesByKey.branchName ?? [] } }).select("name").lean(),
    ]);
    return {
      orgUnitName: new Map(orgUnits.map((o) => [o.name, o])),
      roleName:    new Map(roles.map((r) => [r.roleName, r])),
      branchName:  new Map(branches.map((b) => [b.name, b])),
    };
  },
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getFinalizedEmployeeModel(conn).find({ tenantId, officialEmail: { $in: identityValues } }).distinct("officialEmail");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const actorMeta = { actorId, ip: "127.0.0.1", userAgent: "migration-wizard" };
    const existingFinal = await getFinalizedEmployeeModel(conn).findOne({
      tenantId, officialEmail: String(mappedFields.officialEmail ?? "").toLowerCase(),
    }).select("_id").lean();
    if (existingFinal) return { entityId: existingFinal._id, entityModel: "FinalizedEmployee" };

    const [orgUnit, role, branch] = await Promise.all([
      getOrgUnitModel(conn).findOne({ tenantId, name: mappedFields.orgUnitName }).lean(),
      getRoleModel(conn).findOne({ tenantId, roleName: mappedFields.roleName }).lean(),
      getBranchModel(conn).findOne({ tenantId, name: mappedFields.branchName }).lean(),
    ]);
    if (!orgUnit) throw Object.assign(new Error(`Org Unit "${mappedFields.orgUnitName}" not found`), { statusCode: 400 });
    if (!role)    throw Object.assign(new Error(`Role "${mappedFields.roleName}" not found`), { statusCode: 400 });
    if (!branch)  throw Object.assign(new Error(`Branch "${mappedFields.branchName}" not found`), { statusCode: 400 });

    const { employeeId } = await registerEmployee({
      body: {
        individualName: mappedFields.individualName, fatherName: mappedFields.fatherName,
        dob: mappedFields.dob, officialEmail: mappedFields.officialEmail,
        personalEmail: mappedFields.personalEmail,
        ...(mappedFields.govtId     ? { govtId:     mappedFields.govtId }     : {}),
        ...(mappedFields.passportNo ? { passportNo: mappedFields.passportNo } : {}),
        ...(mappedFields.alienRegNo ? { alienRegNo: mappedFields.alienRegNo } : {}),
        employmentStatus: mappedFields.employmentStatus || "Permanent",
        address: { ...(mappedFields.addressLine ? { addressLine: mappedFields.addressLine } : {}), city: mappedFields.city, country: mappedFields.country, contactNo: mappedFields.contactNo },
        salary: { baseSalary: mappedFields.baseSalary, type: mappedFields.salaryType || "Initial", startDate: mappedFields.salaryStartDate || new Date() },
      }, files: [], actorMeta, tenantId, conn,
    });
    await assignEmployeePost({ employeeId, roleId: role._id, departmentCode: orgUnit.departmentCode, orgUnit: orgUnit._id, branchId: branch._id, actorMeta, conn });
    const { finalizedEmployeeId } = await submitEmployee({ employeeId, orgUnitId: orgUnit._id, actorMeta, conn });
    return { entityId: finalizedEmployeeId, entityModel: "FinalizedEmployee" };
  },
});
