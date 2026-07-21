// examples/offerberries-targets/budgetallocation.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getWalletModel, getBudgetAllocationModel } from "#finance";
import { registerTarget } from "../../registry/registerTarget.js";
const commitErr = (m, c = 400) => Object.assign(new Error(m), { statusCode: c });

const BUDGET_CATEGORIES = ["salary", "seller_payout", "shipper_payout", "expense", "tax", "marketing", "general", "refund"];
const budgetStatusForPeriod = (periodStart, periodEnd, now = new Date()) => {
  if (periodEnd < now) return "closed";
  if (periodStart > now) return "scheduled";
  return "active";
};

registerTarget({
  namespace: "finance", entityKey: "budgetallocation", label: "Budget Allocation", icon: "PieChart", destination: "/finance/accounting",
  fields: [
    { key: "category", label: "Category", type: "string", required: true, aliases: [], enum: BUDGET_CATEGORIES, helper: `One of: ${BUDGET_CATEGORIES.join(", ")}` },
    { key: "walletName", label: "Wallet", type: "string", required: true, aliases: ["wallet", "wallet name", "account", "wallet id"] },
    { key: "periodStart", label: "Period Start", type: "date", required: true, aliases: ["start", "start date", "from"] },
    { key: "periodEnd", label: "Period End", type: "date", required: true, aliases: ["end", "end date", "to"] },
    { key: "allocatedPaise", label: "Allocated Amount", type: "number", required: true, aliases: ["allocated", "budget", "amount"] },
    { key: "notes", label: "Notes", type: "string", required: false, aliases: ["desc", "description"] },
  ],
  identityField: "_skip_dedup", commitInTransaction: true, dependencies: [],
  referenceFields: ["walletName"],
  resolveReferences: async (tenantId, distinctValuesByKey, conn = mongoose) => {
    const names = distinctValuesByKey.walletName ?? [];
    if (!names.length) return { walletName: new Map() };
    const wallets = await getWalletModel(conn).find({ tenantId, name: { $in: names } }).select("name").lean();
    return { walletName: new Map(wallets.map((w) => [w.name, w])) };
  },
  findExistingIdentities: async () => new Set(),
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const wallet = await getWalletModel(conn).findOne({ tenantId, name: mappedFields.walletName }).select("_id").lean();
    if (!wallet) throw commitErr(`Wallet "${mappedFields.walletName}" not found`);
    const allocatedPaise = Math.round(Number(mappedFields.allocatedPaise));
    if (!Number.isInteger(Number(mappedFields.allocatedPaise))) throw commitErr(`"Allocated Amount" must be an integer in paise, got ${mappedFields.allocatedPaise}`);
    if (mappedFields.periodEnd < mappedFields.periodStart) throw commitErr('"Period End" is before "Period Start"');
    const doc = { tenantId, category: mappedFields.category, walletId: wallet._id, periodStart: mappedFields.periodStart, periodEnd: mappedFields.periodEnd, allocatedPaise, spentPaise: 0, reservedPaise: 0, status: budgetStatusForPeriod(mappedFields.periodStart, mappedFields.periodEnd), notes: mappedFields.notes ?? null };
    const allocation = session ? (await getBudgetAllocationModel(conn).create([doc], { session }))[0] : await getBudgetAllocationModel(conn).create(doc);
    return { entityId: allocation._id, entityModel: "BudgetAllocation" };
  },
});
