// services/shared/importGuardrail.service.js
// Migration Wizard — Phase 1 (MIGRATION_WIZARD_PLAN_2026-07-07.md §7 "protect
// what already exists"). Small, plain application logic on purpose (§6 row:
// "Guardrail / size-limit check ... Small, plain application logic").
//
// The exact threshold is an open question the plan flags (§9: "What's the
// exact size threshold that moves a client from shared to their own
// database?"). This is a first, conservative cut: row-count only (not
// storage bytes), gated on Tenant.storageMode. A tenant with its OWN database
// ("dedicated" = platform-managed, or "byod" = tenant-supplied — see
// Tenant.model.js) isn't sharing a database with anyone, so it gets a much
// higher ceiling — still capped, so a single pathological upload can't be used
// to exhaust disk/memory on any tier. "local" (dev) is treated like the higher
// tier here; it never faces a real tenant.
//
// A shared-tier tenant whose import is too large is rejected with a clear
// reason, not silently routed anywhere. The way out is to move to their own
// database — either a dedicated database the platform provisions, or bring
// their own (onboarding step 2 / Admin Settings → Database, both real today).
import { parseStreaming } from "../parsing/streamingParser.js";
import { envTierPolicy } from "./tierPolicy.js";
import logger from "../../utils/logger.js";

const SERVICE = "importGuardrail.service";

const SHARED_MAX_IMPORT_ROWS =
  Number(process.env.MIGRATION_SHARED_MAX_IMPORT_ROWS) || 20_000;

// 50,000 — NOT the 500,000 this shipped with. That number was aspirational and
// the storage cannot honour it. Measured on the live cluster 2026-07-17
// (scripts/measure_import_storage_cost.js, 5,000-row probe):
//
//   897 bytes per staged row  →  500k rows needs ~855 MB
//   every database — including ControlPlaneDB_production and SharedDB_production
//   — shares ONE Atlas M0 with a 512 MB quota (~501 MB free)
//
// So a 500k import does not merely fail: it exhausts the cluster quota at
// ~292k rows and takes PRODUCTION's control plane down with it. The blast
// radius, not the import's own failure, is why this is capped.
//
// 50k is deliberately below the 73k the measurement derives (25% of free space,
// assuming a committed row costs 2x a staged one). The 2x multiplier is still
// unverified — the commit phase has never executed — so the margin stays until
// it is measured for real.
//
// RAISE THIS when dedicated tenants get their own cluster: an M10 (10 GB) makes
// 500k trivially affordable. It is env-overridable precisely so that is a config
// change, not a deploy. See docs/MIGRATION_GUARDRAIL_LIMIT_EVIDENCE_2026-07-17.md.
const DEDICATED_MAX_IMPORT_ROWS =
  Number(process.env.MIGRATION_DEDICATED_MAX_IMPORT_ROWS) || 50_000;

// ── Byte ceilings (the second guardrail dimension) ─────────────────────────
// Rows are the authoritative check, but they can only be counted by reading the
// file — which the dedicated tier does inside the Cloud Run Job, long after the
// browser has already uploaded. Bytes are the dimension available *before* an
// upload URL is issued, so this is what stops someone requesting a pre-signed
// URL for a 50GB file.
//
// Sized off the tier row limits at a deliberately loose ~1KB/row (the real
// files run ~50-250 bytes/row), so a legitimate import is never blocked by the
// byte check — the row check stays the one that decides.
//
// ── Why the shared ceiling is enforced by multer, not by this file ──────────
// checkImportFileSize() below is the only consumer of these constants, and its
// only callers (createImportJobDedicated / completeImportUpload) sit behind an
// own-database gate (hasOwnDatabase — dedicated or byod). So this value was never
// once consulted for a shared tenant: their real ceiling was multer's own
// `limits.fileSize`, which
// was 20MB while this said 25MB. Nothing enforced 25, and the 25MB rejection
// message it words could not fire.
//
// Rather than delete it, the number is now EXPORTED and multer's migration
// uploader is configured from it (see middlewares/mutlerMiddleware.js's
// makeUploader + routes/migration.routes.js), so shared-tier bytes have exactly
// one source of truth and the env var means what it says on both tiers.
export const SHARED_MAX_IMPORT_BYTES =
  Number(process.env.MIGRATION_SHARED_MAX_IMPORT_BYTES) || 20 * 1024 * 1024;       // 20 MB

const DEDICATED_MAX_IMPORT_BYTES =
  Number(process.env.MIGRATION_DEDICATED_MAX_IMPORT_BYTES) || 512 * 1024 * 1024;   // 512 MB

