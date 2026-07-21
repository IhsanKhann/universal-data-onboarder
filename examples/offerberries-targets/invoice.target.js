// examples/offerberries-targets/invoice.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getPartyModel } from "#sharedModels/Party.model";
import { createInvoice } from "#finance";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "finance", entityKey: "invoice", label: "Invoice", icon: "FileText", destination: "/finance/accounting",
  fields: [
    { key: "partyExternalId", label: "Party External ID", type: "string", required: true, aliases: ["party id", "customer id", "supplier id"] },
    { key: "partyType", label: "Party Type", type: "string", required: true, aliases: ["type"] },
    { key: "direction", label: "Direction", type: "string", required: true, aliases: [] },
    { key: "issueDate", label: "Issue Date", type: "date", required: false, aliases: ["date", "invoice date"] },
    { key: "dueDate", label: "Due Date", type: "date", required: true, aliases: ["due", "payment due"] },
    { key: "subtotal", label: "Subtotal", type: "number", required: true, aliases: [] },
    { key: "taxTotal", label: "Tax Total", type: "number", required: false, aliases: ["tax", "vat"] },
    { key: "total", label: "Total", type: "number", required: true, aliases: ["amount", "invoice amount"] },
    { key: "currency", label: "Currency", type: "string", required: false, aliases: [] },
    { key: "notes", label: "Notes", type: "string", required: false, aliases: ["memo", "description"] },
  ],
  identityField: "invoiceNumber", commitInTransaction: true,
  dependencies: ["party_seller", "party_buyer"],
  referenceFields: ["partyExternalId"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const extIds = distinctValuesByKey.partyExternalId ?? [];
    if (!extIds.length) return { partyExternalId: new Map() };
    const parties = await getPartyModel(conn).find({ tenantId, externalId: { $in: extIds } }).select("externalId partyType name").lean();
    return { partyExternalId: new Map(parties.map((p) => [p.externalId, p])) };
  },
  findExistingIdentities: async () => new Set(),
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null, session = null } = {}) => {
    const party = await getPartyModel(conn).findOne({ tenantId, externalId: mappedFields.partyExternalId, partyType: mappedFields.partyType }).lean();
    if (!party) throw commitErr(`Party with externalId "${mappedFields.partyExternalId}" and type "${mappedFields.partyType}" not found`);
    const invoice = await createInvoice(tenantId, { partyId: party._id, partyType: mappedFields.partyType, partyName: party.name ?? null, direction: mappedFields.direction, issueDate: mappedFields.issueDate ?? new Date(), dueDate: mappedFields.dueDate, lineItems: [{ description: `Imported invoice ${mappedFields.direction === "receivable" ? "to" : "from"} ${party.name ?? mappedFields.partyExternalId}`, quantity: 1, unitPrice: mappedFields.total }], subtotal: mappedFields.subtotal, taxTotal: mappedFields.taxTotal ?? 0, total: mappedFields.total, currency: mappedFields.currency ?? "PKR", notes: mappedFields.notes ?? null }, actorId, session, conn);
    return { entityId: invoice._id, entityModel: "Invoice" };
  },
});
