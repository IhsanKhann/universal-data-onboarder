// services/shared/sqlDump.parser.js
// Migration Wizard — Phase 5 (MIGRATION_WIZARD_PLAN_2026-07-07.md §7 / §8) and
// MIGRATION_WIZARD_TIERED_EXTENSION_MASTER_PLAN §0.1's "container-as-sandbox"
// resolution: a SQL dump is just another source format. The Cloud Run Job (or
// the shared-tier Hetzner process) is itself the isolation boundary, so no
// mysql2/pg client and no embedded database engine are needed — this parser
// reads INSERT statements directly into row objects and hands them to the same
// stage → map → validate → commit pipeline every other format uses.
//
// ── Scope (v1) ───────────────────────────────────────────────────────────────
// Supports INSERT-statement dumps WITH explicit column lists, i.e.:
//     INSERT INTO `employees` (`id`,`name`) VALUES (1,'Ana'),(2,'Ben');
// This is what `mysqldump --complete-insert` and `pg_dump --column-inserts`
// produce. Two forms are deliberately NOT supported and fail with a clear
// message rather than silently:
//   - column-less INSERTs (`INSERT INTO t VALUES (...)`) — there is nothing to
//     map columns onto; re-dump with column names.
//   - COPY-format dumps (pg_dump's default) — not INSERT statements at all.
//
// A SQL dump holds many tables but the wizard imports ONE entity per job, so
// the caller names the table via `sqlTable`; if the dump has exactly one table
// it is auto-selected, and if it has several with none named the error lists
// them so the operator retries with one specified.
//
// ── Memory ───────────────────────────────────────────────────────────────────
// Like the Excel path, this reads the whole SQL text (bounded upstream by the
// file-size guardrail: 25MB shared / 512MB dedicated). Row materialisation is
// still bounded: extractSqlTable stops accumulating one row past `limit`, so a
// dump that blows the tenant's row ceiling costs `limit + 1` rows of objects,
// not the whole table — matching every other format's guardrail-first contract.

const INSERT_PREFIX = /INSERT\s+INTO\s+([^\s(]+)\s*(?:\(([^)]*)\))?\s+VALUES/gi;

/**
 * Strip quoting/qualification off a SQL identifier.
 * `\`schema\`.\`users\`` / `"public"."users"` / `[users]` → `users`.
 */
function unquoteIdent(raw) {
  let ident = String(raw).trim();
  // Take the last dot-segment (drop a schema/database qualifier). Split on dots
  // that sit OUTSIDE quoting — identifiers rarely contain quoted dots, so a
  // plain split on "." after de-quoting each segment is sufficient here.
  const segments = ident.split(".");
  ident = segments[segments.length - 1].trim();
  // Strip a single matching pair of backticks, double-quotes, or brackets.
  if (
    (ident.startsWith("`") && ident.endsWith("`")) ||
    (ident.startsWith('"') && ident.endsWith('"')) ||
    (ident.startsWith("'") && ident.endsWith("'"))
  ) {
    ident = ident.slice(1, -1);
  } else if (ident.startsWith("[") && ident.endsWith("]")) {
    ident = ident.slice(1, -1);
  }
  return ident.replace(/``/g, "`").replace(/""/g, '"');
}

/** Split a column list (`\`a\`,\`b\`, c`) into clean names. */
function splitColumns(colsRaw) {
  return colsRaw
    .split(",")
    .map((c) => unquoteIdent(c))
    .filter((c) => c.length > 0);
}

const WS = /\s/;

/**
 * Read a single-quoted SQL string literal starting at `sql[i] === "'"`.
 * Handles the two escape conventions dumps use: doubled quotes (`''` → `'`,
 * the SQL standard, what pg_dump emits) and backslash escapes (`\'`, `\\`,
 * `\n`…, what mysqldump emits). Returns the decoded value and the index just
 * past the closing quote.
 */
function readSqlString(sql, i) {
  const n = sql.length;
  i += 1; // skip opening quote
  let out = "";
  while (i < n) {
    const c = sql[i];
    if (c === "\\") {
      const nx = sql[i + 1];
      switch (nx) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "0": out += "\0"; break;
        case "b": out += "\b"; break;
        case "Z": out += "\x1a"; break;
        default:  out += nx ?? ""; break; // \' \" \\ and anything else → the literal char
      }
      i += 2;
      continue;
    }
    if (c === "'") {
      if (sql[i + 1] === "'") { out += "'"; i += 2; continue; } // '' → literal '
      return { value: out, next: i + 1 }; // closing quote
    }
    out += c;
    i += 1;
  }
  const err = new Error("Malformed SQL dump: unterminated string literal");
  err.statusCode = 400;
  throw err;
}

