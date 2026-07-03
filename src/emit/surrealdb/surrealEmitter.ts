// src/emit/surrealdb/surrealEmitter.ts
// Emits SurrealQL schema definitions (DEFINE TABLE / DEFINE FIELD / DEFINE INDEX)
// from a resolved schema. Targets SurrealDB 2.x SCHEMAFULL tables.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel } from "../../resolver/types.js";
import { isInputModel } from "../typeMapping.js";
import { renderCreateTable, collectEmbeddedModels } from "./surrealDdl.js";

export const surrealEmitter: Emitter = {
  target: "surrealdb",
  fileExtension: "surql",

  emit(context: EmitContext): OutputFile[] {
    const embedded = collectEmbeddedModels(context.schema);
    const blocks: string[] = [];
    for (const record of context.schema.records.values()) {
      if (record.isGeneric) continue; // generic records are not directly emittable
      if (isInputModel(record)) continue; // input-only model: not a table
      if (embedded.has(record.symbol.localName)) continue; // value object: embedded, not a table
      blocks.push(renderTable(record, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: `schema.${this.fileExtension}`, contents }];
  },
};

function renderTable(record: ResolvedModel, context: EmitContext): string {
  return renderCreateTable(record, context.schema, context.company, context.includePrivate);
}
