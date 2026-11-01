// src/emit/typeMapping.ts
// Shared helpers for reading decorators and inspecting types across emitters.
// ── File ──────────────────────────────────────────────────────────────────────
//
// The built-in `File` type as the API-surface targets render it. The codec and
// descriptor targets describe the same value on the wire (see codec/filePlan.ts).
export const FILE_TS = "{ objectId: string; name: string; mediaType: string; size: number; " +
    "variants: { [variant: string]: { objectId: string; size: number } } }";
const FILE_OBJECT_ID = { type: "string", format: "uuid" };
export const FILE_JSON_SCHEMA = {
    type: "object",
    required: ["objectId", "name", "mediaType", "size"],
    properties: {
        objectId: FILE_OBJECT_ID,
        name: { type: "string" },
        mediaType: { type: "string" },
        size: { type: "integer", minimum: 0 },
        variants: {
            type: "object",
            additionalProperties: {
                type: "object",
                required: ["objectId", "size"],
                properties: { objectId: FILE_OBJECT_ID, size: { type: "integer", minimum: 0 } },
            },
        },
    },
};
// ── semver ────────────────────────────────────────────────────────────────────
//
// In code a `semver` is three numbers, compared as integers. Its JSON form is
// the text "major.minor.patch", without pre-release or build suffixes.
export const SEMVER_TS = "{ major: number; minor: number; patch: number }";
export const SEMVER_ZOD = "z.object({ major: z.number().int().nonnegative(), " +
    "minor: z.number().int().nonnegative(), patch: z.number().int().nonnegative() })";
export const SEMVER_PATTERN = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$";
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
/**
 * A model-level @value marks an embedded value object: it is stored inline (as
 * JSON) in every model that uses it and never gets a table of its own.
 */
export function isValueModel(model) {
    return hasDecorator(model.decorators, "value");
}
/**
 * A model-level @abstract marks a shared base that is never stored on its own:
 * only the models extending it are. GraphQL renders it as an interface.
 */
export function isAbstractModel(model) {
    return hasDecorator(model.decorators, "abstract");
}
/** True when a database target gives this model a table: not generic, @input, @value or @abstract. */
export function isTableModel(model) {
    if (model.isGeneric)
        return false;
    if (isInputModel(model))
        return false;
    if (isAbstractModel(model))
        return false;
    return !isValueModel(model);
}
/** The model a `ref<T>` type names, or null when the type is not a reference. */
export function referencedModel(type, schema) {
    if (type.kind !== "scalar" || type.reference === undefined)
        return null;
    const qualified = schema.records.get(type.reference.join("."));
    if (qualified !== undefined)
        return qualified;
    return modelByLocalName(type.reference[type.reference.length - 1], schema);
}
/** Every concrete (non-abstract) model extending `base`, directly or through other bases. */
export function concreteSubtypes(base, schema) {
    const subtypes = [];
    for (const record of schema.records.values()) {
        if (record.isGeneric || isAbstractModel(record))
            continue;
        if (extendsModel(record, base))
            subtypes.push(record);
    }
    return subtypes;
}
/** True when `record` has `base` somewhere in its extends chain. */
export function extendsModel(record, base) {
    return record.baseChain.some(symbol => symbol.qualifiedName === base.symbol.qualifiedName);
}
/** The abstract models in a record's extends chain, nearest first. */
export function abstractAncestors(record, schema) {
    const ancestors = [];
    for (const symbol of record.baseChain) {
        const base = schema.records.get(symbol.qualifiedName);
        if (base !== undefined && isAbstractModel(base))
            ancestors.push(base);
    }
    return ancestors;
}
/** The closest @abstract model in a record's extends chain, or null. */
export function nearestAbstractAncestor(record, schema) {
    const ancestors = abstractAncestors(record, schema);
    if (ancestors.length === 0)
        return null;
    return ancestors[0];
}
/** The fields a record adds on top of `base` (all of them when there is no base). */
export function fieldsBeyond(fields, base) {
    if (base === null)
        return fields;
    const inherited = new Set(base.fields.map(field => field.ordinal));
    return fields.filter(field => !inherited.has(field.ordinal));
}
/** Records reordered so every @abstract base comes before the models extending it. */
export function abstractBasesFirst(records, schema) {
    const depth = (record) => abstractAncestors(record, schema).length;
    return records.map((record, position) => ({ record, position }))
        .sort((left, right) => depth(left.record) - depth(right.record) || left.position - right.position)
        .map(entry => entry.record);
}
/** The abstract model a named type points at, or null. */
export function abstractModelOf(type, schema) {
    if (type.kind !== "named")
        return null;
    const model = modelByLocalName(type.path[type.path.length - 1], schema);
    if (model === null || !isAbstractModel(model))
        return null;
    return model;
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
/** Every decorator with the given dotted name; a name may repeat on one element. */
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
/** A named list argument of a decorator whose elements are all strings or names, e.g. `fields`
 *  in @neoworks.index(fields: ["calendar", "start"]). Returns null when absent or not such a list. */
export function namedStringListArg(decorator, argName) {
    const arg = decorator.args.find(candidate => candidate.name === argName);
    if (arg === undefined || arg.value.kind !== "list")
        return null;
    const strings = arg.value.values.map(decoratorValueToString);
    if (strings.some(text => text === null))
        return null;
    return strings;
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
export function modelByLocalName(name, schema) {
    for (const record of schema.records.values()) {
        if (record.symbol.localName === name)
            return record;
    }
    return null;
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