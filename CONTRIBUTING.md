# Contributing to Universal Data Onboarding Engine

## How to add a new adapter

1. Define the interface shape in the relevant `*Adapter.js` file (e.g. `queueing/QueueAdapter.js`)
2. Create your implementation in `queueing/adapters/yourAdapter.js`
3. Re-export from the interface file
4. Write a contract test in `core/__contract-tests__/` that runs the same assertions against your adapter and the existing reference adapter

## How to add a new target descriptor

Target descriptors describe an entity type the engine can import. See `examples/offerberries-targets/` for 18 real-world examples.

```js
import { registerTarget } from "./registry/registerTarget.js";

registerTarget({
  namespace: "crm",
  entityKey: "contact",
  fields: [
    { key: "name", label: "Full Name", type: "string", required: true },
    { key: "email", label: "Email", type: "string", required: true },
  ],
  uniqueKey: "email",
  async commitRow(tenantId, mappedFields, ctx) {
    // Write to your database
    return { entityId: "...", entityModel: "Contact" };
  },
});
```

## PR process

1. Feature branches off `main`
2. PRs must include tests (new adapter? add contract test. new target? prove it works.)
3. CI must pass (runs Jest + native test runner)
4. Update `docs/` if the public API changed

## Development setup

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder.git
cd universal-data-onboarder
npm install
# For the testbed:
cd ../universal-data-onboarder-testbed
npm install
node tests/e2e-native-runner.mjs
```
