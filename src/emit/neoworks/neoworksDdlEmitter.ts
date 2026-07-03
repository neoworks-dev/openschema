// src/emit/neoworks/neoworksDdlEmitter.ts
// Emits the neoworks client-database SurrealQL DDL directly from a resolved schema.
// This replaces the DDL generation that used to live in the neoworks Go API
// (rewriteSchemaInput): the compiler now owns codegen end-to-end, and the API
// applies these statements verbatim to the organization's dedicated instance.
//
// It reuses the "internal" emitter to resolve each model into the neoworks table
// shape (kind / visibility / history / subjectPath / fields / indexes) and then
// injects the data-plane ownership contract:
//   - data      → subject_user_id (per-user row ownership) + its index
//   - internal  → no owner column (the whole instance belongs to one org)
//   - relation/helper → no owner column (traced to a user via subjectPath metadata)
//   - non-private / internal tables get server-managed created_at/updated_at
//   - @neoworks.history → the versioned triple (current + _version + derived_from)
//   - shared visibility → a companion <table>_grant relation
//   - fulltext indexes → a shared BM25 analyzer, provisioned first
//
// The statement text mirrors the former Go output exactly so existing databases
// re-apply cleanly (every DEFINE uses OVERWRITE / IF NOT EXISTS).

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import { internalEmitter, type InternalTable, type InternalIndex, type InternalSchema } from "../internal/internalEmitter.js";

const DEFAULT_ANALYZER = "text_en";

export const neoworksDdlEmitter: Emitter = {
  target: "neoworks-ddl",
  fileExtension: "surql",

  emit(context: EmitContext): OutputFile[] {
    const internal = JSON.parse(internalEmitter.emit(context)[0].contents) as InternalSchema;
    const statements = buildDdl(internal.tables);
    return [{ path: "schema.surql", contents: statements.join("\n") + (statements.length > 0 ? "\n" : "") }];
  },
};

// buildDdl flattens all tables' DDL in declaration order, mirroring the neoworks
// API's former rewriteSchemaInput: fulltext analyzers first, then each table
// (with the shared derived_from relation prepended to the first versioned table).
export function buildDdl(tables: InternalTable[]): string[] {
  const perTable: string[][] = [];
  let derivedFromEmitted = false;

  for (const table of tables) {
    const versioned = table.history === true;
    let ddl = versioned ? versionedTableDdl(table) : plainTableDdl(table);
    if ((table.visibility ?? "private") === "shared") {
      ddl = ddl.concat(grantTableDdl(table.name));
    }
    // A single shared derived_from relation serves every versioned table.
    if (versioned && !derivedFromEmitted) {
      ddl = ["DEFINE TABLE IF NOT EXISTS `derived_from` TYPE RELATION;", ...ddl];
      derivedFromEmitted = true;
    }
    perTable.push(ddl);
  }

  const analyzers = fulltextAnalyzers(tables);
  const analyzerStmts = analyzers.map(analyzerDdl);

  return [...analyzerStmts, ...perTable.flat()];
}

function injectsSubject(table: InternalTable): boolean {
  return (table.kind || "data") === "data";
}

// Internal tables and any non-private table carry server timestamps so callers
// can sort by recency; private user data does not.
function needsTimestamps(table: InternalTable): boolean {
  return (table.kind || "data") === "internal" || (table.visibility ?? "private") !== "private";
}

function tableKeyword(table: InternalTable): string {
  return table.schemafull ? "SCHEMAFULL" : "SCHEMALESS";
}

function plainTableDdl(table: InternalTable): string[] {
  const stmts: string[] = [`DEFINE TABLE IF NOT EXISTS \`${table.name}\` ${tableKeyword(table)};`];
  if (injectsSubject(table)) {
    stmts.push(fieldDdl(table.name, "subject_user_id", "string", ""), subjectIndexDdl(table.name));
  }
  for (const field of table.fields) {
    stmts.push(fieldDdl(table.name, field.name, field.type, ""));
  }
  if (needsTimestamps(table)) {
    stmts.push(
      `DEFINE FIELD OVERWRITE \`created_at\` ON \`${table.name}\` TYPE datetime VALUE $before OR time::now() READONLY;`,
      `DEFINE FIELD OVERWRITE \`updated_at\` ON \`${table.name}\` TYPE datetime VALUE time::now();`,
    );
  }
  for (const index of table.indexes) {
    stmts.push(indexDdl(table.name, index));
  }
  return stmts;
}

