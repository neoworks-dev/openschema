// src/emit/surrealdb/surrealDdl.ts
// Shared SurrealQL DDL rendering used by both the schema (DEFINE TABLE) emitter
// and the migration emitter, so a field renders identically either way.
import { findDecorator, hasDecorator, firstStringArg, decoratorValueToString, unwrapNullable, toSnakeCase, } from "../typeMapping.js";
// SurrealDB has a small set of primitive types; several DSL scalars collapse onto one.
const SCALAR_SURREAL = {
    bool: "bool",
    i8: "int", i16: "int", i32: "int", i64: "int",
    u8: "int", u16: "int", u32: "int", u64: "int",
    f32: "float", f64: "float",
    string: "string", bytes: "bytes", uuid: "uuid", json: "object",
    date: "datetime", time: "datetime", timestamp: "datetime", duration: "duration",
};
export function tableNameFor(record) {
    const explicit = firstStringArg(record.decorators, "table");
    if (explicit !== null)
        return explicit;
    return toSnakeCase(record.symbol.localName);
}
export function surrealFieldName(field, fallbackName = field.name) {
    return firstStringArg(field.decorators, "surreal.field") ?? fallbackName;
}
/** The `DEFINE FIELD … ;` line for a field. `fieldName` is the logical name
 * (overridable by @surreal.field). */
export function renderFieldDefine(tableName, fieldName, field, schema) {
    const surrealName = surrealFieldName(field, fieldName);
    const { inner, nullable } = unwrapNullable(field.type);
    const baseType = fieldTypeFor(inner, field.decorators, schema);
    const surrealType = nullable ? `option<${baseType}>` : baseType;
    const parts = [
        `DEFINE FIELD ${surrealName} ON TABLE ${tableName} TYPE ${surrealType}`,
    ];
    const defaultClause = defaultClauseFor(field.decorators);
    if (defaultClause !== null)
        parts.push(defaultClause);
    const assertClause = assertClauseFor(inner, field.decorators, schema);
    if (assertClause !== null)
        parts.push(assertClause);
    if (hasDecorator(field.decorators, "primaryKey"))
        parts.push("READONLY");
    return parts.join(" ") + ";";
}
/** The `DEFINE INDEX … UNIQUE;` line for a unique/pk field, or null. */
export function renderFieldIndex(tableName, fieldName, field) {
    const unique = hasDecorator(field.decorators, "unique") || hasDecorator(field.decorators, "primaryKey");
    if (!unique)
        return null;
    const surrealName = surrealFieldName(field, fieldName);
    const indexName = `${tableName}_${toSnakeCase(surrealName)}_unique`;
    return `DEFINE INDEX ${indexName} ON TABLE ${tableName} FIELDS ${surrealName} UNIQUE;`;
}
/** Both lines a field contributes to a table definition, in order. A field whose
 * type is an embedded value object expands into a typed nested object instead. */
export function renderField(tableName, fieldName, field, schema, seen = new Set()) {
    const embedded = embeddedModelRef(field, schema);
    if (embedded !== null && !seen.has(embedded.model.symbol.localName)) {
        return renderEmbeddedField(tableName, fieldName, field, embedded, schema, seen);
    }
    const lines = [renderFieldDefine(tableName, fieldName, field, schema)];
    const index = renderFieldIndex(tableName, fieldName, field);
    if (index !== null)
        lines.push(index);
    return lines;
}
function embeddedModelRef(field, schema) {
    if (hasDecorator(field.decorators, "references"))
        return null; // record link, not embed
    if (hasDecorator(field.decorators, "link"))
        return null; // explicit record link, not embed
    const { inner, nullable } = unwrapNullable(field.type);
    if (inner.kind === "named") {
        const model = embeddableModel(inner.path, schema);
        if (model !== null)
            return { model, optional: nullable, isArray: false };
        return null;
    }
    if (inner.kind === "array") {
        const element = inner.element.kind === "nullable" ? inner.element.inner : inner.element;
        if (element.kind === "named") {
            const model = embeddableModel(element.path, schema);
            if (model !== null)
                return { model, optional: nullable, isArray: true };
        }
    }
    return null;
}
function embeddableModel(path, schema) {
    const local = path[path.length - 1];
    for (const record of schema.records.values()) {
        if (record.symbol.localName !== local)
            continue;
        if (hasDecorator(record.decorators, "table"))
            return null; // entity, not a value object
        return record;
    }
    return null;
}
/** Local names of every model embedded somewhere as a value object. The schema
 * emitter skips these: they live inside their host tables, not as tables. A model
 * that is @link'd anywhere is an entity (it owns the table the link points at), so
 * it is excluded even if some other field embeds it. */
