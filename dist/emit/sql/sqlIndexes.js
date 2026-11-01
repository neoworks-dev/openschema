// src/emit/sql/sqlIndexes.ts
// Model-level @index(fields: ["a", "b"], unique: true, name: "…") declarations,
// shared by the table emitters and the migration planner so an index renders and
// diffs the same way everywhere.
import { allDecorators, namedStringListArg } from "../typeMapping.js";
import { sqlColumnName, tableNameFor } from "./sqlDdl.js";
/** The indexes a model declares, in declaration order. Throws on an unknown field. */
export function tableIndexes(record) {
    const table = tableNameFor(record);
    return allDecorators(record.decorators, "index").map(decorator => tableIndex(record, table, decorator));
}
function tableIndex(record, table, decorator) {
    const fieldNames = namedStringListArg(decorator, "fields");
    if (fieldNames === null || fieldNames.length === 0) {
        throw new Error(`@index on ${record.symbol.localName} needs fields: ["…"]`);
    }
    const fields = fieldNames.map(fieldName => indexedField(record, fieldName));
    const columns = fields.map(field => sqlColumnName(field));
    return {
        name: indexName(decorator, table, columns),
        table,
        unique: namedArgIsTrue(decorator, "unique"),
        fields,
        columns,
    };
}
function indexedField(record, fieldName) {
    const field = record.fields.find(candidate => candidate.name === fieldName);
    if (field === undefined) {
        throw new Error(`@index on ${record.symbol.localName} names '${fieldName}', which is not one of its fields`);
    }
    return field;
}
function indexName(decorator, table, columns) {
    const explicit = decorator.args.find(arg => arg.name === "name");
    if (explicit !== undefined && explicit.value.kind === "string")
        return explicit.value.value;
    return `${table}_${columns.join("_")}_idx`;
}
function namedArgIsTrue(decorator, argName) {
    const arg = decorator.args.find(candidate => candidate.name === argName);
    if (arg === undefined)
        return false;
    return arg.value.kind === "bool" && arg.value.value;
}
/** `CREATE [UNIQUE] INDEX name ON table (a, b);` — the same in PostgreSQL and SQLite. */
export function renderCreateIndex(index) {
    const columns = index.columns.join(", ");
    if (index.unique)
        return `CREATE UNIQUE INDEX ${index.name} ON ${index.table} (${columns});`;
    return `CREATE INDEX ${index.name} ON ${index.table} (${columns});`;
}
/** `DROP INDEX name;` */
export function renderDropIndex(index) {
    return `DROP INDEX ${index.name};`;
}
/** A key that changes whenever anything about the index does. */
export function indexIdentity(index) {
    return `${index.name}|${index.unique}|${index.table}|${index.columns.join(",")}`;
}
//# sourceMappingURL=sqlIndexes.js.map