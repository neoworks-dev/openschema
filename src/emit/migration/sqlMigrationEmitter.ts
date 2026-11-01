// src/emit/migration/sqlMigrationEmitter.ts
// Renders a MigrationPlan into PostgreSQL ALTER TABLE / DDL statements.

import type { OutputFile } from "../types.js";
import type { MigrationEmitContext, MigrationEmitter } from "./types.js";
import { migrationHeader } from "./types.js";
import type { MigrationOp } from "../../engine/migration.js";
import { describeType } from "../../engine/type-compat.js";
import { unwrapNullable } from "../typeMapping.js";
import { quotePostgresIdentifier as quote } from "../sql/sqlIdentifiers.js";
import {
  renderCreateTable, renderCreateEnum, enumTypeName, columnDefinition, columnTypeFor, sqlColumnName,
  referenceForeignKeyClause,
} from "../sql/sqlDdl.js";
import { renderCreateIndex, renderDropIndex } from "../sql/sqlIndexes.js";

export const sqlMigrationEmitter: MigrationEmitter = {
  target: "migration-sql",
  fileExtension: "sql",

  emit(context: MigrationEmitContext): OutputFile[] {
    const blocks: string[] = [migrationHeader(context.plan, "--")];
    for (const op of context.plan.ops) {
      blocks.push(renderOp(op, context));
    }
    const contents = blocks.join("\n\n") + "\n";
    return [{ path: "migration.sql", contents }];
  },
};

function renderOp(op: MigrationOp, ctx: MigrationEmitContext): string {
  switch (op.kind) {
    case "CreateModel":
      return renderCreateTable(op.model, ctx.newSchema, ctx.company, ctx.includePrivate);

    case "DropModel":
      return `-- DESTRUCTIVE: dropping table "${op.table}" discards all its rows.\nDROP TABLE ${quote(op.table)};`;

    case "RenameModel":
      return `ALTER TABLE ${quote(op.oldTable)} RENAME TO ${quote(op.newTable)};`;

    case "AddField": {
      const columnName = sqlColumnName(op.field);
      const table = quote(op.table);
      if (op.safety === "needs_backfill") {
        const { inner } = unwrapNullable(op.field.type);
        const type = columnTypeFor(inner, op.field.decorators, ctx.newSchema);
        return [
          `-- TODO backfill: required column "${columnName}" has no @default.`,
          `-- Add it nullable, backfill, then enforce NOT NULL:`,
          `ALTER TABLE ${table} ADD COLUMN ${quote(columnName)} ${type};`,
          `-- ALTER TABLE ${table} ALTER COLUMN ${quote(columnName)} SET NOT NULL;`,
        ].join("\n");
      }
      return `ALTER TABLE ${table} ADD COLUMN ${columnDefinition(columnName, op.field, ctx.newSchema)};`;
    }

    case "DropField": {
      const columnName = sqlColumnName(op.field);
      return `-- DESTRUCTIVE: dropping column "${columnName}".\nALTER TABLE ${quote(op.table)} DROP COLUMN ${quote(columnName)};`;
    }

    case "RenameField":
      return `ALTER TABLE ${quote(op.table)} RENAME COLUMN ${quote(op.oldName)} TO ${quote(sqlColumnName(op.field))};`;

    case "ChangeFieldType":
      return renderChangeFieldType(op, ctx);

    case "ChangeFieldNullability": {
      const columnName = sqlColumnName(op.field);
      const alter = `ALTER TABLE ${quote(op.table)} ALTER COLUMN ${quote(columnName)}`;
      if (op.becameNullable) return `${alter} DROP NOT NULL;`;
      return `-- TODO: ensure no NULLs in "${columnName}" before enforcing NOT NULL.\n${alter} SET NOT NULL;`;
    }

    case "CreateEnum":
      return renderCreateEnum(op.decl);

    case "DropEnum":
      return `-- DESTRUCTIVE: dropping enum type "${op.enumName}".\nDROP TYPE ${enumTypeName(op.enumName)};`;

    case "RenameEnum":
      return `ALTER TYPE ${enumTypeName(op.oldName)} RENAME TO ${enumTypeName(op.newName)};`;

    case "AddEnumVariant":
      // ADD VALUE cannot run inside a transaction block on PostgreSQL < 12.
      return `ALTER TYPE ${enumTypeName(op.enumName)} ADD VALUE IF NOT EXISTS '${op.variant}';`;

    case "RenameEnumVariant":
      return `ALTER TYPE ${enumTypeName(op.enumName)} RENAME VALUE '${op.oldVariant}' TO '${op.newVariant}';`;

    case "DropEnumVariant": {
      const type = enumTypeName(op.enumName);
      return [
        `-- DESTRUCTIVE/MANUAL: PostgreSQL cannot drop enum value '${op.variant}' from "${op.enumName}".`,
        `-- Recreate the type without it: repoint columns to TEXT, DROP TYPE ${type},`,
        `-- CREATE TYPE ${type} AS ENUM (...) with the remaining values, then repoint back.`,
      ].join("\n");
    }

    case "CreateIndex":
      return renderCreateIndex(op.index, quote);

    case "DropIndex":
      return renderDropIndex(op.index, quote);
  }
}