export function collectEmbeddedModels(schema) {
    const embedded = new Set();
    for (const record of schema.records.values()) {
        for (const field of record.fields) {
            const ref = embeddedModelRef(field, schema);
            if (ref !== null)
                embedded.add(ref.model.symbol.localName);
        }
    }
    for (const linked of collectLinkedModels(schema))
        embedded.delete(linked);
    return embedded;
}
/** Local names of every model targeted by a @link field — these own a table. */
function collectLinkedModels(schema) {
    const linked = new Set();
    for (const record of schema.records.values()) {
        for (const field of record.fields) {
            if (!hasDecorator(field.decorators, "link"))
                continue;
            const { inner } = unwrapNullable(field.type);
            const named = inner.kind === "array"
                ? (inner.element.kind === "nullable" ? inner.element.inner : inner.element)
                : inner;
            if (named.kind !== "named")
                continue;
            const model = modelByLocalName(named.path[named.path.length - 1], schema);
            if (model !== null)
                linked.add(model.symbol.localName);
        }
    }
    return linked;
}
function renderEmbeddedField(tableName, fieldName, field, embedded, schema, seen) {
    const surrealName = surrealFieldName(field, fieldName);
    const childSeen = new Set(seen);
    childSeen.add(embedded.model.symbol.localName);
    if (embedded.isArray) {
        const arrayType = embedded.optional ? "option<array<object>>" : "array<object>";
        const lines = [
            `DEFINE FIELD ${surrealName} ON TABLE ${tableName} TYPE ${arrayType};`,
            `DEFINE FIELD ${surrealName}.* ON TABLE ${tableName} TYPE object;`,
        ];
        appendEmbeddedSubfields(lines, tableName, `${surrealName}.*`, embedded.model, schema, childSeen);
        return lines;
    }
    const objectType = embedded.optional ? "option<object>" : "object";
    const lines = [`DEFINE FIELD ${surrealName} ON TABLE ${tableName} TYPE ${objectType};`];
    appendEmbeddedSubfields(lines, tableName, surrealName, embedded.model, schema, childSeen);
    return lines;
}
function appendEmbeddedSubfields(lines, tableName, prefix, model, schema, seen) {
    for (const subfield of model.fields) {
        if (subfield.isPrivate)
            continue;
        lines.push(...renderField(tableName, `${prefix}.${subfield.name}`, subfield, schema, seen));
    }
}
function fieldTypeFor(type, decorators, schema) {
    const override = firstStringArg(decorators, "surreal.type");
    if (override !== null)
        return override;
    // A @references decorator turns a field into a typed record link.
    const reference = firstStringArg(decorators, "references");
    if (reference !== null)
        return `record<${referencedTable(reference)}>`;
    // @link makes a named-model field a record link to that model's own table.
    if (hasDecorator(decorators, "link"))
        return linkType(type, schema);
    return mapType(type, schema);
}
// record<table> for a @link field, preserving an array wrapper for [Model] links.
function linkType(type, schema) {
    if (type.kind === "array") {
        const element = type.element.kind === "nullable" ? type.element.inner : type.element;
        return `array<${recordRef(element, schema)}>`;
    }
    return recordRef(type, schema);
}
function recordRef(type, schema) {
    if (type.kind === "named") {
        const model = modelByLocalName(type.path[type.path.length - 1], schema);
        if (model !== null)
            return `record<${tableNameFor(model)}>`;
    }
    return "record"; // untyped record link fallback
}
function modelByLocalName(name, schema) {
    for (const record of schema.records.values()) {
        if (record.symbol.localName === name)
            return record;
    }
    return null;
}
function mapType(type, schema) {
    if (type.kind === "scalar")
        return SCALAR_SURREAL[type.scalar];
    if (type.kind === "decimal")
        return "decimal";
    if (type.kind === "array") {
        const element = mapType(type.element, schema);
        // SurrealDB array types bound max size: array<T, N>. Min is a field ASSERT.
        if (type.maxItems !== undefined)
            return `array<${element}, ${type.maxItems}>`;
        return `array<${element}>`;
    }
    if (type.kind === "map")
        return "object";
    if (type.kind === "named")
        return mapNamedType(type.path, schema);
    // unions, oneof, nested nullable → untyped object payload
    return "object";
}
function mapNamedType(path, schema) {
    const local = path[path.length - 1];
    for (const symbol of schema.enums.values()) {
        if (symbol.localName === local)
            return "string"; // enums are stored as strings
    }
    // A reference to another model with no @references link is stored embedded.
    return "object";
}
function referencedTable(reference) {
    const segments = reference.split(".");
    return toSnakeCase(segments[0]);
}
function defaultClauseFor(decorators) {
    const decorator = findDecorator(decorators, "default");
    if (decorator === null || decorator.args.length === 0)
        return null;
    const value = decorator.args[0].value;
    if (value.kind === "expr")
        return `DEFAULT ${exprToSurreal(value.expr)}`;
    if (value.kind === "string")
        return `DEFAULT '${value.value}'`;
    const literal = decoratorValueToString(value);
    if (literal === null)
        return null;
    return `DEFAULT ${literal}`;
}
// Collect every constraint that maps onto a SurrealDB ASSERT, joined with AND.
function assertClauseFor(type, decorators, schema) {
    const asserts = [];
    const enumValues = enumValuesFor(type, schema);
    if (enumValues !== null)
        asserts.push(`$value INSIDE [${enumValues.join(", ")}]`);
    appendNumericAsserts(asserts, decorators);
    appendLengthAsserts(asserts, decorators);
    appendArrayLengthAsserts(asserts, type);
    appendFormatAsserts(asserts, decorators);
    appendCheckAssert(asserts, decorators);
    if (asserts.length === 0)
        return null;
    return `ASSERT ${asserts.join(" AND ")}`;
}
function enumValuesFor(type, schema) {
    if (type.kind !== "named")
        return null;
    const local = type.path[type.path.length - 1];
    for (const symbol of schema.enums.values()) {
        if (symbol.localName !== local)
            continue;
        const decl = symbol.decl;
        return decl.variants.map(variant => `'${variant.name}'`);
    }
    return null;
}
function appendNumericAsserts(asserts, decorators) {
    const min = firstStringArg(decorators, "minValue");
    if (min !== null)
        asserts.push(`$value >= ${min}`);
    const max = firstStringArg(decorators, "maxValue");
    if (max !== null)
        asserts.push(`$value <= ${max}`);
}
function appendLengthAsserts(asserts, decorators) {
    const min = firstStringArg(decorators, "minLength");
    if (min !== null)
        asserts.push(`string::len($value) >= ${min}`);
    const max = firstStringArg(decorators, "maxLength");
    if (max !== null)
        asserts.push(`string::len($value) <= ${max}`);
}
// Array min-length: the max bound is carried by the `array<T, N>` type itself.
function appendArrayLengthAsserts(asserts, type) {
    const array = type.kind === "nullable" ? type.inner : type;
    if (array.kind === "array" && array.minItems !== undefined) {
        asserts.push(`array::len($value) >= ${array.minItems}`);
    }
}
function appendFormatAsserts(asserts, decorators) {
    const format = firstStringArg(decorators, "format");
    if (format === "email")
        asserts.push("string::is::email($value)");
    if (format === "uuid")
        asserts.push("string::is::uuid($value)");
    if (format === "url" || format === "uri")
        asserts.push("string::is::url($value)");
    const pattern = firstStringArg(decorators, "pattern");
    if (pattern !== null)
        asserts.push(`string::matches($value, '${pattern}')`);
}
function appendCheckAssert(asserts, decorators) {
    const decorator = findDecorator(decorators, "check");
    if (decorator === null || decorator.args.length === 0)
        return;
    const value = decorator.args[0].value;
    if (value.kind !== "expr")
        return;
    asserts.push(`(${exprToSurreal(value.expr)})`);
}
function exprToSurreal(expr) {
    if (expr.kind === "literal") {
        if (typeof expr.value === "string")
            return `'${expr.value}'`;
        return String(expr.value);
    }
    if (expr.kind === "ident")
        return expr.name;
    if (expr.kind === "call")
        return `${expr.callee}(${expr.args.map(exprToSurreal).join(", ")})`;
    if (expr.kind === "unary")
        return `${expr.op}${exprToSurreal(expr.operand)}`;
    return `${exprToSurreal(expr.left)} ${expr.op} ${exprToSurreal(expr.right)}`;
}
/** Render a full DEFINE TABLE + fields — reused by the schema emitter and the
 * migration emitter's CreateModel op. */
export function renderCreateTable(record, schema, company, includePrivate) {
    const tableName = tableNameFor(record);
    const lines = [`DEFINE TABLE ${tableName} SCHEMAFULL;`];
    for (const field of record.fields) {
        if (field.isPrivate && !includePrivate)
            continue;
        lines.push(...renderField(tableName, field.name, field, schema));
    }
    if (company !== null) {
        const byCompany = schema.overlays.get(record.symbol.qualifiedName);
        const overlay = byCompany?.get(company);
        if (overlay !== undefined) {
            for (const field of overlay.fields) {
                const fieldName = `${toSnakeCase(company)}_${field.name}`;
                lines.push(...renderField(tableName, fieldName, field, schema));
            }
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=surrealDdl.js.map