/**
 * Resolve a tenant's row ceiling WITHOUT needing a row count.
 *
 * The Cloud Run pipeline needs the limit *before* it reads the file, so it can
 * abort a pathological import mid-stream instead of counting every row of a
 * 5-million-row file just to reject it. checkImportGuardrail() below is the
 * decision function and uses this for its own lookup — the two cannot drift.
 *
 * @param {string} tenantId
 * @returns {Promise<{limit: number, storageMode: string}>}
 */
export async function getImportRowLimit(tenantId) {
  const { storageMode, limit, limitBytes } = await envTierPolicy.resolve(tenantId);
  return { limit, storageMode, limitBytes };
}

/**
 * Build the tier-appropriate rejection reason.
 *
 * `rowCountLabel` is a string, not a number, because a stream that aborts early
 * knows only "more than N" — it deliberately stopped counting. Keeping the
 * wording in one place stops the streaming path and the inline path from
 * explaining the same rejection two different ways to the same operator.
 *
 * ── What these messages owe the reader ─────────────────────────────────────
 * A rejection is the only place a tenant ever learns their tier has a ceiling,
 * so it has to answer all three of "what stopped me", "what is the limit", and
 * "what do I do now" — the previous shared-tier wording answered the first two
 * and then said "contact support", which is a dead end for a self-serve
 * product whose move-to-your-own-database flow has existed the whole time
 * (onboarding step 2, and now /api/byod).
 *
 * The three modes get genuinely different advice because their exits differ:
 *   • shared    — two real exits: a platform-managed dedicated database, OR
 *                 bring your own. Named both (the tenant chooses); either lifts
 *                 the ceiling.
 *   • byod      — already on their own database. The cap is the platform's
 *                 per-import default, not their cluster's limit, so the honest
 *                 advice is "split the file, or ask us to raise it".
 *   • dedicated — a database the platform manages for them; the cap is a hard
 *                 property of its storage tier, so "split the file / contact
 *                 support to size up". Not a false promise of a self-serve fix.
 *
 * @param {string} storageMode
 * @param {number} limit
 * @param {string|number} rowCountLabel
 * @returns {string}
 */
export function buildGuardrailRejectionReason(storageMode, limit, rowCountLabel) {
  const rows = (n) => Number(n).toLocaleString("en-US");
  // rowCountLabel is a number on the counted path and a string ("more than
  // 20,000") on the aborted one. Group only the number, so a message never
  // reads "20001 rows, over the 20,000-row limit" — two formattings of the same
  // quantity, which makes a reader look for a difference that isn't there. The
  // streaming path formats its own number before building the label.
  const count = typeof rowCountLabel === "number" ? rows(rowCountLabel) : rowCountLabel;

  if (storageMode === "shared") {
    return (
      `This import has ${count} rows, over the ${rows(limit)}-row limit for the shared tier ` +
      `(files are also capped at ${Math.round(SHARED_MAX_IMPORT_BYTES / 1024 / 1024)}MB). The shared tier runs on a ` +
      `database shared with other organizations, which is why the ceiling is low. ` +
      `To import a file this size, move to your own database — either a dedicated database we provision and ` +
      `manage for you, or bring your own MongoDB (Admin Settings → Database). ` +
      `Either raises this limit to ${rows(DEDICATED_MAX_IMPORT_ROWS)} rows. ` +
      `Splitting the file into batches under ${rows(limit)} rows also works and needs no setup.`
    );
  }

  if (storageMode === "byod") {
    return (
      `This import has ${count} rows, over the ${rows(limit)}-row per-import limit. ` +
      `This is a platform default for a bring-your-own database, not a limit of your own cluster — ` +
      `split the file into batches under ${rows(limit)} rows and import them in sequence, ` +
      `or contact support to raise the cap if your cluster can take it.`
    );
  }

  return (
    `This import has ${count} rows, over the ${rows(limit)}-row ceiling for your dedicated database. ` +
    `This is a hard limit of its current storage tier, not a setting on your account — ` +
    `please split the file into batches of under ${rows(limit)} rows and import them in sequence. ` +
    `Contact support if you need a single import larger than this.`
  );
}

