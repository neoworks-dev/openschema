// src/emit/jsonSchema/jsonSchemaEmitter.ts
// Emits a JSON Schema document (draft 2020-12) from a resolved schema.
import { baseFieldsToEmit, overlayFieldsToEmit, unwrapNullable, applyLink, firstStringArg, findDecorator, unionAliases, resolveAliasInline, } from "../typeMapping.js";
const SCALAR_JSON = {
    bool: { type: "boolean" },
    i8: { type: "integer" }, i16: { type: "integer" }, i32: { type: "integer" }, i64: { type: "integer" },
    u8: { type: "integer", minimum: 0 }, u16: { type: "integer", minimum: 0 },
    u32: { type: "integer", minimum: 0 }, u64: { type: "integer", minimum: 0 },
    f32: { type: "number" }, f64: { type: "number" },
    string: { type: "string" }, bytes: { type: "string", contentEncoding: "base64" },
    uuid: { type: "string", format: "uuid" },
    json: {},
    date: { type: "string", format: "date" }, time: { type: "string", format: "time" },
    timestamp: { type: "string", format: "date-time" }, duration: { type: "string", format: "duration" },
};
export const jsonSchemaEmitter = {
    target: "json-schema",
    fileExtension: "json",
    emit(context) {
        const defs = {};
        for (const symbol of context.schema.enums.values()) {
            defs[symbol.localName] = enumSchema(symbol.decl);
        }
        for (const record of context.schema.records.values()) {
            if (record.isGeneric)
                continue;
            defs[record.symbol.localName] = recordSchema(record, context);
        }
        for (const { name, alias } of unionAliases(context.schema)) {
            if (alias.type.kind !== "union")
                continue;
            defs[name] = { anyOf: alias.type.variants.map(v => mapType(resolveAliasInline(v, context.schema))) };
        }
        const doc = {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $defs: defs,
        };
        return [{ path: `schema.${this.fileExtension}`, contents: JSON.stringify(doc, null, 2) + "\n" }];
    },
};
function enumSchema(decl) {
    return { type: "string", enum: decl.variants.map(v => v.name) };
}
function recordSchema(record, context) {
    const properties = {};
    const required = [];
    const fields = [
        ...baseFieldsToEmit(record, context),
        ...overlayFieldsToEmit(context.schema, record, context.company),
    ];
    for (const field of fields) {
        const { inner, nullable } = unwrapNullable(applyLink(field.type, field, context.schema));
        properties[field.name] = fieldSchema(inner, field);
        if (!nullable)
            required.push(field.name);
    }
    const schema = { type: "object", properties };
    if (required.length > 0)
        schema.required = required;
    return schema;
}
function fieldSchema(type, field) {
    const base = mapType(type);
    applyConstraints(base, field);
    return base;
}
function applyConstraints(schema, field) {
    const format = firstStringArg(field.decorators, "format");
    if (format !== null && schema.type === "string")
        schema.format = format;
    applyNumericBound(schema, field, "minValue", "minimum");
    applyNumericBound(schema, field, "maxValue", "maximum");
    applyNumericBound(schema, field, "minLength", "minLength");
    applyNumericBound(schema, field, "maxLength", "maxLength");
    const pattern = firstStringArg(field.decorators, "pattern");
    if (pattern !== null)
        schema.pattern = pattern;
}
function applyNumericBound(schema, field, decorator, keyword) {
    const found = findDecorator(field.decorators, decorator);
    if (found === null || found.args.length === 0)
        return;
    const value = found.args[0].value;
    if (value.kind !== "number")
        return;
    schema[keyword] = value.value;
}
function mapType(type) {
    switch (type.kind) {
        case "scalar": return { ...SCALAR_JSON[type.scalar] };
        case "decimal": return { type: "string" };
        case "named": return { $ref: `#/$defs/${type.path[type.path.length - 1]}` };
        case "array": {
            const arraySchema = { type: "array", items: mapType(type.element) };
            if (type.minItems !== undefined)
                arraySchema.minItems = type.minItems;
            if (type.maxItems !== undefined)
                arraySchema.maxItems = type.maxItems;
            return arraySchema;
        }
        case "map": return { type: "object", additionalProperties: mapType(type.value) };
        case "nullable": return mapType(type.inner);
        case "union": return { anyOf: type.variants.map(mapType) };
        case "oneof": return { oneOf: type.variants.map(v => mapType(v.type)) };
    }
}
//# sourceMappingURL=jsonSchemaEmitter.js.map