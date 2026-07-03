// src/emit/sql/sqlEmitter.ts
// Emits PostgreSQL CREATE TABLE statements from a resolved schema.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel } from "../../resolver/types.js";
import type { EnumDecl } from "../../parser/ast.js";
import { isInputModel } from "../typeMapping.js";
import { renderCreateTable, renderCreateEnum } from "./sqlDdl.js";

export const sqlEmitter: Emitter = {
  target: "sql",
  fileExtension: "sql",

  emit(context: EmitContext): OutputFile[] {
    const blocks: string[] = [];
    // Native enum types must be declared before the tables that use them.
    for (const symbol of context.schema.enums.values()) {
      blocks.push(renderCreateEnum(symbol.decl as EnumDecl));
    }
    for (const record of context.schema.records.values()) {
      if (record.isGeneric) continue; // generic records are not directly emittable
      if (isInputModel(record)) continue; // input-only model: not a table
      blocks.push(renderTable(record, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: `schema.${this.fileExtension}`, contents }];
  },
};

function renderTable(record: ResolvedModel, context: EmitContext): string {
  return renderCreateTable(record, context.schema, context.company, context.includePrivate);
}
