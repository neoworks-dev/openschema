// src/emit/migration/sqliteMigrationEmitter.ts
// Renders a MigrationPlan into SQLite DDL. SQLite can add, rename and drop
// tables, add simple columns and rename columns, but it cannot alter a column.
// Every other change rebuilds the table: create the new definition under a
// temporary name, copy the rows across, drop the old table, rename the new one
// into place. All changes to one table share a single rebuild.
import { migrationHeader } from "./types.js";
import { previousModel } from "../../engine/migration.js";
import { pairByOrdinal } from "../../engine/match.js";
import { describeType } from "../../engine/type-compat.js";
import { applyLink, hasDecorator, isTableModel, toSnakeCase, unwrapNullable } from "../typeMapping.js";
import { tableNameFor } from "../sql/sqlDdl.js";
import { renderCreateIndex, renderDropIndex, tableIndexes } from "../sql/sqlIndexes.js";
import { renderCreateTableSqlite, sqliteColumns, sqliteColumnName, sqliteColumnDefinition, sqliteColumnType, needsRebuildToAdd, sqliteString, } from "../sql/sqliteDdl.js";
export const sqliteMigrationEmitter = {
    target: "migration-sqlite",
    fileExtension: "sql",
    emit(context) {
        const rebuilds = planRebuilds(context);
        const blocks = [migrationHeader(context.plan, "--")];
        if (rebuilds.size > 0)
            blocks.push(FOREIGN_KEYS_OFF);
        let rebuildsWritten = false;
        for (const op of context.plan.ops) {
            if (!rebuildsWritten && isContractOp(op)) {
                blocks.push(...renderRebuilds(rebuilds, context));
                rebuildsWritten = true;
            }
            if (isAbsorbedByRebuild(op, rebuilds))
                continue;
            blocks.push(renderOp(op, context));
        }
        if (!rebuildsWritten)
            blocks.push(...renderRebuilds(rebuilds, context));
        if (rebuilds.size > 0)
            blocks.push(FOREIGN_KEYS_ON);
        const contents = blocks.join("\n\n") + "\n";
        return [{ path: "migration.sql", contents }];
    },
};
// A rebuild drops the old table. With foreign keys on, that deletes (or
// cascades into) every row referencing it, so they must be off; the pragma is a
// no-op inside a transaction, so the runner has to switch them off itself then.
const FOREIGN_KEYS_OFF = [
    "-- This migration rebuilds tables. Foreign keys must be off while it runs; PRAGMA foreign_keys",
    "-- has no effect inside a transaction, so a runner that wraps migrations must turn them off first.",
    "PRAGMA foreign_keys = OFF;",
].join("\n");
const FOREIGN_KEYS_ON = "PRAGMA foreign_key_check;\nPRAGMA foreign_keys = ON;";
// ── Deciding what to rebuild ──────────────────────────────────────────────────
function planRebuilds(ctx) {
    const rebuilds = new Map();
    const createdTables = new Set(ctx.plan.ops.filter(op => op.kind === "CreateModel").map(op => tableOf(op)));
    for (const op of ctx.plan.ops) {
        if (isFieldOp(op)) {
            addFieldOpRebuild(op, ctx, rebuilds);
            continue;
        }
        if (op.kind === "AddEnumVariant" || op.kind === "DropEnumVariant" || op.kind === "RenameEnumVariant") {
            addEnumRebuilds(op, ctx, rebuilds, createdTables);
        }
    }
    return rebuilds;
}
function addFieldOpRebuild(op, ctx, rebuilds) {
    const column = sqliteColumnName(op.field);
    if (op.kind === "AddField") {
        if (op.safety === "needs_backfill") {
            const rebuild = rebuildFor(op.table, op.model, rebuilds);
            rebuild.reasons.push(`adds required "${column}"`);
            rebuild.warnings.push(`-- TODO backfill: "${column}" is required and has no @default; replace the NULL in the copy below.`);
            return;
        }
        if (needsRebuildToAdd(op.field, ctx.newSchema)) {
            rebuildFor(op.table, op.model, rebuilds).reasons.push(`adds "${column}"`);
        }
        return;
    }
    if (op.kind === "DropField") {
        const rebuild = rebuildFor(op.table, op.model, rebuilds);
        rebuild.reasons.push(`drops "${column}"`);
        rebuild.warnings.push(`-- DESTRUCTIVE: column "${column}" and its data are dropped.`);
        return;
    }
    if (op.kind === "ChangeFieldType") {
        if (isColumnUnchanged(op, ctx))
            return;
        const rebuild = rebuildFor(op.table, op.model, rebuilds);
        rebuild.reasons.push(`changes "${column}" from ${describeType(op.oldType)} to ${describeType(op.field.type)}`);
        if (op.safety === "lossy") {
            rebuild.warnings.push(`-- LOSSY (${op.relation}): "${column}" is converted with CAST; values that do not convert change or fail the new CHECK.`);
        }
        return;
    }
    if (op.kind === "ChangeFieldNullability") {
        const rebuild = rebuildFor(op.table, op.model, rebuilds);
        if (op.becameNullable) {
            rebuild.reasons.push(`makes "${column}" nullable`);
            return;
        }
        rebuild.reasons.push(`makes "${column}" required`);
        rebuild.warnings.push(`-- TODO: rows with NULL in "${column}" fail the copy; fill them first.`);
    }
}
function addEnumRebuilds(op, ctx, rebuilds, createdTables) {
    for (const { model, field } of enumColumns(op.enumName, ctx)) {
        const table = tableNameFor(model);
        if (createdTables.has(table))
            continue;
        const rebuild = rebuildFor(table, model, rebuilds);
        const column = sqliteColumnName(field);
        rebuild.reasons.push(`updates the CHECK of "${column}" (${describeEnumChange(op)})`);
        if (op.kind === "DropEnumVariant") {
            rebuild.warnings.push(`-- DESTRUCTIVE: rows holding ${sqliteString(op.variant)} in "${column}" fail the new CHECK; change them first.`);
        }
    }
}
function describeEnumChange(op) {
    if (op.kind === "AddEnumVariant")
        return `${op.enumName} gains ${sqliteString(op.variant)}`;
    if (op.kind === "DropEnumVariant")
        return `${op.enumName} loses ${sqliteString(op.variant)}`;
    return `${op.enumName} renames ${sqliteString(op.oldVariant)} to ${sqliteString(op.newVariant)}`;
}
/** Every table column in the new schema whose type is the given enum. */
function enumColumns(enumName, ctx) {
    const found = [];
    for (const model of ctx.newSchema.records.values()) {
        if (!isTableModel(model))
            continue;
        for (const field of model.fields) {
            if (field.isPrivate && !ctx.includePrivate)
                continue;
            if (enumNameOf(field) === enumName)
                found.push({ model, field });
        }
    }
    return found;
}
function enumNameOf(field) {
    const inner = unwrapNullable(field.type).inner;
    if (inner.kind !== "named")
        return null;
    return inner.path[inner.path.length - 1];
}
function rebuildFor(table, model, rebuilds) {
    const existing = rebuilds.get(table);
    if (existing !== undefined)
        return existing;
    const created = { table, model, reasons: [], warnings: [] };
    rebuilds.set(table, created);
    return created;
}
/** True when old and new type render to the same SQLite column, e.g. i32 → i64. */
function isColumnUnchanged(op, ctx) {
    const column = sqliteColumnName(op.field);
    const oldField = { ...op.field, type: op.oldType };
    const oldDefinition = sqliteColumnDefinition(column, oldField, ctx.oldSchema);
    return oldDefinition === sqliteColumnDefinition(column, op.field, ctx.newSchema);
}
function isFieldOp(op) {
    return op.kind === "AddField" || op.kind === "DropField" || op.kind === "RenameField"
        || op.kind === "ChangeFieldType" || op.kind === "ChangeFieldNullability";
}
// A rebuild recreates every declared index of its table, so it absorbs index creation too.
function isAbsorbedByRebuild(op, rebuilds) {
    if (isFieldOp(op) || op.kind === "CreateIndex")
        return rebuilds.has(op.table);
    if (op.kind === "RenameModel")
        return rebuilds.has(op.newTable);
    return false;
}
// Drops come last in a plan; rebuilds go right before them, after every table
// they might reference has been created.
function isContractOp(op) {
    return op.kind === "DropField" || op.kind === "DropEnumVariant" || op.kind === "DropModel" || op.kind === "DropEnum";
}
function tableOf(op) {
    if ("table" in op)
        return op.table;
    return "";
}
// ── Rendering a rebuild ───────────────────────────────────────────────────────
function renderRebuilds(rebuilds, ctx) {
    return [...rebuilds.values()].map(rebuild => renderRebuild(rebuild, ctx));
}
function renderRebuild(rebuild, ctx) {
    const oldModel = previousModel(ctx.oldSchema, ctx.newSchema, rebuild.model);
    if (oldModel === null) {
        return `-- MANUAL: cannot rebuild "${rebuild.table}": no earlier version of it was found.`;
    }
    const oldTable = tableNameFor(oldModel);
    const temporaryTable = `${rebuild.table}__new`;
    const copies = columnCopies(rebuild.model, oldModel, ctx);
    const lines = [
        `-- Rebuild "${rebuild.table}": ${rebuild.reasons.join("; ")}.`,
        `-- Indexes and triggers on "${oldTable}" that the schema does not declare must be recreated by hand.`,
        ...rebuild.warnings,
        renderCreateTableSqlite(rebuild.model, ctx.newSchema, ctx.company, ctx.includePrivate, temporaryTable),
    ];
    if (copies.length > 0) {
        const targets = copies.map(copy => copy.target).join(", ");
        const sources = copies.map(copy => copy.source).join(", ");
        lines.push(`INSERT INTO ${temporaryTable} (${targets})\n  SELECT ${sources} FROM ${oldTable};`);
    }
    lines.push(`DROP TABLE ${oldTable};`);
    lines.push(`ALTER TABLE ${temporaryTable} RENAME TO ${rebuild.table};`);
    lines.push(...tableIndexes(rebuild.model).map(renderCreateIndex));
    return lines.join("\n");
}
function columnCopies(newModel, oldModel, ctx) {
    const previousFields = new Map();
    for (const { oldItem, newItem } of pairByOrdinal(oldModel.fields, newModel.fields)) {
        if (oldItem !== null && newItem !== null)
            previousFields.set(newItem, oldItem);
    }
    const copies = [];
    for (const column of sqliteColumns(newModel, ctx.newSchema, ctx.company, ctx.includePrivate)) {
        const copy = columnCopy(column, previousFields.get(column.field), ctx);
        if (copy !== null)
            copies.push(copy);
    }
    return copies;
}
function columnCopy(column, previousField, ctx) {
    // Overlays are not part of the plan, so their columns are carried over as they are.
    if (column.fromOverlay)
        return { target: column.name, source: column.name };
    if (previousField === undefined)
        return newColumnCopy(column);
    const source = convertedValue(sqliteColumnName(previousField), previousField, column.field, ctx);
    return { target: column.name, source: renamedVariants(source, column.field, ctx) };
}
// A new column takes its default, unless it is required without one: then the
// copy names it with a placeholder the author must replace.
function newColumnCopy(column) {
    const { nullable } = unwrapNullable(column.field.type);
    if (nullable || hasDecorator(column.field.decorators, "default"))
        return null;
    return { target: column.name, source: "NULL /* TODO backfill */" };
}
function convertedValue(source, previousField, field, ctx) {
    const oldType = columnTypeOf(previousField, ctx.oldSchema);
    const newType = columnTypeOf(field, ctx.newSchema);
    if (oldType === newType)
        return source;
    return `CAST(${source} AS ${newType})`;
}
function columnTypeOf(field, schema) {
    const inner = unwrapNullable(applyLink(field.type, field, schema)).inner;
    return sqliteColumnType(inner, field.decorators, schema);
}
/** Maps renamed enum values to their new names while copying. */
function renamedVariants(source, field, ctx) {
    const enumName = enumNameOf(field);
    if (enumName === null)
        return source;
    const renames = ctx.plan.ops.filter((op) => op.kind === "RenameEnumVariant" && op.enumName === enumName);
    if (renames.length === 0)
        return source;
    const cases = renames.map(op => `WHEN ${sqliteString(op.oldVariant)} THEN ${sqliteString(op.newVariant)}`);
    return `CASE ${source} ${cases.join(" ")} ELSE ${source} END`;
}
// ── Operations SQLite runs in place ───────────────────────────────────────────
function renderOp(op, ctx) {
    switch (op.kind) {
        case "CreateModel":
            return renderCreateTableSqlite(op.model, ctx.newSchema, ctx.company, ctx.includePrivate);
        case "DropModel":
            return `-- DESTRUCTIVE: dropping table "${op.table}" discards all its rows.\nDROP TABLE ${op.table};`;
        case "RenameModel":
            return `ALTER TABLE ${op.oldTable} RENAME TO ${op.newTable};`;
        case "AddField":
            return `ALTER TABLE ${op.table} ADD COLUMN ${sqliteColumnDefinition(sqliteColumnName(op.field), op.field, ctx.newSchema)};`;
        case "RenameField":
            return `ALTER TABLE ${op.table} RENAME COLUMN ${toSnakeCase(op.oldName)} TO ${sqliteColumnName(op.field)};`;
        case "ChangeFieldType":
            return `-- no-op: "${sqliteColumnName(op.field)}" changed ${describeType(op.oldType)} → ${describeType(op.field.type)} but its SQLite column stays the same.`;
        // Always rebuilt; listed so the switch stays exhaustive.
        case "DropField":
        case "ChangeFieldNullability":
            return `-- "${sqliteColumnName(op.field)}" on "${op.table}" is handled by the table rebuild.`;
        case "CreateEnum":
        case "DropEnum":
            return `-- enum ${op.enumName}: stored as TEXT with a CHECK on each column, so there is no type to ${enumVerb(op.kind)}.`;
        case "RenameEnum":
            return `-- enum ${op.oldName} → ${op.newName}: the stored values are unchanged.`;
        case "AddEnumVariant":
        case "DropEnumVariant":
        case "RenameEnumVariant":
            return `-- enum ${describeEnumChange(op)}: ${enumUsers(op.enumName, ctx)}.`;
        case "CreateIndex":
            return renderCreateIndex(op.index);
        case "DropIndex":
            return renderDropIndex(op.index);
    }
}
function enumVerb(kind) {
    if (kind === "CreateEnum")
        return "create";
    return "drop";
}
function enumUsers(enumName, ctx) {
    const tables = new Set(enumColumns(enumName, ctx).map(column => tableNameFor(column.model)));
    if (tables.size === 0)
        return "no table uses it";
    return `the CHECK of ${[...tables].map(table => `"${table}"`).join(", ")} changes with the table`;
}
//# sourceMappingURL=sqliteMigrationEmitter.js.map