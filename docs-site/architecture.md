---
outline: deep
---

# Architecture

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

**Rule:** Each layer may only depend on layers below it.

| Layer | Depends On |
|-------|-----------|
| `examples/` | registry re-exports, OfferBerries domain models |
| `worker/` + `http/` | `core/`, `orchestration/`, `registry/` |
| `orchestration/` + `queueing/` + `storage/` + `topology/` | adapter interfaces, `core/` |
| `core/` + `registry/` | nothing but Node standard lib and injected interfaces |

## Adapter Interfaces

The engine is adapter-driven. Every hardcoded OfferBerries reach-out has been
replaced with a small interface in its own module.

| Interface | File | Default Adapter | Alternatives |
|---|---|---|---|
| **JobStore** | `orchestration/jobStore.js` | `mongooseJobStore.js` (MongoDB) | `inMemoryJobStore.js` |
| **QueueAdapter** | `queueing/QueueAdapter.js` | `bullmqAdapter.js` (Redis) | `inMemoryAdapter.js` (sync) |
| **StorageAdapter** | `storage/StorageAdapter.js` | `localFsAdapter.js` (local fs) | `gcsAdapter.js` (GCS), S3 (future) |
| **ConnectionResolver** | `topology/ConnectionResolver.js` | `singleConnectionAdapter.js` (fixed URI) | `mongooseTenantAdapter.js` (multi-tenant) |
| **TierPolicy** | `core/guardrail/tierPolicy.js` | `envTierPolicy` (env-driven) | `tenantConfigTierPolicy` (DB-driven) |

Swapping adapters requires an env var change only — no code change, no fork.

## Job Lifecycle

```
pending_upload → uploaded → guardrail_rejected
                         → staged → mapped → validated → committing → completed
                                                              → (async) → completed_with_errors
                                                                       → failed
```

Each step gates on the ImportJob's `status` field. A crash mid-pipeline resumes
from the last persisted status rather than restarting (idempotent steps).

## Deployment Topologies

### Single-tenant (development / testbed)

- `JOB_STORE_ADAPTER=mongoose` (or `in-memory`)
- `CONNECTION_ADAPTER=single`
- `QUEUE_ADAPTER=in-memory`
- `STORAGE_ADAPTER=local-fs`
- One MongoDB, no Redis, no GCS.

### Shared-tier (multi-tenant, Hetzner-like)

- `JOB_STORE_ADAPTER=mongoose`
- `CONNECTION_ADAPTER=single` (shared DB for all tenants)
- `QUEUE_ADAPTER=bullmq` → requires Redis
- `STORAGE_ADAPTER=local-fs` or GCS for off-site archive

### Dedicated-tier (per-tenant DB, Cloud Run)

- `JOB_STORE_ADAPTER=mongoose`
- `CONNECTION_ADAPTER=mongoose-tenant` → resolves per-tenant connection
- `QUEUE_ADAPTER=in-memory` (Cloud Run Job is single-shot)
- `STORAGE_ADAPTER=gcs` → pre-signed URLs + GCS download in worker

## Key Design Decisions

1. **Copy-first, transform-second** — The `core/` files were copied byte-for-byte
   from the OfferBerries source, then modified to use adapter interfaces.

2. **Interfaces before implementations** — All five adapter interfaces were
   designed before any implementation code was written.

3. **No OfferBerries references in `core/`** — Grep for `party`, `employee`,
   `invoice`, etc. in `core/` — there are zero matches.

4. **Status-gated resumability** — Every pipeline step checks the job's current
   status before running. A crash during staging leaves the job at `"uploaded"`;
   the retry clears stale rows and re-stages. A crash mid-commit leaves
   `"committing"` status on some rows; `commitBatch` skips `committed`/`failed`
   rows naturally.
