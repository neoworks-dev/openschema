// src/emit/typescript/typescriptEmitter.ts
// Emits TypeScript interfaces and enums from a resolved schema.
import { baseFieldsToEmit, overlayFieldsToEmit, unwrapNullable, applyLink, unionAliases, resolveAliasInline, } from "../typeMapping.js";
const SCALAR_TS = {
    bool: "boolean",
    i8: "number", i16: "number", i32: "number", i64: "number",
    u8: "number", u16: "number", u32: "number", u64: "number",
    f32: "number", f64: "number",
    string: "string", bytes: "Uint8Array", uuid: "string", json: "unknown",
    date: "string", time: "string", timestamp: "string", duration: "string",
};
export const typescriptEmitter = {
    target: "ts",
    fileExtension: "ts",
    emit(context) {
        const blocks = [];
        for (const symbol of context.schema.enums.values()) {
            blocks.push(emitEnum(symbol.decl));
        }
        for (const record of context.schema.records.values()) {
            blocks.push(emitInterface(record, context));
        }
        for (const { name, alias } of unionAliases(context.schema)) {
            blocks.push(emitUnionAlias(name, alias, context.schema));
        }
        return [{ path: `schema.${this.fileExtension}`, contents: blocks.join("\n\n") + "\n" }];
    },
};
function emitEnum(decl) {
    const members = decl.variants.map(v => `  ${v.name} = ${v.ordinal},`).join("\n");
    return `export enum ${decl.name} {\n${members}\n}`;
}
function emitUnionAlias(name, alias, schema) {
    if (alias.type.kind !== "union")
        return "";
    const members = alias.type.variants.map(v => mapType(resolveAliasInline(v, schema), schema));
    return `export type ${name} = ${members.join(" | ")};`;
}
function emitInterface(record, context) {
    const params = typeParamList(record);
    const lines = [];
    for (const field of baseFieldsToEmit(record, context)) {
        lines.push(fieldLine(field, context.schema));
    }
    for (const field of overlayFieldsToEmit(context.schema, record, context.company)) {
        lines.push(fieldLine(field, context.schema));
    }
    return `export interface ${record.symbol.localName}${params} {\n${lines.join("\n")}\n}`;
}
function typeParamList(record) {
    const decl = record.symbol.decl;
    if (decl.typeParams.length === 0)
        return "";
    return `<${decl.typeParams.map(p => p.name).join(", ")}>`;
}
function fieldLine(field, schema) {
    const { inner, nullable } = unwrapNullable(applyLink(field.type, field, schema));
    const optional = nullable ? "?" : "";
    const tsType = mapType(inner, schema);
    const rendered = nullable ? `${tsType} | null` : tsType;
    const docPrefix = field.isPrivate ? "  /** @private */\n" : "";
    return `${docPrefix}  ${field.name}${optional}: ${rendered};`;
}
function mapType(type, schema) {
    switch (type.kind) {
        case "scalar": return SCALAR_TS[type.scalar];
        case "decimal": return "number";
        case "named": return mapNamed(type.path, type.typeArgs, schema);
        case "array": return `${arrayElement(type.element, schema)}[]`;
        case "map": return `Record<${mapType(type.key, schema)}, ${mapType(type.value, schema)}>`;
        case "nullable": return `${mapType(type.inner, schema)} | null`;
        case "union": return type.variants.map(v => mapType(v, schema)).join(" | ");
        case "oneof": return mapOneof(type.variants, schema);
    }
}
// Array element types whose rendering contains a top-level `|` (unions, oneofs,
// nullables) must be parenthesised before the `[]` so `[A | B]` becomes
// `(A | B)[]`, not `A | B[]`.
function arrayElement(type, schema) {
    const rendered = mapType(type, schema);
    const lowPrecedence = type.kind === "union" || type.kind === "oneof" || type.kind === "nullable";
    return lowPrecedence ? `(${rendered})` : rendered;
}
function mapNamed(path, typeArgs, schema) {
    const base = path[path.length - 1];
    if (typeArgs.length === 0)
        return base;
    return `${base}<${typeArgs.map(a => mapType(a, schema)).join(", ")}>`;
}
function mapOneof(variants, schema) {
    return variants
        .map(v => `{ kind: "${v.name}"; ${v.name}: ${mapType(v.type, schema)} }`)
        .join(" | ");
}
//# sourceMappingURL=typescriptEmitter.js.map