// services/shared/importParser.service.js
// Bounded streaming parse engine for the Migration Wizard — shared by BOTH tiers.
//
// ── Why this file exists (extracted 2026-07-17) ──────────────────────────────
// This logic was written for, and lived inside, workers/migration/importPipeline.js
// (the Cloud Run entrypoint). Its own header said so explicitly: "NOT used by the
// Hetzner+BullMQ shared-tier path, which keeps migrationImport.service.js's
// existing fs.readFileSync approach (≤20k rows, small files fit in memory there)".
//
// That reasoning had a hole. The shared tier's row ceiling only *describes* what
// the tenant may import — it does not *bound* what they can upload. The old
// shared path read the whole file with fs.readFileSync and parsed it fully
// BEFORE checkImportGuardrail ever saw a row count, so the 20k ceiling cost 20k
// rows of memory to enforce and a 200k-row file cost 200k rows of memory to
// reject. "Small files fit in memory" was an assumption about well-behaved input,
// not a property the code enforced.
//
// So the fix was never to write a bounded parser for the shared tier — it was
// already written, proven, and running on the dedicated tier. It just had to
// stop being a worker-private detail. Both tiers now resolve the tenant's limit
// FIRST and parse through the same bounded engine, so the ceiling is enforced by
// construction rather than by trust.
//
// workers/migration/importPipeline.js re-exports parseStreaming/detectSourceFormat
// from here, so the Cloud Run path and its test suite are unchanged.
//
// Three principles, explicit because two were violated in the original code:
//
// 1. STREAMING — never load the whole file into a single string or buffer.
//    Both CSV and JSON paths read in chunks through Node transforms; only the
//    resulting parsed record objects accumulate in memory. A 500k-row import
//    with ~50 bytes/row stays well under 100MB of parsed objects, which is
//    fine for a 4GB container — and after staging, records are garbage-collected.
//
// 2. GUARDRAIL FIRST — the tenant's row ceiling is resolved BEFORE the file is
//    read, and the parse aborts the moment it reads one row past that ceiling.
//    Aborting mid-stream means a 5-million-row file costs `limit + 1` rows of
//    memory, not 5 million.
//
// 3. NO MULTER — this engine reads from a plain file path, never from a multer
//    File object. The shared tier passes multer's `file.path`; the Cloud Run
//    entrypoint passes the temp file it downloaded from GCS. Neither leaks its
//    transport into the parser.
//
// ── stream-json import style, and why it looks like this ────────────────────
// stream-json@1.9.1 is CommonJS and ships no `exports` map. Under this
// package's "type": "module" that means BOTH of these throw at load time:
//     import { parser } from "stream-json";                    // not a named export
//     import { streamArray } from "stream-json/streamers/StreamArray";  // needs .js
// Default-import the CJS namespace and destructure, and keep the `.js`.
//
// ── streamArray, NOT streamValues ──────────────────────────────────────────
// StreamValues is for a *sequence* of concatenated JSON values (JSON-lines
// style). A `[{...},{...}]` file is ONE value, so StreamValues emits the whole
// array as a single object: row counts came back as 1 regardless of file size
// (silently defeating the guardrail) and the array was then discarded by the
// object-shape filter, staging zero rows while reporting success. StreamArray
// emits one event per element, which is what this file needs.
import fs, { createReadStream } from "fs";
import { parse as csvParse } from "csv-parse";
import jsonStreamPkg from "stream-json";
import streamArrayPkg from "stream-json/streamers/StreamArray.js";
import { extractSqlTable } from "./sqlDumpParser.js";

const { parser: jsonParser } = jsonStreamPkg;
const { streamArray } = streamArrayPkg;

// ── Format detection ───────────────────────────────────────────────────────
// Path-based. migrationImport.service.js keeps its own mimetype-aware detector
// for the browser-upload path — a browser can mislabel a .csv as
// application/vnd.ms-excel, and only that path has a mimetype to disambiguate
// against. Both funnel into the same `sourceFormat` strings consumed here.

const CSV_EXT  = /\.csv$/i;
const JSON_EXT = /\.json$/i;
const XLSX_EXT = /\.xlsx$/i;
const XLS_EXT  = /\.xls$/i;
const SQL_EXT  = /\.sql$/i;

