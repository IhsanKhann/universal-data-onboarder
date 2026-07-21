// services/shared/migrationImport.service.js
// Migration Wizard — Phase 1/2 foundation (MIGRATION_WIZARD_PLAN_2026-07-07.md
// §4 steps 2-3, §7 Phase 1+2). Owns the upload -> guardrail -> staging slice
// of the pipeline. Field mapping/validation/commit (Phase 6) live in
// importMapping/importValidation/importCommit.service.js and share this
// file's getImportJob() for tenant-scoped job lookups.
//
// CSV, JSON, Excel, and SQL-dump today. The parsing itself is NOT here — it
// lives in importParser.service.js, bounded and streaming, and is reached
// through checkGuardrailStreaming() so the tenant's row ceiling is resolved
// BEFORE the file is read. See §"Guardrail ordering" on createImportJob below
// for why that mattered enough to move.
import mongoose from "mongoose";
import { getImportJobModel } from "./adapters/mongoose/schemas/ImportJob.model.js";
import { getImportStagedRecordModel } from "./adapters/mongoose/schemas/ImportStagedRecord.model.js";
import { checkGuardrailStreaming, checkImportFileSize } from "../core/guardrail/streamingGuardrail.js";
import { envTierPolicy } from "../core/guardrail/tierPolicy.js";
import { singleConnectionResolver } from "../topology/ConnectionResolver.js";
import { localFsStorageAdapter } from "../storage/StorageAdapter.js";
import logger from "../utils/logger.js";

// Adapter references — override by assigning to these exports at startup.
// In the OfferBerries deployment, replace with the real adapters:
//   tierPolicy = getTenantConfig-based implementation
//   connectionResolver = mongooseTenantAdapter (reads from control plane)
//   storageAdapter = cloudinaryAdapter + gcsAdapter
export let tierPolicy = envTierPolicy;
export let connectionResolver = singleConnectionResolver;
export let storageAdapter = localFsStorageAdapter;

const SERVICE = "migrationImport.service";

const CSV_MIME_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);
const JSON_MIME_TYPES = new Set(["application/json", "text/plain"]);
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const SQL_MIME_TYPES = new Set(["application/sql", "text/x-sql"]);

// Which format this file is, purely from extension/mimetype — never trusts
// content until the matching parser below actually runs. Unknown types throw
// the same 400 shape every downstream caller (route/frontend) already
// handles, so adding a format here needs no error-handling changes upstream.
//
// Extension is checked first for every format: "application/vnd.ms-excel" is
// shared between legacy .xls and some CSV exports (see CSV_MIME_TYPES), so
// mimetype alone can't disambiguate .xls from a CSV a browser mislabels.
function detectSourceFormat(file) {
  const name = file.originalname || "";
  if (/\.json$/i.test(name)) return "json";
  if (/\.xlsx$/i.test(name) || EXCEL_MIME_TYPES.has(file.mimetype)) return "excel";
  if (/\.xls$/i.test(name)) return "excel";
  if (/\.csv$/i.test(name)) return "csv";
  if (/\.sql$/i.test(name) || SQL_MIME_TYPES.has(file.mimetype)) return "sql";
  if (JSON_MIME_TYPES.has(file.mimetype)) return "json";
  if (CSV_MIME_TYPES.has(file.mimetype)) return "csv";
  const err = new Error(
    `Unsupported file type "${file.mimetype}" (${file.originalname}). Supported formats: CSV, JSON, Excel, SQL.`
  );
  err.statusCode = 400;
  throw err;
}

// Human-facing format name for parse-failure messages. The parser layer speaks
// in lowercase sourceFormat keys; operators read "Excel", not "excel".
const FORMAT_LABEL = { csv: "CSV", json: "JSON", excel: "Excel", sql: "SQL" };

