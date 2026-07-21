<div align="center">
  <h1>Universal Data Onboarding Engine</h1>
  <p><strong>Streaming-safe, adapter-driven, tenant-agnostic data import pipeline</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node" /></a>
    <a href="https://github.com/IhsanKhann/universal-data-onboarder/actions"><img src="https://github.com/IhsanKhann/universal-data-onboarder/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI" /></a>
    <a href="https://ihsankhann.github.io/universal-data-onboarder/"><img src="https://img.shields.io/badge/docs-VitePress-blue" alt="Docs" /></a>
    <a href="https://ihsankhann.github.io/universal-data-onboarder/demo/"><img src="https://img.shields.io/badge/demo-React-blueviolet" alt="Demo" /></a>
    <a href="https://github.com/IhsanKhann/universal-data-onboarder/blob/main/CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs" /></a>
  </p>
</div>

---

Parse **CSV, JSON, XLSX, and SQL dumps** through a streaming pipeline with configurable guardrails, column mapping, row validation, and idempotent commit — all without hardcoding a single database vendor, queue provider, entity type, or cloud provider into the core engine.

```bash
npm install @offerberries/universal-data-onboarder
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     examples/                                │
│   18 OfferBerries target descriptors + test product target   │
├──────────────────────────────────────────────────────────────┤
│      worker/          │           http/                     │
│  cloudRunEntrypoint   │   Express REST API + Swagger UI     │
│  importPipeline       │   Upload / Map / Validate / Commit  │
│  bullmqCommitWorker   │   Target Schema Discovery           │
├──────────────────────────────────────────────────────────────┤
│     orchestration/    │    queueing/    │    storage/        │
│  JobStore interface   │  QueueAdapter   │  StorageAdapter   │
│  + Mongoose adapter   │  + BullMQ /     │  + GCS /          │
│  + InMemory adapter   │    InMemory     │    LocalFS        │
├───────────────────────┴────────────────┴────────────────────┤
│                      core/ + registry/                       │
│  Guardrail  →  Parser  →  Mapping  →  Validation  →  Commit │
│  TierPolicy     CSV/JSON/     Column→     Required/     Idem-│
│  Row/Byte       XLSX/SQL      Field       Dup/Format    potent│
│  Ceilings       Streaming     Mapping     Validation    Batch│
│                                                              │
│  registry/ → Generic TargetDescriptor registration + lookup │
└──────────────────────────────────────────────────────────────┘
```

### Adapter-Driven Architecture

Every external dependency is an injected interface. Swap implementations by changing **one env var** — no code changes, no forks.

| Interface | File | Default Adapter | Alternatives |
|---|---|---|---|
| **JobStore** | `orchestration/jobStore.js` | Mongoose (MongoDB) | In-memory (testing) |
| **QueueAdapter** | `queueing/QueueAdapter.js` | BullMQ (Redis) | In-memory (sync) |
| **StorageAdapter** | `storage/StorageAdapter.js` | Local FS | GCS, S3 (future) |
| **ConnectionResolver** | `topology/ConnectionResolver.js` | Single connection | Multi-tenant |
| **TierPolicy** | `core/guardrail/tierPolicy.js` | Env-driven (`ONBOARDER_*`) | DB-driven |

## ✨ Features

- **🔒 Streaming Parsers** — CSV, JSON, XLSX, SQL dumps parsed in streaming mode. Memory scales with row width, not file size. Aborts instantly past the configured row/byte ceiling.
- **🔐 Idempotent Commit** — Natural-key dedup + status-gated resumability. Crash mid-commit? Re-run — already-committed rows are skipped, pending rows resume. No duplicates, no data loss.
- **🧩 Pluggable Adapters** — Every external dependency is an injected interface. Swap Mongoose → SQLite, BullMQ → SQS, GCS → local FS by changing env vars.
- **📋 Target Descriptors** — Each entity type (employee, invoice, product) is a plain-object descriptor with a `commitRow` function. The engine has zero domain knowledge. Add new entity types without modifying the core.
- **🛡️ Guardrails** — Row-count and byte-size ceilings enforced before parsing. Tier-aware policy gives shared tenants tighter limits than dedicated ones. Structured upgrade CTAs guide users when they hit a limit.
- **📊 Multi-Job Sessions** — Topologically-sorted execution order with cross-job external-ID resolution. Chain employee → payroll → leave imports in one session.

## 🚀 Quickstart

### 1. Install

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder.git
cd universal-data-onboarder
npm install
```

### 2. Run the demo wizard

```bash
cd packages/react-ui
npm install
npm run dev
```

Open [http://localhost:5173/demo/](http://localhost:5173/demo/) for the import wizard UI.

### 3. Run the backend testbed

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder-testbed.git
cd universal-data-onboarder-testbed
npm install
node server.js
```

