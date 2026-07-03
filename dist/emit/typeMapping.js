// src/emit/typeMapping.ts
// Shared helpers for reading decorators and inspecting types across emitters.
/** Base-record fields an emitter should render, honouring includePrivate. */
export function baseFieldsToEmit(record, context) {
    if (context.includePrivate)
        return record.fields;
    return record.fields.filter(field => !field.isPrivate);
}
/** The selected company's overlay fields for this record, or []. */
export function overlayFieldsToEmit(schema, record, company) {
    if (company === null)
        return [];
    const byCompany = schema.overlays.get(record.symbol.qualifiedName);
    if (byCompany === undefined)
        return [];
    const overlay = byCompany.get(company);
    if (overlay === undefined)
        return [];
    return overlay.fields;
}
// Phases that make up an operation INPUT (request body / arguments).
export const INPUT_PHASES = ["create", "update", "query"];
// The phase that makes up an operation OUTPUT (response body).
export const OUTPUT_PHASE = "read";
export function isVisibleIn(decorators, phase) {
    if (hasDecorator(decorators, "invisible"))
        return false;
    const visibility = findDecorator(decorators, "visibility");
    if (visibility === null)
        return true; // unrestricted
    for (const arg of visibility.args) {
        if (arg.value.kind === "string" && arg.value.value === phase)
            return true;
    }
    return false;
}
/** True if the field belongs in an operation input (any input phase). */
export function isVisibleInInput(decorators) {
    if (hasDecorator(decorators, "invisible"))
        return false;
    // @input on a field marks it input-only; it always belongs in inputs.
    if (hasDecorator(decorators, "input"))
        return true;
    return INPUT_PHASES.some(phase => isVisibleIn(decorators, phase));
}
/** True if the field belongs in an operation output (the read phase). */
export function isVisibleInOutput(decorators) {
    // A field-level @input is input-only: never shown in output types.
    if (hasDecorator(decorators, "input"))
        return false;
    return isVisibleIn(decorators, OUTPUT_PHASE);
}
/**
 * A model-level @input marks the whole model as input-only: emitters skip its
 * output type / database table and emit it only as an input shape.
 */
export function isInputModel(model) {
    return hasDecorator(model.decorators, "input");
}
/** Find a decorator by its dotted name, e.g. "sql.type" or "table". */
export function findDecorator(decorators, name) {
    for (const decorator of decorators) {
        if (decorator.name === name)
            return decorator;
    }
    return null;
}
export function hasDecorator(decorators, name) {
    return findDecorator(decorators, name) !== null;
}
/** Every decorator with the given dotted name (a name may repeat, e.g. multiple
 *  @neoworks.index declarations on one model). */
export function allDecorators(decorators, name) {
    return decorators.filter(decorator => decorator.name === name);
}
/** The positional (unnamed) string arguments of a decorator, in order. */
export function positionalStringArgs(decorator) {
    const out = [];
    for (const arg of decorator.args) {
        if (arg.name !== null)
            continue;
        const value = decoratorValueToString(arg.value);
        if (value !== null)
            out.push(value);
    }
    return out;
}
/** First positional argument value of a decorator, as a plain string. */
export function firstStringArg(decorators, name) {
    const decorator = findDecorator(decorators, name);
    if (decorator === null || decorator.args.length === 0)
        return null;
    return decoratorValueToString(decorator.args[0].value);
}
/** A named argument of a decorator, as a plain string. E.g. the "text_en" in
 *  @neoworks.fulltext(analyzer: "text_en"). Returns null when absent. */
export function namedStringArg(decorators, name, argName) {
    const decorator = findDecorator(decorators, name);
    if (decorator === null)
        return null;
    for (const arg of decorator.args) {
        if (arg.name === argName)
            return decoratorValueToString(arg.value);
    }
    return null;
}
export function decoratorValueToString(value) {
    if (value.kind === "string")
        return value.value;
    if (value.kind === "ident")
        return value.value;
    if (value.kind === "number")
        return String(value.value);
    if (value.kind === "bool")
        return String(value.value);
    return null; // expr values have no simple string form
}
/** Strip a single nullable wrapper, returning the inner type and a flag. */
export function unwrapNullable(type) {
    if (type.kind === "nullable")
        return { inner: type.inner, nullable: true };
    return { inner: type, nullable: false };
}
// ── @link (store a model field by its primary-key id) ──────────────────────────
//
// A @link field references another model by id instead of embedding it. For most
// targets the field renders as the linked model's primary-key scalar (uuid by
// default); array/nullable wrappers are preserved. SurrealDB instead emits its
// native record<table> link (see surrealDdl), and SQL adds a foreign-key clause.
const SYNTHETIC_SPAN = { line: 0, col: 0 };
/** A model's primary-key field, or null when none is marked @primaryKey. */
export function primaryKeyField(model) {
    for (const field of model.fields) {
        if (hasDecorator(field.decorators, "primaryKey"))
            return field;
    }
    return null;
}
/** The non-nullable type of a model's primary key. The resolver (OS1016) rejects
 * @link targets that lack exactly one @primaryKey, so the uuid branch is only a
 * defensive fallback for already-invalid schemas. */
