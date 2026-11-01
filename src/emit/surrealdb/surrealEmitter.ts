// src/emit/surrealdb/surrealEmitter.ts
// Emits SurrealQL schema definitions (DEFINE TABLE / DEFINE FIELD / DEFINE INDEX)
// from a resolved schema. Targets SurrealDB 2.x SCHEMAFULL tables.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel } from "../../resolver/types.js";
import { isTableModel } from "../typeMapping.js";
import { tableIndexes } from "../sql/sqlIndexes.js";
import { renderCreateTable, collectEmbeddedModels, renderModelIndexDefine } from "./surrealDdl.js";

export const surrealEmitter: Emitter = {
  target: "surrealdb",
  fileExtension: "surql",

  emit(context: EmitContext): OutputFile[] {
    const embedded = collectEmbeddedModels(context.schema);
    const blocks: string[] = [];
    for (const record of context.schema.records.values()) {
      if (!isTableModel(record)) continue; // generic, @input and @value models have no table
      if (embedded.has(record.symbol.localName)) continue; // value object: embedded, not a table
      blocks.push(renderTable(record, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: `schema.${this.fileExtension}`, contents }];
  },
};

function renderTable(record: ResolvedModel, context: EmitContext): string {
  const table = renderCreateTable(record, context.schema, context.company, context.includePrivate);
  return [table, ...tableIndexes(record).map(renderModelIndexDefine)].join("\n");
}
