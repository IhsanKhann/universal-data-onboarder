# Quickstart

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder.git
cd universal-data-onboarder
npm install
```

## Run the testbed (end-to-end demo)

The testbed repo proves the engine works with non-OfferBerries adapters:

```bash
git clone https://github.com/IhsanKhann/universal-data-onboarder-testbed.git
cd universal-data-onboarder-testbed
npm install
node server.js
```

Open [http://localhost:3099/docs](http://localhost:3099/docs) for Swagger UI.

## Run tests

```bash
# Engine tests (Jest)
npm test

# Testbed e2e tests (native node:test runner — requires Node >= 20)
cd ../universal-data-onboarder-testbed
npm run test:native
```

## API Overview

All endpoints are under `/api/imports`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/imports` | Upload file (shared-tier) or initiate dedicated-tier import |
| `GET` | `/api/imports` | List import jobs |
| `GET` | `/api/imports/:id` | Get job status |
| `POST` | `/api/imports/:id/validate` | Run validation rules |
| `GET` | `/api/imports/:id/rows` | List staged rows |
| `PATCH` | `/api/imports/:id/rows/:rowId` | Fix or exclude a row |
| `POST` | `/api/imports/:id/mapping` | Apply column→field mapping |
| `POST` | `/api/imports/:id/commit` | Commit valid rows |
| `GET` | `/api/target-schemas` | Discover target entity schemas |
| `POST` | `/api/sessions` | Create migration session |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions/:id/jobs` | Add job to session |

## Environment

Copy `.env.example` to `.env` and configure:

```env
# Core
ONBOARDER_SHARED_MAX_ROWS=20000
ONBOARDER_DEDICATED_MAX_ROWS=50000
ONBOARDER_SHARED_MAX_BYTES=20971520
ONBOARDER_DEDICATED_MAX_BYTES=536870912
ONBOARDER_SYNC_COMMIT_THRESHOLD=200

# Adapters
QUEUE_ADAPTER=in-memory          # or "bullmq"
STORAGE_ADAPTER=local-fs          # or "gcs"
CONNECTION_ADAPTER=single         # or "mongoose-tenant"
JOB_STORE_ADAPTER=mongoose        # or "in-memory"

# Infrastructure (required by the selected adapters)
MONGO_URI=mongodb://localhost:27017/onboarder
REDIS_URL=redis://localhost:6379  # Required for BullMQ
GCS_BUCKET=my-onboarder-bucket    # Required for GCS
```
