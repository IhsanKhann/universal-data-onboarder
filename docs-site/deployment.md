# Deployment Guide

## Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "worker/cloudRunEntrypoint.js"]
```

Build and run:

```bash
docker build -t universal-data-onboarder .
docker run -e QUEUE_ADAPTER=in-memory -e STORAGE_ADAPTER=local-fs \
  -e CONNECTION_ADAPTER=single universal-data-onboarder
```

## Docker Compose (self-hosted)

```yaml
# docker-compose.yml
version: "3.8"
services:
  mongodb:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
  redis:
    image: redis:7-alpine
  onboarder:
    build: .
    ports:
      - "3099:3099"
    environment:
      QUEUE_ADAPTER: bullmq
      STORAGE_ADAPTER: local-fs
      CONNECTION_ADAPTER: single
      MONGO_URI: mongodb://mongodb:27017/onboarder
      REDIS_URL: redis://redis:6379
    depends_on:
      - mongodb
      - redis

volumes:
  mongo_data:
```

## GCP Cloud Run

1. Build and push to Artifact Registry:

```bash
gcloud builds submit --config infra/gcp-cloud-run/cloudbuild.yaml \
  --substitutions=_IMAGE=us-central1-docker.pkg.dev/MY-PROJECT/onboarder/entrypoint
```

2. Deploy the Cloud Run Job:

```bash
gcloud run jobs create onboarder-import \
  --image=us-central1-docker.pkg.dev/MY-PROJECT/onboarder/entrypoint \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=3600s \
  --set-env-vars="QUEUE_ADAPTER=in-memory,STORAGE_ADAPTER=gcs,CONNECTION_ADAPTER=mongoose-tenant"
```

## Environment Variables

See `.env.example` for the full contract. Key configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | — | MongoDB connection string |
| `REDIS_URL` | — | Redis connection string (for BullMQ) |
| `GCS_BUCKET` | — | GCS bucket for file storage |
| `QUEUE_ADAPTER` | `in-memory` | Queue backend |
| `STORAGE_ADAPTER` | `local-fs` | Storage backend |
| `CONNECTION_ADAPTER` | `single` | Connection resolver |
| `ONBOARDER_SHARED_MAX_ROWS` | `20000` | Max rows for shared-tier imports |
| `ONBOARDER_DEDICATED_MAX_ROWS` | `50000` | Max rows for dedicated-tier imports |