/**
 * Parse an uploaded file under the tenant's row ceiling, run the size guardrail,
 * archive the original file, and (if the guardrail passes) write one
 * ImportStagedRecord per row. Nothing here is written to any real business model
 * — plan §5: "nothing in the staging step is 'real' data yet."
 *
 * ── Guardrail ordering (fixed 2026-07-17) ───────────────────────────────────
 * This used to fs.readFileSync the whole file, parse it fully, and only THEN
 * call checkImportGuardrail(tenantId, records.length). The ceiling exists to
 * bound memory, and enforcing it that way spent the memory first: a 200k-row
 * upload cost 200k rows of heap to earn a rejection at 20k. The justification
 * ("≤20k rows, small files fit in memory") described what a well-behaved tenant
 * sends, not what the code accepted — the row limit governs what may be
 * IMPORTED, never what may be UPLOADED.
 *
 * checkGuardrailStreaming resolves the ceiling FIRST and aborts the parse one
 * row past it, so a rejected file costs `limit + 1` rows however large it is.
 * It is the same engine the Cloud Run tier already used; nothing here is new
 * code, it just stopped being unreachable from this path.
 *
 * @param {string} tenantId
 * @param {string} moduleName - free label ("hr"|"finance"|"businessops"), not yet validated against a schema registry
 * @param {import("multer").File} file - multer disk-storage file (has .path)
 * @param {string|null} [createdBy] - FinalizedEmployee id of the uploader
 * @param {import("mongoose").Connection} [conn] - tenant connection (req.db) — a dedicated/local-storage tenant's imports must land on their own DB, not the shared default
 */
export async function createImportJob(tenantId, moduleName, file, createdBy = null, conn = mongoose, options = {}) {
  const ImportJob = getImportJobModel(conn);
  const sourceFormat = detectSourceFormat(file);

  // Parse happens BEFORE the file is handed to the storage adapter — the
  // cloudinary/local adapters delete the local temp file after upload, and the
  // parser reads from file.path.
  let guardrail;
  try {
    guardrail = await checkGuardrailStreaming(tenantId, file.path, sourceFormat, {
      sqlTable: options.sqlTable ?? null,
    });
  } catch (err) {
    logger.warn(`[${SERVICE}] ${sourceFormat} parse failed`, { tenantId, error: err.message });
    if (err.statusCode) throw err; // already the right shape (e.g. tenant lookup 404)
    // The parser throws plain Errors. Some already carry their own "Could not
    // parse ..." prefix (Excel) or are self-describing (SQL's "No INSERT
    // statements ..."), so only prefix when the message doesn't already say it —
    // double-prefixing reads as a bug to whoever sees the toast.
    const message = err.message.startsWith("Could not parse")
      ? err.message
      : `Could not parse ${FORMAT_LABEL[sourceFormat] ?? sourceFormat} file: ${err.message}`;
    const parseErr = new Error(message);
    parseErr.statusCode = 400;
    throw parseErr;
  }

  // Empty on the rejected path by design: the parse aborted, so the rows were
  // never materialised — that is the whole point of aborting.
  const records = guardrail.records ?? [];

  const uploaded = await storageAdapter.upload(file, `migration-imports/${tenantId}`);

  const job = await ImportJob.create({
    tenantId,
    module: moduleName,
    sourceFormat,
    sqlTable: guardrail.tableName ?? null,
    status: guardrail.allowed ? "uploaded" : "guardrail_rejected",
    file: {
      originalName: file.originalname,
      publicId:     uploaded.public_id,
      url:          uploaded.secure_url ?? null,
      sizeBytes:    file.size,
    },
    // A rejected import reports totalRows: 0, not its true row count. The count
    // is unknowable without reading the whole file, which is exactly what the
    // abort refused to do — guardrail.reason carries "more than N" instead.
    counts: { totalRows: records.length, stagedRows: 0, errorRows: 0 },
    guardrail: {
      passed:    guardrail.allowed,
      reason:    guardrail.reason,
      limit:     guardrail.limit,
      checkedAt: new Date(),
      // Structured upgrade CTA travels on the rejected job so the wizard can
      // render an upgrade button off GET /imports/:id (resolved spec 2026-07-20).
      upgrade:   guardrail.details?.upgrade ?? null,
    },
    createdBy,
  });

  if (!guardrail.allowed) {
    return job;
  }

  try {
    await stageRows(tenantId, job._id, records, conn);
    job.status = "staged";
    job.counts.stagedRows = records.length;
    await job.save();
  } catch (err) {
    logger.error(`[${SERVICE}] staging failed`, { tenantId, importJobId: job._id, error: err.message });
    job.status = "failed";
    job.error = err.message;
    await job.save();
  }

  return job;
}

