# Universal Data Onboarding Engine — Build Rules

## Core Commands

```bash
# Engine tests (Jest)
npm test

# Testbed e2e tests (native, no build step)
cd ../universal-data-onboarder-testbed && npm run test:native

# React UI dev server
cd packages/react-ui && npm run dev

# VitePress docs dev server
cd docs-site && npm run docs:dev

# Full build (docs + react-ui)
npm run build:docs && cd packages/react-ui && npm run build
```

## Architecture

```
core/              → Pure engine: guardrail, parsing, mapping, validation, commit
registry/          → Generic TargetDescriptor registration/lookup
orchestration/     → JobStore interface + session management
queueing/          → QueueAdapter interface + BullMQ/in-memory adapters
storage/           → StorageAdapter interface + GCS/local-fs adapters
topology/          → ConnectionResolver interface + single/multi-tenant adapters
http/              → Express upload routes + Swagger UI
worker/            → Composition roots + pipeline orchestration
packages/react-ui/ → React import wizard demo (deployed to /demo/)
```

## Adapter Interface Pattern

Every external dependency (database, queue, storage, connection) is an injected
interface. Swap by changing env vars:
- `JOB_STORE_ADAPTER` — mongoose | in-memory
- `QUEUE_ADAPTER` — bullmq | in-memory
- `STORAGE_ADAPTER` — gcs | local-fs
- `CONNECTION_ADAPTER` — mongoose-tenant | single

## Critical Rules

1. **No OfferBerries domain knowledge in `core/`.** Grep for `party`, `employee`,
   `invoice` etc. must return zero matches outside `examples/`.
2. **Adapters before implementations.** All five interfaces were designed before
   any implementation code.
3. **`package-lock.json` is gitignored.** Use `npm install` (not `npm ci`) in CI,
   and never commit the lock file.
4. **Branch protection on master** requires CI checks + PR review.
5. **Idempotent commit** via natural-key dedup + status-gated resumability.

## Deployment

- GitHub Pages at `https://ihsankhann.github.io/universal-data-onboarder/`
  - Docs at `/`
  - React UI demo at `/demo/`
- npm: `@offerberries/universal-data-onboarder` (tag-triggered publish)
- Branch: `master` (protected) → PRs only
