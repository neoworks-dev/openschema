// src/emit/sql/sqliteEmitter.ts
// Emits SQLite CREATE TABLE statements from a resolved schema.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel } from "../../resolver/types.js";
import { isTableModel } from "../typeMapping.js";
import { renderCreateTableSqlite } from "./sqliteDdl.js";
import { quoteSqliteIdentifier } from "./sqlIdentifiers.js";
import { renderCreateIndex, tableIndexes } from "./sqlIndexes.js";

export const sqliteEmitter: Emitter = {
  target: "sqlite",
  fileExtension: "sql",

  emit(context: EmitContext): OutputFile[] {
    const blocks: string[] = [];
    for (const record of context.schema.records.values()) {
      if (!isTableModel(record)) continue; // generic, @input and @value models have no table
      blocks.push(renderTable(record, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: `schema.${this.fileExtension}`, contents }];
  },
};

function renderTable(record: ResolvedModel, context: EmitContext): string {
  const table = renderCreateTableSqlite(record, context.schema, context.company, context.includePrivate);
  const indexes = tableIndexes(record).map(index => renderCreateIndex(index, quoteSqliteIdentifier));
  return [table, ...indexes].join("\n");
}
