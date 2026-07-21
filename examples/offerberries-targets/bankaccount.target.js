// examples/offerberries-targets/bankaccount.target.js
// OfferBerries reference — imports OfferBerries models. Requires OfferBerries project context.
// @ts-nocheck
import mongoose from "mongoose";
import { getBankAccountModel } from "#finance";
import { registerTarget } from "../../registry/registerTarget.js";

registerTarget({
  namespace: "finance", entityKey: "bankaccount", label: "Bank Account", icon: "Landmark", destination: "/finance/wallets",
  fields: [
    { key: "bankName", label: "Bank Name", type: "string", required: true, aliases: ["bank"] },
    { key: "accountTitle", label: "Account Title", type: "string", required: true, aliases: ["title", "account name"] },
    { key: "iban", label: "IBAN", type: "string", required: false, aliases: [] },
    { key: "accountNumber", label: "Account Number", type: "string", required: false, aliases: ["number", "acc #"] },
    { key: "branchCode", label: "Branch Code", type: "string", required: false, aliases: ["branch", "code"] },
    { key: "currency", label: "Currency", type: "string", required: true, aliases: [] },
  ],
  identityField: "accountNumber", commitInTransaction: true, dependencies: [],
  findExistingIdentities: async (tenantId, identityValues, conn = mongoose) => {
    if (!identityValues.length) return new Set();
    const BankAccount = getBankAccountModel(conn);
    const existing = await BankAccount.find({ tenantId, accountNumber: { $in: identityValues } }).distinct("accountNumber");
    return new Set(existing);
  },
  commitRow: async (tenantId, mappedFields, { conn = mongoose, session = null } = {}) => {
    const BankAccount = getBankAccountModel(conn);
    const doc = { tenantId, bankName: mappedFields.bankName, accountTitle: mappedFields.accountTitle, iban: mappedFields.iban ?? null, accountNumber: mappedFields.accountNumber ?? null, branchCode: mappedFields.branchCode ?? null, currency: mappedFields.currency, status: "active" };
    const account = session ? (await BankAccount.create([doc], { session }))[0] : await BankAccount.create(doc);
    return { entityId: account._id, entityModel: "BankAccount" };
  },
});
