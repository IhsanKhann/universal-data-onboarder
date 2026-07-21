# Universal Data Onboarding Engine — Architecture

## Layered Design

```
┌─────────────────────────────────────────────────────────┐
│                    examples/                              │
│  offerberries-targets/ (18 real descriptors)              │
│  testbed target (testProduct)                             │
├─────────────────────────────────────────────────────────┤
│                    worker/ + http/                        │
│  cloudRunEntrypoint.js (composition root)                 │
│  importPipeline.js (orchestration)                        │
│  bullmqCommitWorker.js (async commit worker)              │
│  uploadRoutes.js (Express REST routes)                    │
├─────────────────────────────────────────────────────────┤
│          orchestration/ + queueing/ + storage/ + topology/ │
│  jobStore.js (interface) + mongooseJobStore.js (adapter)  │
│  QueueAdapter.js + bullmqAdapter / inMemoryAdapter        │
│  StorageAdapter.js + gcsAdapter / localFsAdapter          │
│  ConnectionResolver.js + mongooseTenant / singleConn      │
├─────────────────────────────────────────────────────────┤
│                    core/ + registry/                      │
│  guardrail/ (size/row ceilings via TierPolicy)            │
│  parsing/ (streaming CSV/JSON/XLSX/SQL parser)            │
│  mapping/ (column→field mapping via TargetDescriptor)     │
│  validation/ (row validation via TargetDescriptor)        │
│  commit/ (idempotent batch commit via commitRow)          │
│  registry/ (generic TargetDescriptor registration/lookup) │
└─────────────────────────────────────────────────────────┘
```

**Rule:** Each layer may only depend on layers below it. `core/` depends on nothing but `registry/` and injected interfaces. `worker/` imports from `core/` and `orchestration/`. `examples/` imports from the registry.

## Adapter Interfaces

The engine is adapter-driven. Every hardcoded OfferBerries reach-out has been replaced with a small interface in its own module.

| Interface | File | Default Adapter | Alternatives |
|---|---|---|---|
| **JobStore** | `orchestration/jobStore.js` | `mongooseJobStore.js` (Mongoose/MongoDB) | — |
| **QueueAdapter** | `queueing/QueueAdapter.js` | `bullmqAdapter.js` (BullMQ/Redis) | `inMemoryAdapter.js` (sync, no Redis) |
| **StorageAdapter** | `storage/StorageAdapter.js` | `localFsAdapter.js` (local fs) | `gcsAdapter.js` (GCS), S3 (future) |
| **ConnectionResolver** | `topology/ConnectionResolver.js` | `singleConnectionAdapter.js` (fixed URI) | `mongooseTenantAdapter.js` (multi-tenant) |
| **TierPolicy** | `core/guardrail/tierPolicy.js` | `envTierPolicy` (env-driven) | `tenantConfigTierPolicy` (DB-driven) |

Swapping adapters requires an env var change only — no code change, no fork.
See `.env.example` for the `*_ADAPTER` variables.

## TargetDescriptor Contract

The engine knows nothing about Parties, Employees, or Invoices. Every entity
type is described by a `TargetDescriptor`:

```typescript
interface TargetDescriptor {
  namespace: string;           // e.g. "hr", "finance", "crm"
  entityKey: string;           // e.g. "employee", "invoice"
  fields: FieldSpec[];         // for mapping/validation UI
  uniqueKey?: string;          // natural key for idempotency
  commitInTransaction?: boolean;
  validateRow?(row): boolean;
  commitRow(tenantId, mappedFields, ctx): Promise<{ entityId, entityModel }>;
}
```

See `registry/TargetDescriptor.d.ts` for the full TypeScript definition.

## Job Lifecycle

```
pending_upload → uploaded → guardrail_rejected
                         → staged → mapped → validated → committing → completed
                                                              → (async) → completed_with_errors
                                                                       → failed
```

Each step gates on the ImportJob's status. A crash mid-pipeline resumes from
the last persisted status rather than restarting (idempotent steps).

## Deployment Topologies

### Single-tenant (development / testbed)
- `JOB_STORE_ADAPTER=mongoose` (or in-memory)
- `CONNECTION_ADAPTER=single` → `singleConnectionAdapter.js`
- `QUEUE_ADAPTER=in-memory`
- `STORAGE_ADAPTER=local-fs`
- One MongoDB, no Redis, no GCS. Run `docker compose up` and point your
  Express app at `http://localhost:3000`.

### Shared-tier (multi-tenant, Hetzner-like)
- `JOB_STORE_ADAPTER=mongoose`
- `CONNECTION_ADAPTER= single` (shared DB for all tenants)
- `QUEUE_ADAPTER=bullmq` → requires Redis
- `STORAGE_ADAPTER=local-fs` or GCS for off-site archive
- One shared MongoDB, one Redis, one Node process. Same image.

### Dedicated-tier (per-tenant DB, Cloud Run)
- `JOB_STORE_ADAPTER=mongoose`
- `CONNECTION_ADAPTER=mongoose-tenant` → resolves per-tenant connection
- `QUEUE_ADAPTER=in-memory` (Cloud Run Job is single-shot, no Redis needed)
- `STORAGE_ADAPTER=gcs` → pre-signed URLs for upload, GCS download in worker
- Each execution is a separate Cloud Run Job invocation.

## Key Design Decisions

1. **Copy-first, transform-second.** The `core/` files were copied byte-for-byte
   from the OfferBerries source, then modified to use adapter interfaces.
   Diff against the originals shows exactly what changed.
2. **Interfaces before implementations.** All five adapter interfaces were
   designed before any implementation code was written, verified by writing
   the trivial (testbed) and real (OfferBerries) implementations side by side.
3. **No OfferBerries references in `core/`.** Grep for `party`, `employee`,
   `invoice`, etc. in `core/` — there are zero matches. All domain knowledge
   lives in `examples/offerberries-targets/`.
4. **Status-gated resumability.** Every pipeline step checks the job's current
   status before running. A crash during staging leaves the job at "uploaded";
   the retry clears stale rows and re-stages. A crash mid-commit leaves the
   "committing" status on some rows; `commitBatch` skips `committed`/`failed`
   rows naturally.