export function detectSourceFormat(filePath) {
  if (CSV_EXT.test(filePath))  return "csv";
  if (XLSX_EXT.test(filePath)) return "excel";
  if (XLS_EXT.test(filePath))  return "excel";
  if (JSON_EXT.test(filePath)) return "json";
  if (SQL_EXT.test(filePath))  return "sql";
  throw new Error(
    `Unsupported file format "${filePath}". Supported formats: CSV, JSON, Excel (.xlsx/.xls), SQL (.sql).`
  );
}

// ── Bounded streaming collection ──────────────────────────────────────────

/**
 * Drain a record-emitting stream into an array, aborting once it yields more
 * than `limit` records.
 *
 * The abort is the whole point: it bounds memory at `limit + 1` records no
 * matter how large the file is. Destroying the stream stops the read at the
 * OS level, so an oversized file is never fully read from disk either.
 *
 * @param {import("stream").Readable} stream — emits one record per "data" event
 * @param {number} limit — max records to accept before aborting
 * @param {(chunk: any) => any} extract — pull the record out of a data chunk;
 *   return undefined to skip the chunk
 * @returns {Promise<{records: Array<object>, exceeded: boolean}>}
 */
function collectBounded(stream, limit, extract) {
  return new Promise((resolve, reject) => {
    const records = [];
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      const value = extract(chunk);
      if (value === undefined) return;

      records.push(value);

      if (records.length > limit) {
        // One row past the ceiling is all we need to know it's over. Stop
        // reading and release the rows — the caller only needs the verdict.
        records.length = 0;
        stream.destroy();
        finish({ records: [], exceeded: true });
      }
    });

    stream.on("end",   () => finish({ records, exceeded: false }));
    stream.on("close", () => finish({ records, exceeded: false }));
    stream.on("error", fail);
  });
}

// ── Streaming parse (bounded) ─────────────────────────────────────────────

/**
 * Parse a CSV file, aborting past `limit` rows.
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<{records: Array<object>, exceeded: boolean}>}
 */
function parseCsvBounded(filePath, limit) {
  return new Promise((resolve, reject) => {
    // bom:true strips a UTF-8 BOM (U+FEFF) before header parsing — without it the
    // first column header arrives with a leading BOM char prepended, silently
    // breaking that column's field mapping for any file exported by Excel/Windows.
    const parser = csvParse({ columns: true, skip_empty_lines: true, trim: true, bom: true });
    const source = createReadStream(filePath);
    source.on("error", reject);

    collectBounded(source.pipe(parser), limit, (record) => record)
      .then(resolve, reject);
  });
}

/**
 * Assert that a JSON file's root is an array, reading only its first bytes.
 *
 * StreamArray silently yields nothing for a non-array root, which would look
 * identical to "an empty array" — the operator deserves the real reason.
 *
 * @param {string} filePath
 */
function assertJsonRootIsArray(filePath) {
  const MAX_LEADING_WHITESPACE = 100;
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1);

  try {
    for (let pos = 0; pos < MAX_LEADING_WHITESPACE; pos += 1) {
      const bytesRead = fs.readSync(fd, buffer, 0, 1, pos);
      if (bytesRead === 0) throw new Error("JSON file appears to be empty");

      const ch = String.fromCharCode(buffer[0]);
      if (ch === "[") return;               // array root — good
      if (/\s/.test(ch)) continue;          // leading whitespace/BOM — keep looking
      if (ch === "{") {
        throw new Error("JSON root must be an array of records, not a single object");
      }
      throw new Error(`JSON root must be an array of records — unexpected character "${ch}"`);
    }
    throw new Error(
      `JSON file starts with too much leading whitespace (limit: ${MAX_LEADING_WHITESPACE} chars)`
    );
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse a JSON array file, aborting past `limit` elements.
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<{records: Array<object>, exceeded: boolean}>}
 */
function parseJsonBounded(filePath, limit) {
  return new Promise((resolve, reject) => {
    try {
      assertJsonRootIsArray(filePath);
    } catch (err) {
      reject(err);
      return;
    }

    const source = createReadStream(filePath);
    source.on("error", reject);

    const stream = source.pipe(jsonParser()).pipe(streamArray());

    collectBounded(stream, limit, (data) => {
      const value = data?.value;
      // Skip non-object elements (e.g. a stray null or scalar in the array):
      // they carry no columns and would fail at staging anyway.
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
      }
      return value;
    }).then(resolve, reject);
  });
}

