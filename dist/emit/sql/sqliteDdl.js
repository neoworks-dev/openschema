// src/emit/sql/sqliteDdl.ts
// SQLite DDL rendering shared by the `sqlite` CREATE-TABLE emitter and the
// `migration-sqlite` emitter. SQLite has no native enum, JSON or UUID types:
// enums become TEXT with an IN-list CHECK, JSON-shaped values become TEXT with
// a json_valid CHECK, and every other scalar maps onto SQLite's storage classes.
import { findDecorator, hasDecorator, firstStringArg, decoratorValueToString, unwrapNullable, applyLink, overlayFieldsToEmit, } from "../typeMapping.js";
import { checkClauseFor, referencesClauseFor, linkReferencesClause, exprToSql, tableNameFor, sqlColumnName, overlayColumnName, } from "./sqlDdl.js";
import { quoteSqliteIdentifier } from "./sqlIdentifiers.js";
// u64 does not fit SQLite's signed 64-bit INTEGER, so it is kept exact as text.
export const SCALAR_SQLITE = {
    bool: "INTEGER",
    i8: "INTEGER", i16: "INTEGER", i32: "INTEGER", i64: "INTEGER",
    u8: "INTEGER", u16: "INTEGER", u32: "INTEGER", u64: "TEXT",
    f32: "REAL", f64: "REAL",
    string: "TEXT", bytes: "BLOB", uuid: "TEXT", json: "TEXT",
    date: "TEXT", time: "TEXT", timestamp: "TEXT", duration: "TEXT",
    semver: "TEXT",
};
const JSON_CHECK = (column) => `CHECK (json_valid(${column}))`;
/** The `CREATE TABLE` for a model, optionally under another name (for table rebuilds). */
export function renderCreateTableSqlite(record, schema, company, includePrivate, tableName = tableNameFor(record)) {
    const lines = sqliteColumns(record, schema, company, includePrivate)
        .map(column => "  " + sqliteColumnDefinition(column.name, column.field, schema));
    const strict = hasDecorator(record.decorators, "sqlite.strict") ? " STRICT" : "";
    return `CREATE TABLE ${quoteSqliteIdentifier(tableName)} (\n${lines.join(",\n")}\n)${strict};`;
}
/** The columns of a model's table in order, overlay columns (prefixed by company) last. */
export function sqliteColumns(record, schema, company, includePrivate) {
    const columns = [];
    for (const field of record.fields) {
        if (field.isPrivate && !includePrivate)
            continue;
        columns.push({ name: sqliteColumnName(field), field, fromOverlay: false });
    }
    if (company === null)
        return columns;
    for (const field of overlayFieldsToEmit(schema, record, company)) {
        columns.push({ name: overlayColumnName(company, field), field, fromOverlay: true });
    }
    return columns;
}
/** The physical column name, unquoted: explicit @sql.column, else the field name as written. */
export function sqliteColumnName(field) {
    return sqlColumnName(field);
}
/** One column definition, e.g. `status TEXT NOT NULL CHECK (status IN ('a', 'b'))`. */
export function sqliteColumnDefinition(columnName, field, schema) {
    const { inner, nullable } = unwrapNullable(applyLink(field.type, field, schema));
    const shape = sqliteColumnShape(inner, field.decorators, schema);
    const column = quoteSqliteIdentifier(columnName);
    const parts = [column, shape.sqlType];
    if (!nullable)
        parts.push("NOT NULL");
    if (hasDecorator(field.decorators, "primaryKey"))
        parts.push("PRIMARY KEY");
    if (hasDecorator(field.decorators, "unique"))
        parts.push("UNIQUE");
    const defaultClause = sqliteDefaultClause(field.decorators);
    if (defaultClause !== null)
        parts.push(defaultClause);
    const optionalClauses = [
        referencesClauseFor(field.decorators, quoteSqliteIdentifier),
        linkReferencesClause(field, schema, quoteSqliteIdentifier),
        checkClauseFor(field.decorators),
    ];
    for (const clause of optionalClauses) {
        if (clause !== null)
            parts.push(clause);
    }
    if (shape.implicitCheck !== null)
        parts.push(shape.implicitCheck(column));
    return parts.join(" ");
}
/** The SQLite column type a field type renders to, ignoring its CHECK. */
export function sqliteColumnType(type, decorators, schema) {
    return sqliteColumnShape(type, decorators, schema).sqlType;
}
function sqliteColumnShape(type, decorators, schema) {
    const override = firstStringArg(decorators, "sql.type");
    if (override !== null)
        return { sqlType: override, implicitCheck: null };
    if (type.kind === "scalar") {
        const implicitCheck = type.scalar === "json" ? JSON_CHECK : null;
        return { sqlType: SCALAR_SQLITE[type.scalar], implicitCheck };
    }
    // TEXT keeps a decimal exact; REAL would round it.
    if (type.kind === "decimal")
        return { sqlType: "TEXT", implicitCheck: null };
    if (type.kind === "named")
        return namedShape(type.path, schema);
    // arrays, maps, unions, oneof, files, nested nullable → a JSON document
    return { sqlType: "TEXT", implicitCheck: JSON_CHECK };
}
function namedShape(path, schema) {
    const decl = enumDeclByLocalName(path[path.length - 1], schema);
    if (decl === null)
        return { sqlType: "TEXT", implicitCheck: JSON_CHECK };
    const values = decl.variants.map(variant => sqliteString(variant.name)).join(", ");
    return { sqlType: "TEXT", implicitCheck: column => `CHECK (${column} IN (${values}))` };
}
/** The enum declaration with this local name, or null. */
export function enumDeclByLocalName(localName, schema) {
    for (const symbol of schema.enums.values()) {
        if (symbol.localName === localName)
            return symbol.decl;
    }
    return null;
}
/**
 * `DEFAULT …` in SQLite form. Literals stay bare; any other expression must be
 * parenthesised, and `now()` becomes an ISO 8601 UTC timestamp.
 */
