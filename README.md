# Universal Data Onboarding Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A **tenant-agnostic, streaming-safe, adapter-driven import pipeline** extracted from the OfferBerries migration wizard. Parse CSV, JSON, XLSX, and SQL dumps — guardrail, map, validate, and commit rows idempotently through a pluggable adapter architecture.

## Quickstart

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder.git
cd universal-data-onboarder
npm install
# Run the e2e tests (no MongoDB or Redis needed):
cd ../universal-data-onboarder-testbed && npm install
node tests/e2e-native-runner.mjs
```

All 9 e2e tests pass, verifying: guardrail rejection, commit idempotency, crash recovery, and dual-topology support.

## Features

- **Streaming parser** — CSV, JSON, XLSX, SQL dump parsing with bounded memory (aborts past the row ceiling)
- **Guardrail enforcement** — configurable row/byte ceilings per tier (shared vs dedicated), with structured upgrade CTAs
- **Column mapping** — heuristic auto-mapping + saved mapping profiles
- **Row validation** — required fields, enum values, duplicate detection, foreign-key resolution
- **Idempotent commit** — crash-retry safe via `commitStatus` tracking + duplicate-key detection
- **Multi-target sessions** — dependency-ordered multi-file imports via `MigrationSession`
- **Adapter-driven** — swap JobStore, Queue, Storage, and ConnectionResolver without code changes

## Architecture

```
examples/          → Reference 18 OfferBerries target descriptors
worker/            → Composition roots + pipeline orchestration
core/              → Pure engine: guardrail, parsing, mapping, validation, commit
orchestration/     → JobStore interface + Mongoose adapter + session management
registry/          → Generic TargetDescriptor registration/lookup
queueing/          → QueueAdapter interface + BullMQ/in-memory adapters
storage/           → StorageAdapter interface + GCS/local-fs adapters
topology/          → ConnectionResolver interface + single/multi-tenant adapters
http/              → Express upload routes + B2B routes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Adapter Interfaces

| Interface | File | Default | Alternatives |
|---|---|---|---|
| JobStore | `orchestration/jobStore.js` | Mongoose | In-memory (testing) |
| QueueAdapter | `queueing/QueueAdapter.js` | BobbMQ | In-memory (testing) |
| StorageAdapter | `storage/StorageAdapter.js` | Local FS | GCS |
| ConnectionResolver | `topology/ConnectionResolver.js` | Single connection | Multi-tenant |

Swap by setting `JOB_STORE_ADAPTER`, `QUEUE_ADAPTER`, `STORAGE_ADAPTER`, or `CONNECTION_ADAPTER` env vars.

## License

MIT — see [LICENSE](LICENSE).
