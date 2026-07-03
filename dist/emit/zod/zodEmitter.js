// src/emit/zod/zodEmitter.ts
// Emits Zod schemas (and inferred TypeScript types) from a resolved schema.
import { baseFieldsToEmit, overlayFieldsToEmit, unwrapNullable, applyLink, firstStringArg, findDecorator, unionAliases, resolveAliasInline, } from "../typeMapping.js";
// Base Zod expression for each scalar. String-shaped temporal/uuid scalars mirror
// the TypeScript emitter, which renders them as `string`.
const SCALAR_ZOD = {
    bool: "z.boolean()",
    i8: "z.number().int()", i16: "z.number().int()", i32: "z.number().int()", i64: "z.number().int()",
    u8: "z.number().int().nonnegative()", u16: "z.number().int().nonnegative()",
    u32: "z.number().int().nonnegative()", u64: "z.number().int().nonnegative()",
    f32: "z.number()", f64: "z.number()",
    string: "z.string()", bytes: "z.instanceof(Uint8Array)", uuid: "z.string().uuid()", json: "z.unknown()",
    date: "z.string()", time: "z.string()", timestamp: "z.string()", duration: "z.string()",
};
// @format names that map onto a built-in Zod string refinement.
const FORMAT_METHOD = {
    email: ".email()",
    url: ".url()",
    uuid: ".uuid()",
    cuid: ".cuid()",
    emoji: ".emoji()",
    ip: ".ip()",
    datetime: ".datetime()",
};
export const zodEmitter = {
    target: "zod",
    fileExtension: "ts",
    emit(context) {
        const blocks = [`import { z } from "zod";`];
        for (const symbol of context.schema.enums.values()) {
            blocks.push(emitEnum(symbol.localName, symbol.decl));
        }
        for (const record of context.schema.records.values()) {
            if (record.isGeneric)
                continue; // generic models are not directly emittable
            blocks.push(emitObject(record, context));
        }
        for (const { name, alias } of unionAliases(context.schema)) {
            blocks.push(emitUnionAlias(name, alias, context.schema));
        }
        return [{ path: `schema.${this.fileExtension}`, contents: blocks.join("\n\n") + "\n" }];
    },
};
function schemaName(localName) {
    return `${localName}Schema`;
}
function emitEnum(localName, decl) {
    const variants = decl.variants.map(v => `"${v.name}"`).join(", ");
    const name = schemaName(localName);
    return `export const ${name} = z.enum([${variants}]);\n` +
        `export type ${localName} = z.infer<typeof ${name}>;`;
}
function emitObject(record, context) {
    const localName = record.symbol.localName;
    const name = schemaName(localName);
    const lines = [];
    for (const field of baseFieldsToEmit(record, context)) {
        lines.push(fieldLine(field, context.schema));
    }
    for (const field of overlayFieldsToEmit(context.schema, record, context.company)) {
        lines.push(fieldLine(field, context.schema));
    }
    const body = lines.join("\n");
    return `export const ${name} = z.object({\n${body}\n});\n` +
        `export type ${localName} = z.infer<typeof ${name}>;`;
}
function emitUnionAlias(localName, alias, schema) {
    if (alias.type.kind !== "union")
        return "";
    const members = alias.type.variants.map(v => mapType(resolveAliasInline(v, schema), schema));
    const name = schemaName(localName);
    return `export const ${name} = z.union([${members.join(", ")}]);\n` +
        `export type ${localName} = z.infer<typeof ${name}>;`;
}
function fieldLine(field, schema) {
    const { inner, nullable } = unwrapNullable(applyLink(field.type, field, schema));
    let expr = mapType(inner, schema);
    expr += constraintChain(inner, field);
    if (nullable)
        expr += ".nullish()"; // matches TS `field?: T | null`
    const docPrefix = field.isPrivate ? "  /** @private */\n" : "";
    return `${docPrefix}  ${field.name}: ${expr},`;
}
// Decorator-driven refinements, applied per the inner type so a `.min()` lands on
// the right Zod builder (string length vs. numeric bound vs. array length).
function constraintChain(type, field) {
    if (type.kind === "scalar") {
        if (type.scalar === "string")
            return stringConstraints(field);
        if (isNumericScalar(type.scalar))
            return numericConstraints(field);
    }
    if (type.kind === "decimal")
        return numericConstraints(field);
    if (type.kind === "array")
        return arrayConstraints(field);
    return "";
}
function stringConstraints(field) {
    let chain = "";
    const format = firstStringArg(field.decorators, "format");
    if (format !== null && FORMAT_METHOD[format] !== undefined)
        chain += FORMAT_METHOD[format];
    chain += numericMethod(field, "minLength", "min");
    chain += numericMethod(field, "maxLength", "max");
    const pattern = firstStringArg(field.decorators, "pattern");
    if (pattern !== null)
        chain += `.regex(/${pattern}/)`;
    return chain;
}
function numericConstraints(field) {
    return numericMethod(field, "minValue", "min") + numericMethod(field, "maxValue", "max");
}
function arrayConstraints(field) {
    return numericMethod(field, "minItems", "min") + numericMethod(field, "maxItems", "max");
}
// Render `.<method>(n)` from a numeric decorator argument, or "" when absent.
function numericMethod(field, decorator, method) {
    const found = findDecorator(field.decorators, decorator);
    if (found === null || found.args.length === 0)
        return "";
    const value = found.args[0].value;
    if (value.kind !== "number")
        return "";
    return `.${method}(${value.value})`;
}
function isNumericScalar(scalar) {
    switch (scalar) {
        case "i8":
        case "i16":
        case "i32":
        case "i64":
        case "u8":
        case "u16":
        case "u32":
        case "u64":
        case "f32":
        case "f64":
            return true;
        default:
            return false;
    }
}
function mapType(type, schema) {
    switch (type.kind) {
        case "scalar": return SCALAR_ZOD[type.scalar];
        case "decimal": return "z.number()";
        case "named": return mapNamed(type.path, schema);
        case "array": {
            let expr = `z.array(${mapType(type.element, schema)})`;
            if (type.minItems !== undefined)
                expr += `.min(${type.minItems})`;
            if (type.maxItems !== undefined)
                expr += `.max(${type.maxItems})`;
            return expr;
        }
        case "map": return `z.record(${mapType(type.key, schema)}, ${mapType(type.value, schema)})`;
        case "nullable": return `${mapType(type.inner, schema)}.nullish()`;
        case "union": return `z.union([${type.variants.map(v => mapType(v, schema)).join(", ")}])`;
        case "oneof": return mapOneof(type.variants, schema);
    }
}
// Named references are wrapped in z.lazy so emission order and recursive schemas
// both work regardless of declaration position.
function mapNamed(path, schema) {
    const base = path[path.length - 1];
    return `z.lazy(() => ${schemaName(base)})`;
}
function mapOneof(variants, schema) {
    const members = variants.map(v => `z.object({ kind: z.literal("${v.name}"), ${v.name}: ${mapType(v.type, schema)} })`);
    return `z.discriminatedUnion("kind", [${members.join(", ")}])`;
}
//# sourceMappingURL=zodEmitter.js.map