/**
 * Bulk-write one ImportStagedRecord per parsed row. `customFields` starts as
 * a full copy of `rawRow` — see ImportStagedRecord.model.js's header comment
 * for why (nothing is mapped yet, so every column is "unmatched" today).
 */
async function stageRows(tenantId, importJobId, records, conn = mongoose) {
  if (records.length === 0) return;
  const ImportStagedRecord = getImportStagedRecordModel(conn);

  const docs = records.map((row, rowIndex) => ({
    tenantId,
    importJobId,
    rowIndex,
    rawRow: row,
    customFields: { ...row },
  }));

  await ImportStagedRecord.insertMany(docs, { ordered: false });
}

export async function getImportJob(tenantId, importJobId, conn = mongoose) {
  const ImportJob = getImportJobModel(conn);
  const job = await ImportJob.findOne({ _id: importJobId, tenantId });
  if (!job) {
    const err = new Error("Import job not found");
    err.statusCode = 404;
    throw err;
  }
  return job;
}

// Paginated staged-row listing for the "review and fix" screen — mirrors
// listImportJobs's own shape exactly (filter/page/limit -> {items, total,
// page, limit}).
export async function listStagedRows(tenantId, importJobId, { status, page = 1, limit = 20 } = {}, conn = mongoose) {
  const ImportStagedRecord = getImportStagedRecordModel(conn);
  const filter = { tenantId, importJobId };
  if (status) filter.validationStatus = status;

  const numericPage  = Math.max(1, Number(page) || 1);
  const numericLimit = Math.min(200, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    ImportStagedRecord.find(filter)
      .sort({ rowIndex: 1 })
      .skip((numericPage - 1) * numericLimit)
      .limit(numericLimit),
    ImportStagedRecord.countDocuments(filter),
  ]);

  return { items, total, page: numericPage, limit: numericLimit };
}

export async function listImportJobs(tenantId, { status, page = 1, limit = 20 } = {}, conn = mongoose) {
  const ImportJob = getImportJobModel(conn);
  const filter = { tenantId };
  if (status) filter.status = status;

  const numericPage  = Math.max(1, Number(page) || 1);
  const numericLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    ImportJob.find(filter)
      .sort({ createdAt: -1 })
      .skip((numericPage - 1) * numericLimit)
      .limit(numericLimit),
    ImportJob.countDocuments(filter),
  ]);

  return { items, total, page: numericPage, limit: numericLimit };
}