Open [http://localhost:3099/docs](http://localhost:3099/docs) for Swagger UI.

### 4. Run tests

```bash
# Testbed e2e tests (no MongoDB or Redis needed)
npm run test:native

# Engine tests (Jest)
cd ../universal-data-onboarder
npm test
```

## 🔌 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JOB_STORE_ADAPTER` | `mongoose` | `mongoose`, `in-memory` |
| `QUEUE_ADAPTER` | `bullmq` | `bullmq`, `in-memory` |
| `STORAGE_ADAPTER` | `local-fs` | `local-fs`, `gcs` |
| `CONNECTION_ADAPTER` | `single` | `single`, `mongoose-tenant` |
| `ONBOARDER_SHARED_MAX_ROWS` | `20000` | Max rows for shared-tier imports |
| `ONBOARDER_DEDICATED_MAX_ROWS` | `50000` | Max rows for dedicated-tier imports |
| `ONBOARDER_SHARED_MAX_BYTES` | `20971520` | 20MB — shared-tier byte ceiling |
| `ONBOARDER_DEDICATED_MAX_BYTES` | `536870912` | 512MB — dedicated-tier byte ceiling |
| `ONBOARDER_SYNC_COMMIT_THRESHOLD` | `200` | Rows below this commit synchronously |
| `MONGO_URI` | — | MongoDB connection string |
| `REDIS_URL` | — | Redis connection string (for BullMQ) |
| `GCS_BUCKET` | — | GCS bucket for file storage |

## 📡 API Overview

All endpoints are under `/api/imports`. Full Swagger docs at `/docs` when running the server.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/imports` | Upload file or initiate dedicated-tier import |
| `GET` | `/api/imports` | List import jobs |
| `GET` | `/api/imports/:id` | Get job status |
| `POST` | `/api/imports/:id/validate` | Run validation rules |
| `GET` | `/api/imports/:id/rows` | List staged rows with pagination |
| `PATCH` | `/api/imports/:id/rows/:rowId` | Fix or exclude a single row |
| `POST` | `/api/imports/:id/mapping` | Apply column→field mapping |
| `POST` | `/api/imports/:id/commit` | Commit validated rows |
| `GET` | `/api/target-schemas` | Discover available target entities |
| `POST` | `/api/sessions` | Create multi-job migration session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Get session status |
| `POST` | `/api/sessions/:id/jobs` | Add job to session |
| `POST` | `/api/sessions/:id/compute-order` | Compute topological execution order |

## 📦 Deployment

### Docker

```bash
docker build -t universal-data-onboarder .
docker run -e QUEUE_ADAPTER=in-memory -e CONNECTION_ADAPTER=single universal-data-onboarder
```

### GCP Cloud Run

```bash
gcloud builds submit --config infra/gcp-cloud-run/cloudbuild.yaml \
  --substitutions=_IMAGE=us-central1-docker.pkg.dev/MY-PROJECT/onboarder/entrypoint
gcloud run jobs create onboarder-import \
  --image=us-central1-docker.pkg.dev/MY-PROJECT/onboarder/entrypoint
```

### GitHub Pages

Docs are automatically deployed to GitHub Pages on every push to `master` that touches `docs-site/` or `packages/react-ui/`:
- **Docs**: [https://ihsankhann.github.io/universal-data-onboarder/](https://ihsankhann.github.io/universal-data-onboarder/)
- **Import Wizard Demo**: [https://ihsankhann.github.io/universal-data-onboarder/demo/](https://ihsankhann.github.io/universal-data-onboarder/demo/)

## 🧪 Test Results

All **9 e2e tests** pass, covering:
- ✅ Guardrail row ceiling rejection
- ✅ Guardrail byte ceiling rejection
- ✅ Commit idempotency (re-running produces no duplicates)
- ✅ Crash recovery (mid-commit process kill → resume)
- ✅ Dual-topology (same engine with different connection resolvers)

## 📁 Project Structure

```
core/              → Pure engine: guardrail, parsing, mapping, validation, commit
registry/          → Generic TargetDescriptor registration/lookup
orchestration/     → JobStore interface + session management + Mongoose adapter
queueing/          → QueueAdapter interface + BullMQ/in-memory adapters
storage/           → StorageAdapter interface + GCS/local-fs adapters
topology/          → ConnectionResolver interface + single/multi-tenant adapters
http/              → Express upload routes + Swagger UI + default middleware
worker/            → Cloud Run entrypoint + import pipeline orchestration
packages/react-ui/ → React import wizard demo (Vite 6 + React 18 + Tailwind 4)
docs-site/         → VitePress documentation site
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Key principles:

- **No OfferBerries domain knowledge in `core/`** — the engine must remain entity-agnostic
- **Adapters before implementations** — write the interface contract first, then the implementation
- **Idempotent by design** — every commit step must be safe to re-run
- **PRs require CI to pass** — branch protection is enforced on `master`

## 📜 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Built with ❤️ from the OfferBerries migration wizard · 
  <a href="https://github.com/IhsanKhann/universal-data-onboarder">GitHub</a> · 
  <a href="https://ihsankhann.github.io/universal-data-onboarder/">Docs</a> · 
  <a href="https://ihsankhann.github.io/universal-data-onboarder/demo/">Demo</a></sub>
</div>