export function sqliteDefaultClause(decorators) {
    const decorator = findDecorator(decorators, "default");
    if (decorator === null || decorator.args.length === 0)
        return null;
    const value = decorator.args[0].value;
    if (value.kind === "expr")
        return `DEFAULT ${sqliteDefaultExpr(value.expr)}`;
    if (value.kind === "string")
        return `DEFAULT ${sqliteString(value.value)}`;
    const literal = decoratorValueToString(value);
    if (literal === null)
        return null;
    return `DEFAULT ${literal}`;
}
function sqliteDefaultExpr(expr) {
    if (expr.kind === "literal" && typeof expr.value === "string")
        return sqliteString(expr.value);
    if (expr.kind === "literal")
        return String(expr.value);
    if (expr.kind === "ident")
        return expr.name;
    if (expr.kind === "call" && expr.callee === "now" && expr.args.length === 0) {
        return "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    }
    return `(${exprToSql(expr)})`;
}
/**
 * True when SQLite's ADD COLUMN cannot add this field: it forbids PRIMARY KEY,
 * UNIQUE and parenthesised (non-constant) defaults, a NOT NULL column without a
 * default, and a NOT NULL foreign key.
 */
export function needsRebuildToAdd(field, schema) {
    const decorators = field.decorators;
    if (hasDecorator(decorators, "primaryKey"))
        return true;
    if (hasDecorator(decorators, "unique"))
        return true;
    const defaultClause = sqliteDefaultClause(decorators);
    if (defaultClause !== null && defaultClause.startsWith("DEFAULT ("))
        return true;
    const { nullable } = unwrapNullable(field.type);
    if (nullable)
        return false;
    if (defaultClause === null)
        return true;
    return referencesClauseFor(decorators) !== null || linkReferencesClause(field, schema) !== null;
}
/** A single-quoted SQLite string literal. */
export function sqliteString(text) {
    return `'${text.replace(/'/g, "''")}'`;
}
//# sourceMappingURL=sqliteDdl.js.map