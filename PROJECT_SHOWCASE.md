# Universal Data Onboarding Engine — Project Showcase

## What This Project Accomplishes

The Universal Data Onboarding Engine is a **production-grade, streaming-safe data import pipeline** extracted from the OfferBerries SaaS platform. Originally a tightly-coupled module inside a multi-tenant HR/finance platform, it has been refactored into a **standalone, publishable, adapter-driven library** with zero hardcoded domain knowledge.

### Core Capabilities

- **Streaming file parsing** — CSV, JSON, XLSX, and SQL dump files are parsed in streaming mode with bounded memory usage. The parser aborts instantly when row or byte ceilings are exceeded, preventing OOM crashes.
- **Guardrail enforcement** — Configurable row-count and byte-size limits per tenant tier. Structured error responses with upgrade CTAs guide users when they hit limits.
- **Column mapping** — Heuristic auto-mapping + saved mapping profiles + manual column-to-field assignment.
- **Row validation** — Required field checks, enum value validation, duplicate detection via natural keys, foreign-key resolution.
- **Idempotent commit** — Natural-key dedup + status-gated resumability. A process crash mid-commit is safe: re-run and already-committed rows are skipped, pending rows resume. No duplicates, no data loss.
- **Multi-job sessions** — Topologically-sorted execution order with cross-job external-ID resolution. Chain employee → payroll → leave imports in one session.

### Architecture

The engine is organized as a clean layered architecture:

- **core/** — Pure business logic with NO external dependencies. Guardrail, parsing, mapping, validation, commit.
- **registry/** — Generic `TargetDescriptor` registration and lookup. The engine has zero knowledge of what a "Party", "Employee", or "Invoice" is.
- **orchestration/** — Adapter interfaces (JobStore) + session management + Mongoose implementation.
- **queueing/**, **storage/**, **topology/** — More adapter interfaces with real and in-memory implementations.
- **http/** — Express REST API with Swagger/OpenAPI documentation.
- **worker/** — Cloud Run job entrypoint + pipeline orchestration.
- **packages/react-ui/** — React import wizard demo (5-step flow: Target → Upload → Mapping → Validation → Commit).

### Adapter Pattern

Every external dependency is an **injected interface**. The core engine never imports a database driver, queue library, or cloud SDK directly:

```
Interface                  Default Adapter      Alternative
─────────────────────────────────────────────────────────────
JobStore                   Mongoose (MongoDB)   In-memory
QueueAdapter               BullMQ (Redis)       In-memory (sync)
StorageAdapter             Local FS             GCS, S3 (future)
ConnectionResolver         Single connection    Multi-tenant
TierPolicy                 Env-driven           DB-driven
```

Swap by changing one env var. No code changes, no forks.

### GitHub Ecosystem

- **CI/CD**: GitHub Actions workflows for CI (Node 20 + 22 matrix), GitHub Pages deployment (docs + demo), and npm publishing (tag-triggered).
- **Branch Protection**: `master` branch requires CI checks to pass, enforces admin compliance, and requires PR review with at least 1 approval.
- **GitHub Pages**: VitePress documentation at `/` and React import wizard demo at `/demo/`.
- **Secrets**: NPM_TOKEN set via `gh secret set` for automated npm publishing.

## Key Technical Achievements

### 1. Clean Extraction from Monolith

The engine was extracted from a production multi-tenant SaaS platform without breaking existing functionality. Every file was:
1. **Copied byte-for-byte** from the OfferBerries codebase
2. **Import graph decoupled** — all `#-aliased` imports replaced with relative imports or interface calls
3. **Domain knowledge removed** — zero OfferBerries entity names (party, employee, invoice) exist in `core/`

### 2. Adapter Interface Design

Five adapter interfaces were designed and implemented side-by-side (real + test implementations) to catch interface mistakes early:

```javascript
// JobStore interface (orchestration/jobStore.js)
const jobStore = {
  createJob(tenantId, data, conn),
  getJob(tenantId, importJobId, conn),
  updateJob(tenantId, importJobId, updates, conn),
  getStagedRows(tenantId, importJobId, query, conn),
  bulkWriteStaged(tenantId, rows, conn),
  getRowCount(tenantId, importJobId, status, conn),
};
```

### 3. Streaming + Idempotency

The engine handles files of any size via streaming parsers and processes rows in batches with idempotency guarantees:

```
pending_upload → uploaded → guardrail_rejected
                         → staged → mapped → validated → committing → completed
                                                              → completed_with_errors
                                                              → failed
```

### 4. Test Coverage

- **9 e2e tests** using native `node:test` runner (Node 24 compatible)
- Tests cover: guardrail rejection, commit idempotency, crash recovery, dual-topology
- **7 Jest tests** for contract verification
- All tests pass with no MongoDB, no Redis (in-memory adapters)

### 5. React Import Wizard

A 5-step import wizard demo with dark theme, built with:
- **Vite 6** + **React 18** for fast development
- **Tailwind CSS 4** for styling
- **Phosphor Icons** for iconography
- Mock data layer for standalone demo mode (works on GitHub Pages without backend)

## Future Roadmap

### Short-term (v0.2.0)

- [ ] **S3 Storage Adapter** — Add S3 adapter for the StorageAdapter interface
- [ ] **PostgreSQL Job Store** — Implement JobStore interface for PostgreSQL
- [ ] **Frontend error boundary** — Add error boundary to React wizard for crash resilience
- [ ] **API client abstraction** — `engineClient.js` that switches between mock data and real API calls
- [ ] **`.env.example`** for React UI documenting `VITE_API_URL` and `VITE_BASE_PATH`

### Medium-term (v0.3.0 - v0.5.0)

- [ ] **WebSocket progress streaming** — Real-time job progress via SSE/WebSocket
- [ ] **Multi-format export** — Export validation errors as CSV for batch correction
- [ ] **Dry-run mode** — Preview commit results without executing
- [ ] **Scheduled imports** — Cron-triggered import sessions
- [ ] **Webhook notifications** — POST to webhook URL on job completion
- [ ] **Dynamic field generation** — Target descriptors with computed/derived fields

### Long-term (v1.0.0+)

- [ ] **Plugin system** — Third-party target descriptors via npm packages
- [ ] **Visual mapping editor** — Drag-and-drop column mapping UI
- [ ] **Import templates** — Reusable import configurations with pre-defined mappings
- [ ] **Data quality dashboards** — Historical validation metrics and trend analysis
- [ ] **Schema inference** — Auto-detect target descriptor from sample data
- [ ] **AI-assisted mapping** — ML-powered column-to-field suggestions

## Links

- **GitHub Repo**: [github.com/IhsanKhann/universal-data-onboarder](https://github.com/IhsanKhann/universal-data-onboarder)
- **Testbed Repo**: [github.com/IhsanKhann/universal-data-onboarder-testbed](https://github.com/IhsanKhann/universal-data-onboarder-testbed)
- **Docs Site**: [ihsankhann.github.io/universal-data-onboarder/](https://ihsankhann.github.io/universal-data-onboarder/)
- **Import Wizard Demo**: [ihsankhann.github.io/universal-data-onboarder/demo/](https://ihsankhann.github.io/universal-data-onboarder/demo/)
- **npm Package**: `@offerberries/universal-data-onboarder`
