# Target Descriptor Authoring Guide

## What is a Target Descriptor?

A Target Descriptor is a plain JavaScript object that tells the engine how to
validate, map, and commit rows for one entity type. The engine has **no idea**
what a Party, Employee, or Invoice is — it only knows how to call `validateRow`
and `commitRow` on the descriptor you register.

## Interface

```typescript
interface TargetDescriptor {
  // Unique identifier
  namespace: string;           // e.g. "hr", "finance", "crm"
  entityKey: string;           // e.g. "employee", "invoice" — unique within namespace

  // Field schema (for mapping UI + validation)
  fields: FieldSpec[];

  // Idempotency
  uniqueKey?: string;          // natural-key field for dedup

  // Transaction control
  commitInTransaction?: boolean;

  // Row-level validation (optional — return false to reject)
  validateRow?(row: Record<string, any>, ctx: { conn: unknown }): Promise<boolean> | boolean;

  // Row commit (required — the actual insert/update)
  commitRow(
    tenantId: string,
    mappedFields: Record<string, any>,
    ctx: { conn: unknown; actorId?: string | null; session?: unknown }
  ): Promise<{ entityId: string; entityModel: string }>;
}
```

## FieldSpec

```typescript
interface FieldSpec {
  key: string;          // Machine key (snake_case)
  label: string;        // Human label (Title Case)
  type: "string" | "number" | "boolean" | "date" | "enum";
  required?: boolean;   // Is this field mandatory?
  options?: string[];   // For enum types — allowed values
}
```

## Example: Test Product

```javascript
// targets/testProduct.target.js
export const testProductDescriptor = {
  namespace: "demo",
  entityKey: "product",
  fields: [
    { key: "name", label: "Product Name", type: "string", required: true },
    { key: "sku",  label: "SKU",          type: "string", required: true },
    { key: "price", label: "Price",       type: "number", required: true },
  ],
  uniqueKey: "sku",
  validateRow(row) {
    return row.price > 0;
  },
  async commitRow(tenantId, fields, ctx) {
    const product = { _id: fields.sku, ...fields, createdAt: new Date() };
    products.push(product);
    return { entityId: fields.sku, entityModel: "product" };
  },
};
```

Then register it:

```javascript
import { registerTarget } from "@offerberries/universal-data-onboarder/registry/registerTarget";
registerTarget(testProductDescriptor);
```

## Real-World Example (OfferBerries Party)

See `examples/offerberries-targets/party.target.js` for a full descriptor that
commits to a Mongoose model with transaction support, natural-key dedup via
`partyExt.externalId + tenantId`, and tenant-isolated connection resolution.