type ChangeFieldTypeOp = Extract<MigrationOp, { kind: "ChangeFieldType" }>;

function renderChangeFieldType(op: ChangeFieldTypeOp, ctx: MigrationEmitContext): string {
  const columnName = sqlColumnName(op.field);
  const lines = [...columnTypeChange(op, ctx), ...foreignKeyChange(op, ctx)];
  // No-op when both DSL types collapse to the same SQL column (e.g. [i32]→[i64] both JSONB).
  if (lines.length === 0) {
    return `-- no-op: "${columnName}" changed ${describeType(op.oldType)} → ${describeType(op.field.type)} but its SQL column stays the same.`;
  }
  return lines.join("\n");
}

function columnTypeChange(op: ChangeFieldTypeOp, ctx: MigrationEmitContext): string[] {
  const column = quote(sqlColumnName(op.field));
  const newInner = unwrapNullable(op.field.type).inner;
  const oldInner = unwrapNullable(op.oldType).inner;
  const newColType = columnTypeFor(newInner, op.field.decorators, ctx.newSchema);
  const oldColType = columnTypeFor(oldInner, op.field.decorators, ctx.oldSchema);
  if (newColType === oldColType) return [];

  const alter = `ALTER TABLE ${quote(op.table)} ALTER COLUMN ${column} TYPE ${newColType}`;
  if (op.safety === "lossy") {
    return [
      `-- LOSSY (${op.relation}): ${describeType(op.oldType)} → ${describeType(op.field.type)}; values outside the new type will error. Review the USING cast.`,
      `${alter} USING ${column}::${newColType};`,
    ];
  }
  return [`${alter};`];
}

// A ref<T> whose target changed swaps its foreign key. An inline REFERENCES gets
// PostgreSQL's default constraint name, <table>_<column>_fkey, so that is the
// one dropped and the one the new key is created under.
function foreignKeyChange(op: ChangeFieldTypeOp, ctx: MigrationEmitContext): string[] {
  const oldKey = referenceForeignKeyClause({ ...op.field, type: op.oldType }, ctx.oldSchema);
  const newKey = referenceForeignKeyClause(op.field, ctx.newSchema);
  if (oldKey === newKey) return [];

  const columnName = sqlColumnName(op.field);
  const constraint = quote(`${op.table}_${columnName}_fkey`);
  const table = quote(op.table);
  const lines: string[] = [];
  if (oldKey !== null) lines.push(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint};`);
  if (newKey !== null) {
    lines.push(`-- Existing values must name rows of the new target, or adding the key fails.`);
    lines.push(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${quote(columnName)}) ${newKey};`);
  }
  return lines;
}
