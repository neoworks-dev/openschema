// src/emit/sql/sqliteEmitter.ts
// Emits SQLite CREATE TABLE statements from a resolved schema.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import { isInputModel } from "../typeMapping.js";
import { renderCreateTableSqlite } from "./sqliteDdl.js";

export const sqliteEmitter: Emitter = {
  target: "sqlite",
  fileExtension: "sql",

  emit(context: EmitContext): OutputFile[] {
    const blocks: string[] = [];
    for (const record of context.schema.records.values()) {
      if (record.isGeneric) continue; // generic records are not directly emittable
      if (isInputModel(record)) continue; // input-only model: not a table
      blocks.push(renderCreateTableSqlite(record, context.schema, context.company, context.includePrivate));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: `schema.${this.fileExtension}`, contents }];
  },
};