// ── Byte-dimension rejection prose ──────────────────────────────────────────
// Extracted from checkImportFileSize so the multer early-reject path (which
// aborts the upload stream and therefore does NOT know the exact byte count)
// can reuse the same wording. `sizeBytes` is null on that path.
export function buildByteRejectionReason(storageMode, limitBytes, sizeBytes) {
  const asMb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
  const isFile = sizeBytes == null ? "This file exceeds the" : `This file is ${asMb(sizeBytes)}, over the`;
  if (storageMode === "shared") {
    return (
      `${isFile} ${asMb(limitBytes)} upload limit for the shared tier. ` +
      `Move to your own database — a platform-managed dedicated database, or bring your own MongoDB ` +
      `(Admin Settings → Database) — to raise the limit to ${asMb(DEDICATED_MAX_IMPORT_BYTES)}, ` +
      `or split the file into smaller batches.`
    );
  }
  return (
    `${isFile} ${asMb(limitBytes)} upload limit for your own database. ` +
    `Please split it into smaller batches and import them in sequence.`
  );
}

// ── Structured tier metadata (resolved spec 2026-07-20) ─────────────────────
// Both row and byte ceilings per tier, machine-readable so the wizard/UI can
// render a real upgrade CTA (limits + target tier + provisioning actions)
// instead of a prose blob. Own-database modes share the higher ceiling.
export const TIER_LIMITS = {
  shared:    { rows: SHARED_MAX_IMPORT_ROWS,    bytes: SHARED_MAX_IMPORT_BYTES },
  dedicated: { rows: DEDICATED_MAX_IMPORT_ROWS, bytes: DEDICATED_MAX_IMPORT_BYTES },
  byod:      { rows: DEDICATED_MAX_IMPORT_ROWS, bytes: DEDICATED_MAX_IMPORT_BYTES },
  local:     { rows: DEDICATED_MAX_IMPORT_ROWS, bytes: DEDICATED_MAX_IMPORT_BYTES },
};

/**
 * Structured, actionable upgrade CTA (resolved spec's primary UX). The frontend
 * maps each `action.type` to its own provisioning route — the backend does not
 * hardcode a URL. Shared-tier tenants have a real upgrade path (own database);
 * own-database tenants are already at the top tier, so `available:false` and the
 * only actions are split-the-file / contact-support (matching the prose).
 *
 * @param {string} storageMode
 * @returns {object}
 */
export function buildUpgradeCta(storageMode) {
  if (storageMode === "shared") {
    return {
      available:    true,
      fromTier:     "shared",
      toTier:       "own_database",
      currentLimit: TIER_LIMITS.shared,
      targetLimit:  TIER_LIMITS.dedicated,
      actions: [
        { type: "provision_dedicated", label: "Get a platform-managed dedicated database" },
        { type: "connect_byod",        label: "Connect your own MongoDB (Admin Settings → Database)" },
        { type: "split_file",          label: `Split into batches under ${SHARED_MAX_IMPORT_ROWS.toLocaleString("en-US")} rows` },
      ],
    };
  }
  return {
    available:    false,
    fromTier:     storageMode,
    toTier:       null,
    currentLimit: TIER_LIMITS[storageMode] ?? TIER_LIMITS.dedicated,
    targetLimit:  null,
    actions: [
      { type: "split_file",      label: "Split into smaller batches and import them in sequence" },
      { type: "contact_support", label: "Contact support to raise the cap" },
    ],
  };
}

/**
 * Build the full structured rejection envelope: stable `code`, which `dimension`
 * (rows|bytes) breached, the `limit`, the offending `current` value, the prose
 * `reason` (unchanged wording, still returned for backward-compat), and the
 * machine-readable `upgrade` CTA. This is what a client renders an upgrade
 * button from; the deep guardrail and the multer early-reject both emit it.
 *
 * @param {string} storageMode
 * @param {"rows"|"bytes"} dimension
 * @param {{limit:number, current:number|string|null}} opts
 * @returns {{code:string, dimension:string, storageMode:string, limit:number, current:number|string|null, reason:string, upgrade:object}}
 */
export function describeGuardrailRejection(storageMode, dimension, { limit, current }) {
  const reason = dimension === "bytes"
    ? buildByteRejectionReason(storageMode, limit, typeof current === "number" ? current : null)
    : buildGuardrailRejectionReason(storageMode, limit, current);
  return {
    code: "MIGRATION_IMPORT_LIMIT_EXCEEDED",
    dimension,
    storageMode,
    limit,
    current: current ?? null,
    reason,
    upgrade: buildUpgradeCta(storageMode),
  };
}

