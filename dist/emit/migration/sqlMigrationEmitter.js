// src/emit/migration/sqlMigrationEmitter.ts
// Renders a MigrationPlan into PostgreSQL ALTER TABLE / DDL statements.
import { migrationHeader } from "./types.js";
import { describeType } from "../../engine/type-compat.js";
import { unwrapNullable, toSnakeCase } from "../typeMapping.js";
import { renderCreateTable, renderCreateEnum, enumTypeName, columnDefinition, columnTypeFor, sqlColumnName } from "../sql/sqlDdl.js";
export const sqlMigrationEmitter = {
    target: "migration-sql",
    fileExtension: "sql",
    emit(context) {
        const blocks = [migrationHeader(context.plan, "--")];
        for (const op of context.plan.ops) {
            blocks.push(renderOp(op, context));
        }
        const contents = blocks.join("\n\n") + "\n";
        return [{ path: "migration.sql", contents }];
    },
};
function renderOp(op, ctx) {
    switch (op.kind) {
        case "CreateModel":
            return renderCreateTable(op.model, ctx.newSchema, ctx.company, ctx.includePrivate);
        case "DropModel":
            return `-- DESTRUCTIVE: dropping table "${op.table}" discards all its rows.\nDROP TABLE ${op.table};`;
        case "RenameModel":
            return `ALTER TABLE ${op.oldTable} RENAME TO ${op.newTable};`;
        case "AddField": {
            const column = sqlColumnName(op.field);
            if (op.safety === "needs_backfill") {
                const { inner } = unwrapNullable(op.field.type);
                const type = columnTypeFor(inner, op.field.decorators, ctx.newSchema);
                return [
                    `-- TODO backfill: required column "${column}" has no @default.`,
                    `-- Add it nullable, backfill, then enforce NOT NULL:`,
                    `ALTER TABLE ${op.table} ADD COLUMN ${column} ${type};`,
                    `-- ALTER TABLE ${op.table} ALTER COLUMN ${column} SET NOT NULL;`,
                ].join("\n");
            }
            return `ALTER TABLE ${op.table} ADD COLUMN ${columnDefinition(op.field.name, op.field, ctx.newSchema)};`;
        }
        case "DropField":
            return `-- DESTRUCTIVE: dropping column "${sqlColumnName(op.field)}".\nALTER TABLE ${op.table} DROP COLUMN ${sqlColumnName(op.field)};`;
        case "RenameField":
            return `ALTER TABLE ${op.table} RENAME COLUMN ${toSnakeCase(op.oldName)} TO ${sqlColumnName(op.field)};`;
        case "ChangeFieldType":
            return renderChangeFieldType(op, ctx);
        case "ChangeFieldNullability": {
            const column = sqlColumnName(op.field);
            if (op.becameNullable) {
                return `ALTER TABLE ${op.table} ALTER COLUMN ${column} DROP NOT NULL;`;
            }
            return `-- TODO: ensure no NULLs in "${column}" before enforcing NOT NULL.\nALTER TABLE ${op.table} ALTER COLUMN ${column} SET NOT NULL;`;
        }
        case "CreateEnum":
            return renderCreateEnum(op.decl);
        case "DropEnum":
            return `-- DESTRUCTIVE: dropping enum type "${enumTypeName(op.enumName)}".\nDROP TYPE ${enumTypeName(op.enumName)};`;
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
                `-- DESTRUCTIVE/MANUAL: PostgreSQL cannot drop enum value '${op.variant}' from "${type}".`,
                `-- Recreate the type without it: repoint columns to TEXT, DROP TYPE ${type},`,
                `-- CREATE TYPE ${type} AS ENUM (...) with the remaining values, then repoint back.`,
            ].join("\n");
        }
    }
}
function renderChangeFieldType(op, ctx) {
    const column = sqlColumnName(op.field);
    const newInner = unwrapNullable(op.field.type).inner;
    const oldInner = unwrapNullable(op.oldType).inner;
    const newColType = columnTypeFor(newInner, op.field.decorators, ctx.newSchema);
    const oldColType = columnTypeFor(oldInner, op.field.decorators, ctx.oldSchema);
    // No-op when both DSL types collapse to the same SQL column type (e.g. [i32]→[i64] both JSONB).
    if (newColType === oldColType) {
        return `-- no-op: "${column}" changed ${describeType(op.oldType)} → ${describeType(op.field.type)} but the SQL column type stays ${newColType}.`;
    }
    if (op.safety === "lossy") {
        return [
            `-- LOSSY (${op.relation}): ${describeType(op.oldType)} → ${describeType(op.field.type)}; values outside the new type will error. Review the USING cast.`,
            `ALTER TABLE ${op.table} ALTER COLUMN ${column} TYPE ${newColType} USING ${column}::${newColType};`,
        ].join("\n");
    }
    return `ALTER TABLE ${op.table} ALTER COLUMN ${column} TYPE ${newColType};`;
}
//# sourceMappingURL=sqlMigrationEmitter.js.map