/**
 * Parse an Excel file, then check `limit`.
 *
 * Excel is the one format that cannot abort early: exceljs has no streaming
 * row API on the workbook reader, so the full workbook is loaded before any
 * row count is knowable. Accepted because a 500k-row .xlsx is not a realistic
 * migration input — CSV/JSON are the paths that carry the large files. The
 * byte ceiling (checkImportFileSize) is what bounds this format in practice.
 *
 * @param {string} filePath
 * @param {number} limit
 * @returns {Promise<{records: Array<object>, exceeded: boolean}>}
 */
/**
 * Coerce an exceljs cell to a plain import value.
 *
 * exceljs returns rich objects for several cell kinds, and the old code
 * (`value?.text ?? value`) only handled hyperlinks — a FORMULA cell has shape
 * `{formula, result}`, so `value.text` was undefined and the whole
 * `{formula, result}` OBJECT was staged as the field value instead of the
 * computed number. This reads the computed value for formulas, the joined text
 * for rich text/hyperlinks, keeps real Dates as Dates (Excel serial handling is
 * exceljs's job), and blanks error cells.
 */
function excelCellValue(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v)   return v.result ?? "";                       // formula → computed result
    if ("text" in v)     return typeof v.text === "string" ? v.text.trim() : v.text ?? ""; // hyperlink
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();             // rich text
    if ("error" in v)    return "";                                    // #REF!/#DIV0 etc.
    return cell.text ?? "";                                            // last resort: display text
  }
  return typeof v === "string" ? v.trim() : v;
}

async function parseExcelBounded(filePath, limit) {
  const { default: ExcelJS } = await import("exceljs");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    throw new Error(`Could not parse Excel file: ${err.message}`);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Could not parse Excel file: no worksheet found");
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const records = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (row.actualCellCount === 0) return;
    const record = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      record[header] = excelCellValue(cell);
    });
    records.push(record);
  });

  if (records.length > limit) return { records: [], exceeded: true };
  return { records, exceeded: false };
}

/**
 * Parse a SQL dump's target table, then check `limit`.
 *
 * Like Excel, this is not abort-early streaming: the dump is read whole (bounded
 * upstream by the file-size guardrail). Row materialisation IS bounded though —
 * sqlDump.parser stops one row past `limit` — so a table that blows the ceiling
 * costs `limit + 1` rows, matching the other formats' contract. The table is
 * chosen by `options.sqlTable`; a single-table dump auto-selects.
 *
 * `tableName` is passed back because it is a RESOLVED value, not an echo of the
 * input: a single-table dump auto-selects, so the caller often learns which
 * table it imported only from here. ImportJob.sqlTable stores it for
 * traceability, and dropping it would silently blank that field for exactly the
 * auto-select case that needs it most.
 *
 * @param {string} filePath
 * @param {number} limit
 * @param {string|null} sqlTable
 * @returns {Promise<{records: Array<object>, exceeded: boolean, tableName: string|null}>}
 */
async function parseSqlBounded(filePath, limit, sqlTable) {
  const sql = fs.readFileSync(filePath, "utf8");
  const { rows, exceeded, tableName } = extractSqlTable(sql, { sqlTable: sqlTable ?? null, limit });
  return { records: exceeded ? [] : rows, exceeded, tableName: tableName ?? null };
}

/**
 * Parse a file into records, aborting once it exceeds `limit` rows.
 *
 * @param {string} filePath
 * @param {string} sourceFormat "csv" | "json" | "excel" | "sql"
 * @param {number} [limit] — row ceiling; omit for no ceiling
 * @param {object} [options]
 * @param {string|null} [options.sqlTable] — target table for SQL dumps
 * @returns {Promise<{records: Array<object>, exceeded: boolean, tableName?: string|null}>}
 *   `tableName` is SQL-only — the resolved dump table (a single-table dump
 *   auto-selects, so this is the caller's only way to learn which one ran).
 */
export async function parseStreaming(filePath, sourceFormat, limit = Infinity, options = {}) {
  switch (sourceFormat) {
    case "csv":   return parseCsvBounded(filePath, limit);
    case "json":  return parseJsonBounded(filePath, limit);
    case "excel": return parseExcelBounded(filePath, limit);
    case "sql":   return parseSqlBounded(filePath, limit, options.sqlTable ?? null);
    default:      throw new Error(`Unknown sourceFormat "${sourceFormat}"`);
  }
}