// ── Dedicated-tier: begin upload (pre-signed URL) ────────────────────────────
//
// Creates an ImportJob with status "pending_upload" and returns a pre-signed
// GCS PUT URL. The browser uploads the file directly to GCS, then calls
// completeImportUpload() to verify and trigger the Cloud Run Job.
//
// The tenant's storageMode is checked via getTenantConfig inside this function;
// if the tenant does NOT have its own database (dedicated or byod), the caller
// (POST /imports) should have already routed to the multer path — this function
// asserts an own-database tenant explicitly and throws if not. Both dedicated
// and byod offload to Cloud Run: the pipeline connects to whichever database
// the tenant's dbConnectionString names, and owns the credential either way.
//
// @param {string} tenantId
// @param {string} moduleName — free label ("hr"|"finance"|"businessops")
// @param {string} fileName — original file name (used for GCS object path + format detection)
// @param {string|null} [createdBy] — FinalizedEmployee id of the uploader
// @param {import("mongoose").Connection} [conn] — tenant connection
// @param {object} [options]
// @param {number} [options.fileSizeBytes] — client-declared size, checked against the
//   tier's byte ceiling before an upload URL is issued. Client-declared and therefore
//   NOT trusted: completeImportUpload re-checks the real size from GCS metadata after
//   the upload. This check exists to refuse absurd uploads early, not to be authoritative.
// @returns {Promise<{importJob: object, uploadUrl: string, objectPath: string, bucketName: string}>}
export async function createImportJobDedicated(
  tenantId, moduleName, fileName, createdBy = null, conn = mongoose, options = {}
) {
  // Verify this tenant actually has its own database (dedicated or byod).
  // Uses the configured tierPolicy and connectionResolver.
  const { storageMode } = await tierPolicy.resolve(tenantId);
  if (!connectionResolver.hasOwnDatabase(storageMode)) {
    const err = new Error(
      `Tenant storage mode is "${storageMode}" — the offloaded upload path requires the tenant's own ` +
      "database (dedicated or byod). Use the shared-tier upload path instead."
    );
    err.statusCode = 400;
    throw err;
  }

  // Cheap pre-upload guardrail (CHECKLIST §4a) — refuse before issuing a URL.
  const { fileSizeBytes } = options;
  if (fileSizeBytes != null) {
    const sizeCheck = await checkImportFileSize(tenantId, fileSizeBytes);
    if (!sizeCheck.allowed) {
      const err = new Error(sizeCheck.reason);
      err.statusCode = 413;
      err.details = sizeCheck.details ?? null; // structured upgrade CTA
      throw err;
    }
  }

  const ImportJob = getImportJobModel(conn);

  // Detect format from filename.
  const extension = fileName.match(/\.([a-z0-9]+)$/i);
  if (!extension) {
    const err = new Error(
      `Unsupported file format "${fileName}". Supported formats: CSV, JSON, Excel (.xlsx/.xls).`
    );
    err.statusCode = 400;
    throw err;
  }
  const ext = extension[1].toLowerCase();
  let sourceFormat;
  if (ext === "csv") sourceFormat = "csv";
  else if (ext === "json") sourceFormat = "json";
  else if (ext === "xlsx" || ext === "xls") sourceFormat = "excel";
  else if (ext === "sql") sourceFormat = "sql";
  else {
    const err = new Error(
      `Unsupported file format ".${ext}". Supported formats: CSV, JSON, Excel (.xlsx/.xls), SQL (.sql).`
    );
    err.statusCode = 400;
    throw err;
  }

  // Mint the id up front so the GCS object path (which embeds it) is known
  // before the document is written. The job is then created in ONE write with
  // its gcs sub-document already populated.
  //
  // This ordering is load-bearing, not tidiness: file.publicId is required
  // unless gcs.objectPath is set (the dedicated tier has no Cloudinary archive
  // to key off — see ImportJob.model.js). Creating first and attaching gcs
  // afterwards therefore fails validation on the create itself. It also removes
  // a window in which a pending_upload job existed with no object path — a
  // state completeImportUpload() explicitly rejects.
  const importJobId = new mongoose.Types.ObjectId();

  // Pre-signed URL first: if this throws (e.g. GCS_BUCKET_NAME unset), no
  // orphan ImportJob is left behind for an upload that can never arrive.
  const { uploadUrl, objectPath, bucketName } = await storageAdapter.generateUploadUrl(
    tenantId, importJobId, fileName
  );

  // Create the ImportJob in "pending_upload" status — no file uploaded yet,
  // no rows parsed, no guardrail check possible.
  const job = await ImportJob.create({
    _id: importJobId,
    tenantId,
    module: moduleName,
    sourceFormat,
    // Stored unresolved (the operator-supplied table name); the Cloud Run
    // entrypoint resolves/validates it against the dump when it parses. Null
    // for non-SQL formats and single-table dumps (auto-selected downstream).
    sqlTable: options.sqlTable ?? null,
    status: "pending_upload",
    file: {
      originalName: fileName,
      publicId:     null,   // no Cloudinary archive on this tier
      url:          null,
      sizeBytes:    0,
    },
    gcs: { objectPath, bucketName, executionName: null },
    counts: { totalRows: 0, stagedRows: 0, errorRows: 0 },
    guardrail: {
      passed:    null,
      reason:    null,
      limit:     null,
      checkedAt: null,
    },
    createdBy,
  });

  logger.info(`[${SERVICE}] dedicated import initiated`, {
    tenantId, importJobId: String(job._id), objectPath, sourceFormat,
  });

  return { importJob: job, uploadUrl, objectPath, bucketName };
}