// The current table, the append-only _version table, and the version pointer,
// following the neoworks versioning convention.
function versionedTableDdl(table: InternalTable): string[] {
  const current = table.name;
  const history = `${table.name}_version`;
  const injectSubject = injectsSubject(table);

  const stmts: string[] = [`DEFINE TABLE IF NOT EXISTS \`${current}\` ${tableKeyword(table)};`];
  if (injectSubject) {
    stmts.push(fieldDdl(current, "subject_user_id", "string", ""), subjectIndexDdl(current));
  }
  for (const field of table.fields) {
    stmts.push(fieldDdl(current, field.name, field.type, ""));
  }
  stmts.push(
    `DEFINE FIELD OVERWRITE \`created_at\` ON \`${current}\` TYPE datetime VALUE $before OR time::now() READONLY;`,
    `DEFINE FIELD OVERWRITE \`updated_at\` ON \`${current}\` TYPE datetime VALUE time::now();`,
    `DEFINE FIELD OVERWRITE \`version\` ON \`${current}\` TYPE option<record<\`${history}\`>>;`,
  );
  for (const index of table.indexes) {
    stmts.push(indexDdl(current, index));
  }

  // Append-only history table: data fields mirrored as READONLY.
  stmts.push(`DEFINE TABLE IF NOT EXISTS \`${history}\` ${tableKeyword(table)};`);
  stmts.push(`DEFINE FIELD OVERWRITE \`${current}_id\` ON \`${history}\` TYPE record<\`${current}\`> READONLY;`);
  if (injectSubject) {
    stmts.push(fieldDdl(history, "subject_user_id", "string", "READONLY"));
  }
  for (const field of table.fields) {
    stmts.push(fieldDdl(history, field.name, field.type, "READONLY"));
  }
  stmts.push(
    `DEFINE FIELD OVERWRITE \`created_at\` ON \`${history}\` TYPE datetime VALUE time::now() READONLY;`,
    `DEFINE INDEX OVERWRITE \`idx_${history}_parent\` ON \`${history}\` FIELDS \`${current}_id\`;`,
  );
  return stmts;
}

// The <table>_grant relation backing a shared table: (row, grantee) pairs.
function grantTableDdl(table: string): string[] {
  const grant = `${table}_grant`;
  return [
    `DEFINE TABLE IF NOT EXISTS \`${grant}\` SCHEMAFULL;`,
    `DEFINE FIELD OVERWRITE \`row\` ON \`${grant}\` TYPE record<\`${table}\`> READONLY;`,
    `DEFINE FIELD OVERWRITE \`grantee_user_id\` ON \`${grant}\` TYPE string READONLY;`,
    `DEFINE FIELD OVERWRITE \`created_at\` ON \`${grant}\` TYPE datetime VALUE time::now() READONLY;`,
    `DEFINE INDEX OVERWRITE \`idx_${grant}_unique\` ON \`${grant}\` FIELDS \`row\`, \`grantee_user_id\` UNIQUE;`,
    `DEFINE INDEX OVERWRITE \`idx_${grant}_grantee\` ON \`${grant}\` FIELDS \`grantee_user_id\`;`,
  ];
}

function subjectIndexDdl(table: string): string {
  return `DEFINE INDEX OVERWRITE \`idx_${table}_subject_user\` ON \`${table}\` FIELDS \`subject_user_id\`;`;
}

function indexDdl(table: string, index: InternalIndex): string {
  const fields = index.fields.map((f) => `\`${f}\``).join(", ");
  if (index.fulltext === true) {
    return `DEFINE INDEX OVERWRITE \`${index.name}\` ON \`${table}\` FIELDS ${fields} FULLTEXT ANALYZER \`${analyzerFor(index)}\` BM25 HIGHLIGHTS;`;
  }
  const unique = index.unique === true ? " UNIQUE" : "";
  return `DEFINE INDEX OVERWRITE \`${index.name}\` ON \`${table}\` FIELDS ${fields}${unique};`;
}

function analyzerDdl(name: string): string {
  return `DEFINE ANALYZER OVERWRITE \`${name}\` TOKENIZERS blank, class FILTERS lowercase, ascii, snowball(english);`;
}

function analyzerFor(index: InternalIndex): string {
  const analyzer = index.analyzer?.trim();
  return analyzer && analyzer.length > 0 ? analyzer : DEFAULT_ANALYZER;
}

// Distinct analyzer names used by fulltext indexes across all tables, first-seen.
function fulltextAnalyzers(tables: InternalTable[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const table of tables) {
    for (const index of table.indexes) {
      if (index.fulltext !== true) continue;
      const name = analyzerFor(index);
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

// SurrealDB needs FLEXIBLE to store arbitrary nested content (object/any) on a
// SCHEMAFULL table, including when wrapped in option/array/set.
function fieldTypeNeedsFlexible(type: string): boolean {
  const t = type.trim();
  for (const prefix of ["option<", "array<", "set<"]) {
    if (t.startsWith(prefix) && t.endsWith(">")) {
      return fieldTypeNeedsFlexible(t.slice(prefix.length, t.length - 1));
    }
  }
  return t === "object" || t === "any";
}

function fieldDdl(table: string, name: string, type: string, suffix: string): string {
  const flexible = fieldTypeNeedsFlexible(type) ? " FLEXIBLE" : "";
  const trailing = suffix !== "" ? ` ${suffix}` : "";
  return `DEFINE FIELD OVERWRITE \`${name}\` ON \`${table}\` TYPE ${type}${flexible}${trailing};`;
}
