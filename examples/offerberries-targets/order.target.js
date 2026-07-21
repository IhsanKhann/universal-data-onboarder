// examples/offerberries-targets/order.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getPartyModel } from "#sharedModels/Party.model";
import { getOrderModel } from "#biz";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

registerTarget({
  namespace: "businessops", entityKey: "order", label: "Order", icon: "ShoppingCart", destination: "/finance/transactions",
  fields: [
    { key: "OrderId", label: "Order ID", type: "string", required: true, aliases: ["order id", "id"] },
    { key: "sellerExternalId", label: "Seller External ID", type: "string", required: true, aliases: ["seller", "seller id"] },
    { key: "buyerExternalId", label: "Buyer External ID", type: "string", required: true, aliases: ["buyer", "buyer id"] },
    { key: "transaction_type", label: "Transaction Type", type: "string", required: true, aliases: ["type", "transaction"] },
    { key: "order_total_amount", label: "Order Total", type: "number", required: true, aliases: ["total", "amount"] },
    { key: "currency", label: "Currency", type: "string", required: false, aliases: [] },
    { key: "placed_at", label: "Order Date", type: "date", required: false, aliases: ["date", "order date"] },
    { key: "shipmentAmount", label: "Shipment Amount", type: "number", required: false, aliases: ["shipping", "delivery charge"] },
  ],
  identityField: "OrderId", dependencies: ["party_seller", "party_buyer"],
  referenceFields: ["sellerExternalId", "buyerExternalId"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const allIds = [...new Set([...(distinctValuesByKey.sellerExternalId ?? []), ...(distinctValuesByKey.buyerExternalId ?? [])])];
    if (!allIds.length) return { sellerExternalId: new Map(), buyerExternalId: new Map() };
    const parties = await getPartyModel(conn).find({ tenantId, partyType: { $in: ["seller", "buyer"] }, externalId: { $in: allIds } }).select("externalId partyType").lean();
    return {
      sellerExternalId: new Map(parties.filter((p) => p.partyType === "seller").map((p) => [p.externalId, p])),
      buyerExternalId: new Map(parties.filter((p) => p.partyType === "buyer").map((p) => [p.externalId, p])),
    };
  },
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const Order = getOrderModel(conn);
    const existing = await Order.find({ tenantId, OrderId: { $in: identityValues } }).distinct("OrderId");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, actorId = null } = {}) => {
    const parties = await getPartyModel(conn).find({ tenantId, externalId: { $in: [mappedFields.sellerExternalId, mappedFields.buyerExternalId] } }).lean();
    const seller = parties.find((p) => String(p.externalId) === String(mappedFields.sellerExternalId) && p.partyType === "seller");
    const buyer = parties.find((p) => String(p.externalId) === String(mappedFields.buyerExternalId) && p.partyType === "buyer");
    if (!seller) throw commitErr(`Seller with externalId "${mappedFields.sellerExternalId}" not found`);
    if (!buyer) throw commitErr(`Buyer with externalId "${mappedFields.buyerExternalId}" not found`);
    const Order = getOrderModel(conn);
    const order = await Order.create({ tenantId, OrderId: mappedFields.OrderId, sellerPartyId: seller._id, buyerPartyId: buyer._id, transaction_type: mappedFields.transaction_type, order_total_amount: mappedFields.order_total_amount, currency: mappedFields.currency || "PKR", placed_at: mappedFields.placed_at || new Date(), status: "pending", orderStatus: "pending", shipmentAmount: mappedFields.shipmentAmount || 0, items: [] });
    return { entityId: order._id, entityModel: "Order" };
  },
});