// ── Dedicated-tier: complete upload (HEAD verify + Cloud Run trigger) ────────
//
// Called by the browser after it PUT the file to the pre-signed URL. The
// server:
//   1. Loads the ImportJob (must be in "pending_upload" status).
//   2. Issues a GCS HEAD request to verify the file exists.
//   3. Updates the ImportJob status to "uploaded" with GCS metadata.
//   4. Triggers the Cloud Run Job with the tenant ID, import job ID, and
//      GCS object path as env vars.
//
// @param {string} tenantId
// @param {string} importJobId
// @param {import("mongoose").Connection} [conn] — tenant connection
// @returns {Promise<{importJob: object, executionName: string}>}
export async function completeImportUpload(tenantId, importJobId, conn = mongoose) {
  const ImportJob = getImportJobModel(conn);
  const job = await ImportJob.findOne({ _id: importJobId, tenantId });

  if (!job) {
    const err = new Error("Import job not found");
    err.statusCode = 404;
    throw err;
  }

  if (job.status !== "pending_upload") {
    const err = new Error(
      `Cannot complete upload for import job in status "${job.status}" — expected "pending_upload"`
    );
    err.statusCode = 409;
    throw err;
  }

  if (!job.gcs?.objectPath || !job.gcs?.bucketName) {
    const err = new Error(
      "Import job has no GCS object path — it was not created via the dedicated-tier upload flow"
    );
    err.statusCode = 400;
    throw err;
  }

  // HEAD-verify the file exists on GCS.
  const { exists, sizeBytes } = await storageAdapter.verifyUpload(
    job.gcs.bucketName, job.gcs.objectPath
  );

  if (!exists) {
    const err = new Error(
      "File not found on GCS staging bucket — the upload may not have completed. " +
      "Please upload the file to the pre-signed URL, then retry."
    );
    err.statusCode = 400;
    throw err;
  }

  // Re-check the byte ceiling against the size GCS actually reports. The
  // pre-upload check in createImportJobDedicated used a client-declared size,
  // and nothing stops a client from declaring 1KB and then PUTting 50GB — the
  // signed URL does not enforce a length. This is the authoritative check, and
  // it runs before we spend a Cloud Run execution on the file.
  const sizeCheck = await checkImportFileSize(tenantId, sizeBytes);
  if (!sizeCheck.allowed) {
    job.status = "guardrail_rejected";
    job.file.sizeBytes = sizeBytes;
    job.guardrail = {
      passed: false,
      reason: sizeCheck.reason,
      limit: sizeCheck.limitBytes,
      checkedAt: new Date(),
      upgrade: sizeCheck.details?.upgrade ?? null,
    };
    await job.save();

    const err = new Error(sizeCheck.reason);
    err.statusCode = 413;
    err.details = sizeCheck.details ?? null; // structured upgrade CTA
    throw err;
  }

  // Update the ImportJob with the verified file metadata.
  job.status = "uploaded";
  job.file.sizeBytes = sizeBytes;
  await job.save();

  // Trigger the processing job (Cloud Run in OfferBerries deployment).
  const { executionName } = await storageAdapter.triggerProcessingJob(
    tenantId, String(job._id), {
      bucketName: job.gcs.bucketName,
      objectPath: job.gcs.objectPath,
    }
  );

  // Store the execution name for traceability.
  job.gcs.executionName = executionName;
  await job.save();

  logger.info(`[${SERVICE}] dedicated import upload complete`, {
    tenantId, importJobId: String(job._id), executionName, sizeBytes,
  });

  return { importJob: job, executionName };
}
