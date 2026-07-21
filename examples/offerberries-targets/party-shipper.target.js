// examples/offerberries-targets/party-shipper.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { createParty } from "#sharedServices/party.service";
import { getPartyModel } from "#sharedModels/Party.model";
import { getPartyRoleDefinitionModel } from "#sharedModels/PartyRoleDefinition.model";
import { registerTarget } from "../../registry/registerTarget.js";
import { coerceFieldValue } from "../../registry/importTargetRegistry.service.js";

const PARTY_DEFAULT_ID_TYPE = { seller: "string", shipper: "string", buyer: "string" };
const resolvePartyIdType = async (tenantId, partyType, conn) => {
  const roleDef = await getPartyRoleDefinitionModel(conn).findOne({ tenantId, roleKey: partyType }).lean();
  return roleDef?.integration?.idType ?? PARTY_DEFAULT_ID_TYPE[partyType] ?? "string";
};
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "businessops", entityKey: "party_shipper", label: "Shipper", icon: "Truck",
  destination: "/finance/parties",
  fields: [
    { key: "externalId", label: "External ID", type: "string", required: true, aliases: ["id", "externalid", "external id"] },
    { key: "name", label: "Name", type: "string", required: true, aliases: ["business name", "company name", "full name"] },
    { key: "email", label: "Email", type: "string", required: false, aliases: ["e-mail", "email address"] },
    { key: "phone", label: "Phone", type: "string", required: false, aliases: ["phone number", "mobile", "contact number"] },
    { key: "city", label: "City", type: "string", required: false, aliases: [] },
    { key: "status", label: "Status", type: "string", required: false, aliases: [] },
    { key: "shipperType", label: "Shipper Type", type: "string", required: false, aliases: ["type"] },
    { key: "coverage", label: "Coverage", type: "string", required: false, aliases: ["service area"] },
  ],
  identityField: "externalId", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    const idType = await resolvePartyIdType(tenantId, "shipper", conn);
    const c = identityValues.map((v) => { try { return coerceFieldValue(idType, v, "External ID"); } catch { return null; } }).filter((v) => v != null);
    if (!c.length) return new Set();
    const existing = await getPartyModel(conn).find({ tenantId, partyType: "shipper", externalId: { $in: c } }).distinct("externalId");
    return new Set(existing.map(String));
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const idType = await resolvePartyIdType(tenantId, "shipper", conn);
    if (!mappedFields.externalId) throw commitErr('"External ID" is required for a shipper row');
    const externalId = coerceFieldValue(idType, mappedFields.externalId, "External ID");
    if (!mappedFields.name) throw commitErr('"Name" is required for a shipper row');
    const party = await createParty(tenantId, {
      partyType: "shipper", externalId, name: mappedFields.name,
      email: mappedFields.email ?? null, phone: mappedFields.phone ?? null,
      city: mappedFields.city ?? null, status: mappedFields.status || "approved",
      shipperExt: { shipperType: mappedFields.shipperType || "external", coverage: mappedFields.coverage ?? null },
    }, conn, session);
    return { entityId: party._id, entityModel: "Party" };
  },
});