export function primaryKeyType(model) {
    const field = primaryKeyField(model);
    if (field !== null)
        return unwrapNullable(field.type).inner;
    return { kind: "scalar", scalar: "uuid", span: SYNTHETIC_SPAN };
}
export function modelByLocalName(name, schema) {
    for (const record of schema.records.values()) {
        if (record.symbol.localName === name)
            return record;
    }
    return null;
}
/** If `field` is @link, rewrite each named-model reference in its type to that
 * model's primary-key scalar, preserving array/nullable wrappers. Otherwise
 * returns the type unchanged. */
export function applyLink(type, field, schema) {
    if (!hasDecorator(field.decorators, "link"))
        return type;
    return rewriteLinks(type, schema);
}
function rewriteLinks(type, schema) {
    if (type.kind === "named") {
        const model = modelByLocalName(type.path[type.path.length - 1], schema);
        if (model !== null)
            return primaryKeyType(model);
        return type;
    }
    if (type.kind === "array")
        return { ...type, element: rewriteLinks(type.element, schema) };
    if (type.kind === "nullable")
        return { ...type, inner: rewriteLinks(type.inner, schema) };
    return type;
}
/** snake_case a camelCase or PascalCase identifier. */
export function toSnakeCase(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
}
// ── Type aliases ──────────────────────────────────────────────────────────────
//
// `type X = ...` aliases come in two flavours. NON-UNION aliases (scalar/array/
// map/named) are inlined: every reference expands to the underlying type, because
// most targets cannot name an array or scalar. UNION aliases (`type G = A | B`)
// become first-class named types (GraphQL union, TS union, json-schema anyOf, …).
/** The alias whose local name matches `name`, or null. Matches the enum/record
 * localName lookups used by the sql/surreal/internal emitters. */
export function aliasByLocalName(name, schema) {
    for (const symbol of schema.aliases.values()) {
        if (symbol.localName === name)
            return symbol.decl;
    }
    return null;
}
/** True if a named reference points at a union alias (`type G = A | B`). */
export function isUnionAlias(path, schema) {
    const alias = aliasByLocalName(path[path.length - 1], schema);
    return alias !== null && alias.type.kind === "union";
}
/** Every union alias in declaration order, for first-class named emission. */
export function unionAliases(schema) {
    const result = [];
    for (const symbol of schema.aliases.values()) {
        const alias = symbol.decl;
        if (alias.type.kind === "union")
            result.push({ name: symbol.localName, alias });
    }
    return result;
}
/**
 * If `type` is a `named` reference to a NON-union alias, return its underlying
 * type with any generic type-params substituted, following alias→alias chains.
 * Union-alias and model/enum references are returned unchanged. Cycle-guarded.
 *
 * This resolves only the top node; deep inlining of nested references is the
 * resolver normalization pass's job. Emitters use it to resolve union variants.
 */
export function resolveAliasInline(type, schema, seen = new Set()) {
    if (type.kind !== "named")
        return type;
    const name = type.path[type.path.length - 1];
    const alias = aliasByLocalName(name, schema);
    if (alias === null)
        return type; // model / enum / type-param reference
    if (alias.type.kind === "union")
        return type; // union alias stays named
    if (seen.has(name))
        return type; // cycle — resolver reports OS1010
    seen.add(name);
    let body = alias.type;
    if (alias.typeParams.length > 0) {
        body = substituteTypeParams(body, alias.typeParams.map(p => p.name), type.typeArgs);
    }
    return resolveAliasInline(body, schema, seen);
}
/** Rewrite `body`, replacing each bare type-param reference with its argument.
 * Builds new nodes; never mutates `body`. */
export function substituteTypeParams(body, paramNames, typeArgs) {
    const bindings = new Map();
    paramNames.forEach((paramName, index) => {
        if (index < typeArgs.length)
            bindings.set(paramName, typeArgs[index]);
    });
    return substitute(body, bindings);
}
function substitute(type, bindings) {
    switch (type.kind) {
        case "named":
            if (type.path.length === 1 && type.typeArgs.length === 0 && bindings.has(type.path[0])) {
                return bindings.get(type.path[0]);
            }
            return { ...type, typeArgs: type.typeArgs.map(arg => substitute(arg, bindings)) };
        case "array":
            return { ...type, element: substitute(type.element, bindings) };
        case "map":
            return { ...type, key: substitute(type.key, bindings), value: substitute(type.value, bindings) };
        case "nullable":
            return { ...type, inner: substitute(type.inner, bindings) };
        case "union":
            return { ...type, variants: type.variants.map(variant => substitute(variant, bindings)) };
        case "oneof":
            return { ...type, variants: type.variants.map(v => ({ ...v, type: substitute(v.type, bindings) })) };
        default:
            return type;
    }
}
//# sourceMappingURL=typeMapping.js.map