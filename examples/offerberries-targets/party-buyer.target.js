// examples/offerberries-targets/party-buyer.target.js
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
  namespace: "businessops", entityKey: "party_buyer", label: "Buyer", icon: "Users",
  destination: "/finance/parties",
  fields: [
    { key: "externalId", label: "External ID", type: "string", required: true, aliases: ["id", "externalid", "external id"] },
    { key: "name", label: "Name", type: "string", required: true, aliases: ["business name", "company name", "full name"] },
    { key: "email", label: "Email", type: "string", required: false, aliases: ["e-mail", "email address"] },
    { key: "phone", label: "Phone", type: "string", required: false, aliases: ["phone number", "mobile", "contact number"] },
    { key: "city", label: "City", type: "string", required: false, aliases: [] },
    { key: "status", label: "Status", type: "string", required: false, aliases: [] },
  ],
  identityField: "externalId", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    const idType = await resolvePartyIdType(tenantId, "buyer", conn);
    const c = identityValues.map((v) => { try { return coerceFieldValue(idType, v, "External ID"); } catch { return null; } }).filter((v) => v != null);
    if (!c.length) return new Set();
    const existing = await getPartyModel(conn).find({ tenantId, partyType: "buyer", externalId: { $in: c } }).distinct("externalId");
    return new Set(existing.map(String));
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const idType = await resolvePartyIdType(tenantId, "buyer", conn);
    if (!mappedFields.externalId) throw commitErr('"External ID" is required for a buyer row');
    const externalId = coerceFieldValue(idType, mappedFields.externalId, "External ID");
    if (!mappedFields.name) throw commitErr('"Name" is required for a buyer row');
    const party = await createParty(tenantId, {
      partyType: "buyer", externalId, name: mappedFields.name,
      email: mappedFields.email ?? null, phone: mappedFields.phone ?? null,
      city: mappedFields.city ?? null, status: mappedFields.status || "approved",
    }, conn, session);
    return { entityId: party._id, entityModel: "Party" };
  },
});