/**
 * Decide whether a file of `sizeBytes` may be uploaded at all.
 *
 * This is the cheap pre-upload dimension (CHECKLIST §4: "a cheap pre-upload
 * check on Hetzner (file size against a per-tenant ceiling, before generating
 * the pre-signed URL)"). It is NOT a substitute for the row check — it runs
 * before a single row exists, and a file can sit under the byte ceiling while
 * still blowing the row ceiling. Both run.
 *
 * @param {string} tenantId
 * @param {number} [sizeBytes] — omit/null to skip (nothing to check against)
 * @returns {Promise<{allowed: boolean, reason: string|null, limitBytes: number, storageMode: string}>}
 */
export async function checkImportFileSize(tenantId, sizeBytes) {
  const { storageMode, limitBytes } = await envTierPolicy.resolve(tenantId);

  if (sizeBytes == null) return { allowed: true, reason: null, limitBytes, storageMode };

  if (sizeBytes > limitBytes) {
    const details = describeGuardrailRejection(storageMode, "bytes", { limit: limitBytes, current: sizeBytes });
    logger.warn(`[${SERVICE}] guardrail rejected upload on size`, {
      tenantId, sizeBytes, limitBytes, storageMode,
    });
    return { allowed: false, reason: details.reason, limitBytes, storageMode, details };
  }

  return { allowed: true, reason: null, limitBytes, storageMode };
}

/**
 * Resolve the tenant's row ceiling, then parse the file under that ceiling.
 *
 * This is the ordering fix, and it is what BOTH tiers now use. Moved here from
 * workers/migration/importPipeline.js on 2026-07-17 — a service may not import
 * from workers/, and while it lived there only the Cloud Run path could reach
 * it. The shared tier meanwhile parsed the whole file and only then asked the
 * guardrail whether it was allowed, spending the very memory the ceiling exists
 * to protect. Here the ceiling is known first and the parse aborts the moment
 * it's breached, so a rejected file never costs more than `limit + 1` rows.
 *
 * One pass, not two: an earlier revision stream-counted the file and then
 * re-read it to parse, doubling the I/O for every import that passed.
 *
 * Prefer this over checkImportGuardrail() below whenever a file path is in
 * hand. checkImportGuardrail only takes a count, which means the rows already
 * exist — by then the memory is spent and the check is a formality.
 *
 * @param {string} tenantId
 * @param {string} filePath
 * @param {string} sourceFormat "csv" | "json" | "excel" | "sql"
 * @param {object} [options]
 * @param {string|null} [options.sqlTable] — target table for SQL dumps
 * @returns {Promise<{allowed: boolean, reason: string|null, limit: number, storageMode: string, records?: Array<object>, tableName?: string|null}>}
 */
export async function checkGuardrailStreaming(tenantId, filePath, sourceFormat, options = {}) {
  const { limit, storageMode } = await getImportRowLimit(tenantId);

  const { records, exceeded, tableName } = await parseStreaming(filePath, sourceFormat, limit, options);

  if (exceeded) {
    // The parse aborted, so the true row count is unknown by design — say
    // "more than N" rather than inventing a number.
    const details = describeGuardrailRejection(
      storageMode, "rows", { limit, current: `more than ${limit.toLocaleString("en-US")}` }
    );
    logger.warn(`[${SERVICE}] guardrail rejected import`, {
      tenantId, limit, storageMode, sourceFormat,
    });
    // tableName still travels on the reject path: the operator's next question
    // after "too many rows" is "in which table?", and a multi-table dump has
    // already resolved it by now.
    return { allowed: false, reason: details.reason, limit, storageMode, tableName: tableName ?? null, details };
  }

  return { allowed: true, reason: null, limit, storageMode, records, tableName: tableName ?? null };
}

/**
 * Decide whether an import of `rowCount` rows is allowed for this tenant,
 * based on which storage tier it's on.
 *
 * Count-only: the caller must already hold the rows, so this cannot bound the
 * memory used to produce them. Reach for checkGuardrailStreaming() instead when
 * a file path is available.
 *
 * @param {string} tenantId
 * @param {number} rowCount
 * @returns {Promise<{allowed: boolean, reason: string|null, limit: number, storageMode: string}>}
 */
export async function checkImportGuardrail(tenantId, rowCount) {
  const { limit, storageMode } = await getImportRowLimit(tenantId);

  if (rowCount > limit) {
    const details = describeGuardrailRejection(storageMode, "rows", { limit, current: rowCount });
    logger.warn(`[${SERVICE}] guardrail rejected import`, { tenantId, rowCount, limit, storageMode });
    return { allowed: false, reason: details.reason, limit, storageMode, details };
  }

  return { allowed: true, reason: null, limit, storageMode };
}
