/**
 * Cloud Run Job entrypoint — pure composition root.
 *
 * This file's ONLY job:
 *   1. Read env vars per the env-var contract (.env.example)
 *   2. Construct the four adapters (jobStore, storage, connectionResolver, queue)
 *      based on the `_ADAPTER` env vars
 *   3. Call the generic pipeline functions from worker/importPipeline.js
 *      with those adapters injected
 *   4. Exit with the job's real exit code
 *
 * No business logic lives here. No Mongoose model imports. No OfferBerries
 * domain knowledge. If you find yourself writing an entity-specific `if`
 * statement, it belongs in examples/offerberries-targets/ — not here.
 */

import { createMongooseJobStore } from "../orchestration/jobStore.js";
import { singleConnectionResolver } from "../topology/ConnectionResolver.js";
import {
  runJobPipeline,
  runSessionPipeline,
  resolveTenantConnection,
} from "./importPipeline.js";
import logger from "../utils/logger.js";

const SERVICE = "cloudRunEntrypoint";

// ── Terminal statuses → process exit code ──────────────────────────────────
const SUCCESS_STATUSES = new Set(["completed", "completed_with_errors"]);
const BUSINESS_REJECT_STATUSES = new Set(["guardrail_rejected"]);
const AWAITING_INPUT_STATUSES = new Set(["staged"]);

export function exitCodeForStatus(status) {
  if (SUCCESS_STATUSES.has(status))          return 0;
  if (BUSINESS_REJECT_STATUSES.has(status))  return 0;
  if (AWAITING_INPUT_STATUSES.has(status))   return 0;
  return 1;
}

// ── Env helpers ────────────────────────────────────────────────────────────
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required but not set`);
  return value;
}

// ── Adapter factory ────────────────────────────────────────────────────────
async function buildAdapters() {
  const jobStoreAdapter = process.env.JOB_STORE_ADAPTER || "mongoose";
  const connectionAdapter = process.env.CONNECTION_ADAPTER || "single";

  let jobStore;
  let connectionResolver;

  switch (jobStoreAdapter) {
    case "in-memory": {
      const { createInMemoryJobStore } = await import("../orchestration/adapters/inMemoryJobStore.js");
      jobStore = createInMemoryJobStore();
      break;
    }
    default:
      jobStore = createMongooseJobStore();
      break;
  }

  switch (connectionAdapter) {
    case "mongoose-tenant": {
      const { mongooseTenantConnectionResolver } = await import("../topology/ConnectionResolver.js");
      connectionResolver = mongooseTenantConnectionResolver;
      break;
    }
    case "single":
    default:
      connectionResolver = singleConnectionResolver;
      break;
  }

  return { jobStore, connectionResolver };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

export async function main() {
  const tenantId     = requireEnv("TENANT_ID");
  const sessionId    = process.env.SESSION_ID || null;
  const importJobId  = process.env.IMPORT_JOB_ID || null;
  const bucketName   = process.env.GCS_BUCKET_NAME || null;
  const objectPath   = process.env.GCS_OBJECT_PATH || null;

  if (!sessionId && !importJobId) {
    throw new Error("Either SESSION_ID or IMPORT_JOB_ID is required");
  }

  const adapters = await buildAdapters();

  logger.info(`[${SERVICE}] starting`, {
    tenantId, sessionId, importJobId: importJobId || "(per-job via session)",
    adapters: Object.keys(adapters),
  });

  const { conn } = await resolveTenantConnection(tenantId, adapters.connectionResolver);
  logger.info(`[${SERVICE}] tenant DB connected`);

  try {
    let finalStatus;

    if (sessionId) {
      const result = await runSessionPipeline(tenantId, sessionId, conn, adapters);
      finalStatus = result.status;
    } else {
      if (!importJobId) throw new Error("IMPORT_JOB_ID is required for single-job mode");
      const job = await adapters.jobStore.getJob(tenantId, importJobId, conn);
      logger.info(`[${SERVICE}] found ImportJob`, {
        status: job.status, module: job.module, sourceFormat: job.sourceFormat,
      });

      if (!bucketName || !objectPath) {
        throw new Error("GCS_BUCKET_NAME and GCS_OBJECT_PATH are required for single-job mode");
      }

      const current = await runJobPipeline(job, conn, bucketName, objectPath, adapters);
      finalStatus = current?.status;
    }

    logger.info(`[${SERVICE}] pipeline complete`, {
      tenantId, sessionId: sessionId || "(none)", finalStatus,
    });
    return finalStatus;
  } finally {
    await conn.close();
  }
}

// ── Auto-run when executed directly (as container CMD) ─────────────────────
const isDirectRun = Boolean(process.argv[1]?.endsWith("cloudRunEntrypoint.js"));

if (isDirectRun) {
  main()
    .then((finalStatus) => {
      const code = exitCodeForStatus(finalStatus);
      if (code === 0) {
        logger.info(`[${SERVICE}] done`, { finalStatus });
      } else {
        logger.error(`[${SERVICE}] FAILED — job did not complete`, { finalStatus });
      }
      process.exit(code);
    })
    .catch((err) => {
      logger.error(`[${SERVICE}] FAILED`, { error: err.message, stack: err.stack });
      process.exit(1);
    });
}
