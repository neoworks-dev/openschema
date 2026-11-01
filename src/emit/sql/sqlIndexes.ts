// src/emit/sql/sqlIndexes.ts
// Model-level @index(fields: ["a", "b"], unique: true, name: "…") declarations,
// shared by the table emitters and the migration planner so an index renders and
// diffs the same way everywhere.

import type { Decorator } from "../../parser/ast.js";
import type { ResolvedField, ResolvedModel } from "../../resolver/types.js";
import { allDecorators, namedStringListArg } from "../typeMapping.js";
import { sqlColumnName, tableNameFor, type QuoteIdentifier } from "./sqlDdl.js";

/** One index of a table. */
export interface TableIndex {
  name: string;
  table: string;
  unique: boolean;
  fields: ResolvedField[];
  columns: string[];
}

/** The indexes a model declares, in declaration order. Throws on an unknown field. */
export function tableIndexes(record: ResolvedModel): TableIndex[] {
  const table = tableNameFor(record);
  return allDecorators(record.decorators, "index").map(decorator => tableIndex(record, table, decorator));
}

function tableIndex(record: ResolvedModel, table: string, decorator: Decorator): TableIndex {
  const fieldNames = namedStringListArg(decorator, "fields");
  if (fieldNames === null || fieldNames.length === 0) {
    throw new Error(`@index on ${record.symbol.localName} needs fields: ["…"]`);
  }
  const fields = fieldNames.map(fieldName => indexedField(record, fieldName));
  const columns = fields.map(field => sqlColumnName(field));
  return {
    name: indexName(decorator, table, columns),
    table,
    unique: namedArgIsTrue(decorator, "unique"),
    fields,
    columns,
  };
}

function indexedField(record: ResolvedModel, fieldName: string): ResolvedField {
  const field = record.fields.find(candidate => candidate.name === fieldName);
  if (field === undefined) {
    throw new Error(`@index on ${record.symbol.localName} names '${fieldName}', which is not one of its fields`);
  }
  return field;
}

function indexName(decorator: Decorator, table: string, columns: string[]): string {
  const explicit = decorator.args.find(arg => arg.name === "name");
  if (explicit !== undefined && explicit.value.kind === "string") return explicit.value.value;
  return `${table}_${columns.join("_")}_idx`;
}

function namedArgIsTrue(decorator: Decorator, argName: string): boolean {
  const arg = decorator.args.find(candidate => candidate.name === argName);
  if (arg === undefined) return false;
  return arg.value.kind === "bool" && arg.value.value;
}

/** `CREATE [UNIQUE] INDEX name ON table (a, b);` — the same in PostgreSQL and SQLite but for quoting. */
export function renderCreateIndex(index: TableIndex, quote: QuoteIdentifier): string {
  const columns = index.columns.map(quote).join(", ");
  const target = `${quote(index.name)} ON ${quote(index.table)} (${columns});`;
  if (index.unique) return `CREATE UNIQUE INDEX ${target}`;
  return `CREATE INDEX ${target}`;
}

/** `DROP INDEX name;` */
export function renderDropIndex(index: TableIndex, quote: QuoteIdentifier): string {
  return `DROP INDEX ${quote(index.name)};`;
}

/** A key that changes whenever anything about the index does. */
export function indexIdentity(index: TableIndex): string {
  return `${index.name}|${index.unique}|${index.table}|${index.columns.join(",")}`;
}
