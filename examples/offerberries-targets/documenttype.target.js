// examples/offerberries-targets/documenttype.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getDocumentTypeModel } from "#sharedModels/DocumentType.model";
import { createDocumentType } from "#communication";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "communication", entityKey: "documenttype", label: "Document Type", icon: "FileText", destination: "/governance/documents",
  fields: [
    { key: "name", label: "Type Name", type: "string", required: true, aliases: ["type", "document type", "doctype"] },
    { key: "description", label: "Description", type: "string", required: false, aliases: ["desc"] },
    { key: "isRequired", label: "Is Required", type: "boolean", required: false, aliases: ["required", "mandatory"] },
    { key: "appliesTo", label: "Applies To", type: "string", required: false, aliases: ["scope", "applies"] },
  ],
  identityField: "name", dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const existing = await getDocumentTypeModel(conn).find({ tenantId, name: { $in: identityValues } }).distinct("name");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const docType = await createDocumentType({ name: mappedFields.name, description: mappedFields.description ?? "", isRequired: mappedFields.isRequired ?? false, appliesTo: mappedFields.appliesTo ? [mappedFields.appliesTo] : [], tenantId }, conn);
    return { entityId: docType._id, entityModel: "DocumentType" };
  },
});