/** NULL → null, numeric → Number, empty → "", everything else → the raw token. */
function interpretUnquoted(token) {
  const t = token.trim();
  if (t === "") return "";
  if (/^null$/i.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/**
 * Parse one `( … )` value tuple. `i` points just past the opening `(`.
 * Returns the array of values and the index just past the closing `)`.
 */
function parseTuple(sql, i) {
  const n = sql.length;
  const values = [];
  while (i < n) {
    while (i < n && WS.test(sql[i])) i += 1; // leading whitespace

    if (sql[i] === ")") return { values, next: i + 1 }; // empty tuple / trailing

    if (sql[i] === "'") {
      const { value, next } = readSqlString(sql, i);
      values.push(value);
      i = next;
    } else {
      const start = i;
      while (i < n && sql[i] !== "," && sql[i] !== ")") i += 1;
      values.push(interpretUnquoted(sql.slice(start, i)));
    }

    while (i < n && WS.test(sql[i])) i += 1; // whitespace before delimiter
    if (sql[i] === ",") { i += 1; continue; }
    if (sql[i] === ")") return { values, next: i + 1 };

    const err = new Error("Malformed SQL dump: expected ',' or ')' in a VALUES tuple");
    err.statusCode = 400;
    throw err;
  }
  const err = new Error("Malformed SQL dump: unterminated VALUES tuple");
  err.statusCode = 400;
  throw err;
}

/**
 * Scan a dump once. Always advances past every tuple (so the INSERT-prefix
 * regex never resumes inside string data). Collects distinct table names; when
 * `targetTable` is set, materialises that table's rows only, aborting one row
 * past `limit`.
 *
 * @returns {{ tableNames: string[], rows: object[]|null, targetHadColumns: boolean, exceeded: boolean }}
 */
function scanSqlDump(sql, { targetTable = null, limit = Infinity } = {}) {
  const n = sql.length;
  const tableNames = [];
  const seen = new Set();
  const rows = targetTable ? [] : null;
  let targetHadColumns = false;
  let targetSeen = false;

  INSERT_PREFIX.lastIndex = 0;
  let m;
  while ((m = INSERT_PREFIX.exec(sql)) !== null) {
    const tableName = unquoteIdent(m[1]);
    const columns = m[2] != null ? splitColumns(m[2]) : null;

    if (!seen.has(tableName)) { seen.add(tableName); tableNames.push(tableName); }

    const isTarget = targetTable != null && tableName === targetTable;
    if (isTarget) { targetSeen = true; targetHadColumns = columns != null && columns.length > 0; }

    // Walk this statement's tuples from just after VALUES, always advancing.
    let i = INSERT_PREFIX.lastIndex;
    while (i < n) {
      while (i < n && (WS.test(sql[i]) || sql[i] === ",")) i += 1;
      if (i >= n || sql[i] === ";") { if (sql[i] === ";") i += 1; break; }
      if (sql[i] !== "(") break; // not a tuple — end of this statement's values
      const { values, next } = parseTuple(sql, i + 1);
      i = next;

      if (isTarget && targetHadColumns) {
        const row = {};
        columns.forEach((col, idx) => { row[col] = idx < values.length ? values[idx] : null; });
        rows.push(row);
        if (rows.length > limit) {
          // Verdict reached — memory bounded to limit+1. In the row pass the
          // target table is already known, so an early return can't lose names.
          return { tableNames, rows: [], targetHadColumns, exceeded: true };
        }
      }
    }
    INSERT_PREFIX.lastIndex = i;
  }

  return {
    tableNames,
    rows: targetTable && targetSeen ? rows : targetTable ? [] : null,
    targetHadColumns,
    exceeded: false,
  };
}

/** Distinct table names that have INSERT statements in the dump. */
export function listSqlTables(sql) {
  return scanSqlDump(sql, { targetTable: null }).tableNames;
}

/**
 * Resolve which table to import and return its rows.
 *
 * @param {string} sql — full dump text
 * @param {object} [opts]
 * @param {string|null} [opts.sqlTable] — operator-chosen table; auto-selected when the dump has exactly one
 * @param {number} [opts.limit] — row ceiling; rows stop one past it and `exceeded` is true
 * @returns {{ tableName: string, rows: object[], exceeded: boolean }}
 */
export function extractSqlTable(sql, { sqlTable = null, limit = Infinity } = {}) {
  const tableNames = listSqlTables(sql);

  if (tableNames.length === 0) {
    const err = new Error(
      "No INSERT statements found in the SQL file. Only INSERT-format dumps with " +
      "column names are supported (e.g. mysqldump --complete-insert, pg_dump --column-inserts). " +
      "COPY-format dumps are not supported."
    );
    err.statusCode = 400;
    throw err;
  }

  let tableName;
  if (sqlTable) {
    tableName = unquoteIdent(sqlTable);
    if (!tableNames.includes(tableName)) {
      const err = new Error(
        `Table "${tableName}" not found in the SQL file. Available tables: ${tableNames.join(", ")}.`
      );
      err.statusCode = 400;
      throw err;
    }
  } else if (tableNames.length === 1) {
    [tableName] = tableNames;
  } else {
    const err = new Error(
      `The SQL file contains ${tableNames.length} tables — specify which one to import ` +
      `via "sqlTable". Available tables: ${tableNames.join(", ")}.`
    );
    err.statusCode = 400;
    throw err;
  }

  const { rows, targetHadColumns, exceeded } = scanSqlDump(sql, { targetTable: tableName, limit });

  if (!exceeded && !targetHadColumns) {
    const err = new Error(
      `Table "${tableName}" has INSERT statements without column names, so its columns cannot be ` +
      "mapped. Re-export with column names (mysqldump --complete-insert or pg_dump --column-inserts)."
    );
    err.statusCode = 400;
    throw err;
  }

  return { tableName, rows: exceeded ? [] : rows, exceeded };
}
