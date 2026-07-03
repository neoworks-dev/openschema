// src/emit/migration/surrealMigrationEmitter.ts
// Renders a MigrationPlan into SurrealQL DEFINE / REMOVE statements. SurrealDB has
// no native table/field rename, so those become clearly-marked -- MANUAL blocks.

import type { OutputFile } from "../types.js";
import type { MigrationEmitContext, MigrationEmitter } from "./types.js";
import { migrationHeader } from "./types.js";
import type { MigrationOp } from "../../engine/migration.js";
import { describeType } from "../../engine/type-compat.js";
import { unwrapNullable, isInputModel } from "../typeMapping.js";
import {
  renderCreateTable, renderField, renderFieldDefine, surrealFieldName, tableNameFor,
} from "../surrealdb/surrealDdl.js";

export const surrealMigrationEmitter: MigrationEmitter = {
  target: "migration-surreal",
  fileExtension: "surql",

  emit(context: MigrationEmitContext): OutputFile[] {
    const blocks: string[] = [migrationHeader(context.plan, "--")];
    for (const op of context.plan.ops) {
      blocks.push(renderOp(op, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: "migration.surql", contents }];
  },
};

function renderOp(op: MigrationOp, ctx: MigrationEmitContext): string {
  switch (op.kind) {
    case "CreateModel":
      return renderCreateTable(op.model, ctx.newSchema, ctx.company, ctx.includePrivate);

    case "DropModel":
      return `-- DESTRUCTIVE: removing table "${op.table}" discards all its rows.\nREMOVE TABLE ${op.table};`;

    case "RenameModel":
      return [
        `-- MANUAL: SurrealDB cannot rename a table. Recreate "${op.newTable}", copy rows`,
        `-- from "${op.oldTable}", then: REMOVE TABLE ${op.oldTable};`,
        renderCreateTable(op.model, ctx.newSchema, ctx.company, ctx.includePrivate),
      ].join("\n");

    case "AddField": {
      if (op.safety === "needs_backfill") {
        return [
          `-- TODO backfill: field "${surrealFieldName(op.field)}" is required with no @default;`,
          `-- existing rows will fail validation until backfilled.`,
          ...renderField(op.table, op.field.name, op.field, ctx.newSchema),
        ].join("\n");
      }
      return renderField(op.table, op.field.name, op.field, ctx.newSchema).join("\n");
    }

    case "DropField":
      return `-- DESTRUCTIVE: removing field "${surrealFieldName(op.field)}".\nREMOVE FIELD ${surrealFieldName(op.field)} ON TABLE ${op.table};`;

    case "RenameField":
      return [
        `-- MANUAL: SurrealDB cannot rename a field. Define "${surrealFieldName(op.field)}", copy`,
        `-- from "${op.oldName}", then: REMOVE FIELD ${op.oldName} ON TABLE ${op.table};`,
        renderFieldDefine(op.table, op.field.name, op.field, ctx.newSchema),
      ].join("\n");

    case "ChangeFieldType":
      return renderChangeFieldType(op, ctx);

    case "ChangeFieldNullability": {
      // Re-DEFINE; the field type already carries the new nullability.
      const define = renderFieldDefine(op.table, op.field.name, op.field, ctx.newSchema);
      if (op.becameNullable) return define;
      return `-- TODO: ensure no NULL/NONE values before enforcing a required type.\n${define}`;
    }

    case "CreateEnum":
      return `-- enum ${op.enumName}: created (SurrealDB inlines enum values as field ASSERTs; no standalone type).`;

    case "DropEnum":
      return `-- enum ${op.enumName}: removed (was enforced via dependent fields' ASSERTs).`;

    case "RenameEnum":
      return `-- enum ${op.oldName} → ${op.newName}: renamed (values unchanged; dependent field ASSERTs unaffected).`;

    case "AddEnumVariant":
    case "DropEnumVariant":
    case "RenameEnumVariant": {
      const what =
        op.kind === "AddEnumVariant" ? `variant '${op.variant}' added`
        : op.kind === "DropEnumVariant" ? `variant '${op.variant}' removed`
        : `variant '${op.oldVariant}' → '${op.newVariant}' renamed`;
      const redefines = enumDependentRedefines(op.enumName, ctx);
      const header = `-- enum ${op.enumName}: ${what}; re-defining dependent fields' ASSERTs.`;
      if (redefines.length === 0) return header;
      return [header, ...redefines].join("\n");
    }
  }
}

function renderChangeFieldType(
  op: Extract<MigrationOp, { kind: "ChangeFieldType" }>,
  ctx: MigrationEmitContext,
): string {
  const newDefine = renderFieldDefine(op.table, op.field.name, op.field, ctx.newSchema);
  const oldField = { ...op.field, type: op.oldType };
  const oldDefine = renderFieldDefine(op.table, op.field.name, oldField, ctx.oldSchema);

  // No-op when both DSL types collapse to the same Surreal definition.
  if (newDefine === oldDefine) {
    return `-- no-op: "${surrealFieldName(op.field)}" changed ${describeType(op.oldType)} → ${describeType(op.field.type)} but the Surreal field type is unchanged.`;
  }

  if (op.safety === "lossy") {
    return [
      `-- LOSSY (${op.relation}): ${describeType(op.oldType)} → ${describeType(op.field.type)}; existing values may not fit. Add a cast/UPDATE if needed.`,
      newDefine,
      `-- UPDATE ${op.table} SET ${surrealFieldName(op.field)} = /* cast */ ${surrealFieldName(op.field)};`,
    ].join("\n");
  }
  return newDefine;
}

// Every field in the new schema whose type resolves to `enumName` — its ASSERT
// list changed, so re-issue its DEFINE FIELD (idempotent overwrite).
function enumDependentRedefines(enumName: string, ctx: MigrationEmitContext): string[] {
  const lines: string[] = [];
  for (const model of ctx.newSchema.records.values()) {
    if (model.isGeneric || isInputModel(model)) continue;
    const table = tableNameFor(model);
    for (const field of model.fields) {
      if (field.isPrivate && !ctx.includePrivate) continue;
      const inner = unwrapNullable(field.type).inner;
      if (inner.kind === "named" && inner.path[inner.path.length - 1] === enumName) {
        lines.push(renderFieldDefine(table, field.name, field, ctx.newSchema));
      }
    }
  }
  return lines;
}
