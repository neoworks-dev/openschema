// src/emit/internal/internalEmitter.ts
// Emits the neoworks "internal" client-database definition (DatabaseSchemaInput)
// from a resolved schema. The output JSON is accepted verbatim by the neoworks
// API's createClientDatabase mutation, which validates field types against a
// fixed vocabulary: base types plus option<T> / array<T> / set<T>.
import { hasDecorator, firstStringArg, namedStringArg, allDecorators, positionalStringArgs, toSnakeCase, isInputModel } from "../typeMapping.js";
// Scalars map onto the API's base type vocabulary. No record<> exists there, so
// model references resolve to their target's primary-key scalar instead.
const SCALAR_INTERNAL = {
    bool: "bool",
    i8: "int", i16: "int", i32: "int", i64: "int",
    u8: "int", u16: "int", u32: "int", u64: "int",
    f32: "float", f64: "float",
    string: "string", bytes: "bytes", uuid: "uuid", json: "object",
    date: "datetime", time: "datetime", timestamp: "datetime", duration: "duration",
};
export const internalEmitter = {
    target: "internal",
    fileExtension: "json",
    emit(context) {
        const tables = [];
        for (const record of context.schema.records.values()) {
            if (record.isGeneric)
                continue; // generic records are not directly emittable
            if (isInputModel(record))
                continue; // input-only model: not a table
            tables.push(buildTable(record, context));
        }
        const schema = { tables };
        const contents = JSON.stringify(schema, null, 2) + "\n";
        return [{ path: "schema.internal.json", contents }];
    },
};
function buildTable(record, context) {
    const tableName = tableNameFor(record);
    const fields = [];
    const indexes = [];
    for (const field of record.fields) {
        if (field.isPrivate && !context.includePrivate)
            continue;
        // @primaryKey maps to SurrealDB's implicit `id`, so it is not a column.
        if (hasDecorator(field.decorators, "primaryKey"))
            continue;
        const columnName = columnNameFor(field);
        fields.push({ name: columnName, type: mapInternalType(field.type, context.schema) });
        if (hasDecorator(field.decorators, "unique")) {
            indexes.push({ name: `idx_${tableName}_${columnName}`, fields: [columnName], unique: true });
        }
        // @neoworks.fulltext marks a string field for BM25 search.
        if (hasDecorator(field.decorators, "neoworks.fulltext")) {
            const index = { name: `idx_${tableName}_${columnName}_search`, fields: [columnName], fulltext: true };
            const analyzer = namedStringArg(field.decorators, "neoworks.fulltext", "analyzer");
            if (analyzer !== null)
                index.analyzer = analyzer;
            indexes.push(index);
        }
    }
    // Model-level composite/secondary indexes: @neoworks.unique("a","b") and
    // @neoworks.index("a","b") (each may repeat). Column names are DSL field names,
    // snake_cased to match emitted columns.
    for (const decorator of allDecorators(record.decorators, "neoworks.unique")) {
        const columns = positionalStringArgs(decorator).map(toSnakeCase);
        if (columns.length > 0)
            indexes.push({ name: `idx_${tableName}_${columns.join("_")}`, fields: columns, unique: true });
    }
    for (const decorator of allDecorators(record.decorators, "neoworks.index")) {
        const columns = positionalStringArgs(decorator).map(toSnakeCase);
        if (columns.length > 0)
            indexes.push({ name: `idx_${tableName}_${columns.join("_")}`, fields: columns });
    }
    const table = {
        name: tableName,
        schemafull: !hasDecorator(record.decorators, "neoworks.schemaless"),
        kind: firstStringArg(record.decorators, "neoworks.kind") ?? "data",
        fields,
        indexes,
    };
    // Omit at default so the server applies its own default.
    const visibility = firstStringArg(record.decorators, "neoworks.visibility");
    if (visibility !== null)
        table.visibility = visibility;
    if (hasDecorator(record.decorators, "neoworks.history"))
        table.history = true;
    const subjectPath = firstStringArg(record.decorators, "neoworks.subjectPath");
    if (subjectPath !== null)
        table.subjectPath = subjectPath;
    return table;
}
function tableNameFor(record) {
    const explicit = firstStringArg(record.decorators, "table");
    if (explicit !== null)
        return explicit;
    return toSnakeCase(record.symbol.localName);
}
function columnNameFor(field) {
    const explicit = firstStringArg(field.decorators, "sql.column");
    if (explicit !== null)
        return explicit;
    return toSnakeCase(field.name);
}
function mapInternalType(type, schema) {
    if (type.kind === "nullable")
        return `option<${mapInternalType(type.inner, schema)}>`;
    if (type.kind === "scalar")
        return SCALAR_INTERNAL[type.scalar];
    if (type.kind === "decimal")
        return "decimal";
    if (type.kind === "array")
        return `array<${mapInternalType(type.element, schema)}>`;
    if (type.kind === "map")
        return "object";
    if (type.kind === "named")
        return resolveNamedType(type.path, schema);
    // union, oneof → opaque document
    return "object";
}
// Enums collapse to string; model references become the target's primary-key
// scalar (a foreign key). Unknown names fall back to a flexible object.
function resolveNamedType(path, schema) {
    const localName = path[path.length - 1];
    for (const symbol of schema.enums.values()) {
        if (symbol.localName === localName)
            return "string";
    }
    for (const record of schema.records.values()) {
        if (record.symbol.localName === localName)
            return primaryKeyScalar(record);
    }
    return "object";
}
function primaryKeyScalar(record) {
    for (const field of record.fields) {
        if (hasDecorator(field.decorators, "primaryKey"))
            return scalarOf(field.type);
    }
    return "uuid";
}
function scalarOf(type) {
    const inner = type.kind === "nullable" ? type.inner : type;
    if (inner.kind === "scalar")
        return SCALAR_INTERNAL[inner.scalar];
    return "uuid";
}
//# sourceMappingURL=internalEmitter.js.map