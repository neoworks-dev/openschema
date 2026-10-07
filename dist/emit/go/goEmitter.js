// src/emit/go/goEmitter.ts
// Emits Go structs and enum constants from a resolved schema.
import { baseFieldsToEmit, overlayFieldsToEmit, unwrapNullable, unionAliases } from "../typeMapping.js";
const SCALAR_GO = {
    bool: "bool",
    i8: "int8", i16: "int16", i32: "int32", i64: "int64",
    u8: "uint8", u16: "uint16", u32: "uint32", u64: "uint64",
    f32: "float32", f64: "float64",
    string: "string", bytes: "[]byte", uuid: "string", json: "any",
    date: "string", time: "string", timestamp: "string", duration: "string",
};
export const goEmitter = {
    target: "go",
    fileExtension: "go",
    emit(context) {
        const pkg = context.options.package ?? "schema";
        const blocks = [`package ${pkg}`];
        for (const symbol of context.schema.enums.values()) {
            blocks.push(emitEnum(symbol.decl));
        }
        for (const record of context.schema.records.values()) {
            if (record.isGeneric)
                continue;
            blocks.push(emitStruct(record, context));
        }
        // Go has no sum type; a union alias is an open `any`.
        for (const { name } of unionAliases(context.schema)) {
            blocks.push(`type ${name} = any`);
        }
        return [{ path: `schema.${this.fileExtension}`, contents: blocks.join("\n\n") + "\n" }];
    },
};
function emitEnum(decl) {
    const consts = decl.variants
        .map(v => `\t${decl.name}${pascalCase(v.name)} ${decl.name} = ${v.ordinal}`)
        .join("\n");
    return `type ${decl.name} int32\n\nconst (\n${consts}\n)`;
}
function emitStruct(record, context) {
    const lines = [];
    const fields = [
        ...baseFieldsToEmit(record, context),
        ...overlayFieldsToEmit(context.schema, record, context.company),
    ];
    for (const field of fields) {
        lines.push(fieldLine(field, context.schema));
    }
    return `type ${record.symbol.localName} struct {\n${lines.join("\n")}\n}`;
}
function fieldLine(field, schema) {
    const { inner, nullable } = unwrapNullable(field.type);
    const goType = nullable ? `*${mapType(inner, schema)}` : mapType(inner, schema);
    const tag = nullable ? `${field.name},omitempty` : field.name;
    return `\t${pascalCase(field.name)} ${goType} \`json:"${tag}"\``;
}
function mapType(type, schema) {
    switch (type.kind) {
        case "scalar": return SCALAR_GO[type.scalar];
        case "decimal": return "string";
        case "named": return pascalCase(type.path[type.path.length - 1]);
        case "array": return `[]${mapType(type.element, schema)}`;
        case "map": return `map[${mapType(type.key, schema)}]${mapType(type.value, schema)}`;
        case "nullable": return `*${mapType(type.inner, schema)}`;
        // Go has no null type; a `T | null` union already renders as interface{}.
        case "null": return "interface{}";
        case "union": return "interface{}";
        case "oneof": return "interface{}";
    }
}
function pascalCase(name) {
    if (name.length === 0)
        return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
}
//# sourceMappingURL=goEmitter.js.map