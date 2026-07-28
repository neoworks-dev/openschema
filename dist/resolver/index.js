// src/resolver/index.ts
// Semantic resolver: symbol table, name resolution, extends flattening,
// ordinal validation, and per-company overlay merging.
import { aliasByLocalName, substituteTypeParams, unionAliases, isInputModel, resolveAliasInline, findDecorator, hasDecorator, modelByLocalName, } from "../emit/typeMapping.js";
import { expandReserved, EMPTY_RESERVED } from "./reserved.js";
export { expandReserved, MAX_ORDINAL } from "./reserved.js";
export { loadProject } from "./moduleGraph.js";
class Diagnostics {
    constructor() {
        this.items = [];
    }
    error(code, message, span) {
        this.add("error", code, message, span);
    }
    warning(code, message, span) {
        this.add("warning", code, message, span);
    }
    addAll(items) {
        for (const item of items)
            this.items.push(item);
    }
    add(severity, code, message, span) {
        this.items.push({ code, severity, message, span });
    }
}
/**
 * Resolve a parsed Program into a ResolvedSchema. Single-file today; the
 * import graph is a later extension.
 */
export function resolve(program) {
    return resolveModules([{ moduleId: "<entry>", sourcePath: null, program, importMap: new Map() }]);
}
/**
 * Resolve a module graph (entry module first) into a single ResolvedSchema.
 * Names resolve against each module's own scope (its declarations plus its
 * imports); qualified names resolve against the global table.
 */
export function resolveModules(modules) {
    const diagnostics = new Diagnostics();
    const byQualified = new Map();
    const ownByLocal = new Map();
    const namespaceByModule = new Map();
    // Pass 1: register every module's own declarations.
    for (const module of modules) {
        const namespace = findNamespace(module.program);
        namespaceByModule.set(module.moduleId, namespace);
        ownByLocal.set(module.moduleId, registerModuleSymbols(module, namespace, byQualified, diagnostics));
    }
    // Pass 2: build each module's visible scope (own declarations + imports).
    const scopeByModule = new Map();
    for (const module of modules) {
        scopeByModule.set(module.moduleId, buildModuleScope(module, ownByLocal, diagnostics));
    }
    // Pass 3: resolve named references using each module's scope.
    for (const module of modules) {
        const scope = scopeByModule.get(module.moduleId);
        resolveNamedReferences(module.program, scope, byQualified, diagnostics);
    }
    // Pass 4: flatten records using the declaring module's scope.
    const records = new Map();
    for (const symbol of byQualified.values()) {
        if (symbol.kind !== "model")
            continue;
        const scope = scopeByModule.get(symbol.moduleId);
        records.set(symbol.qualifiedName, flattenModel(symbol, scope, byQualified, diagnostics));
    }
    // Pass 4b: enum and oneof tag spaces, from the raw declarations.
    validateTagSpaces(modules, diagnostics);
    // Pass 5: overlays, per module.
    const overlays = new Map();
    for (const module of modules) {
        const scope = scopeByModule.get(module.moduleId);
        mergeOverlays(overlays, module.program, scope, byQualified, records, diagnostics);
    }
    const enums = filterSymbols(byQualified, "enum");
    const aliases = filterSymbols(byQualified, "type_alias");
    const operations = modules.flatMap(m => collectOperations(m.program));
    const namespace = modules.length > 0 ? namespaceByModule.get(modules[0].moduleId) : [];
    const schema = {
        namespace,
        requiresLedger: modules.some(m => hasDirective(m.program, "requireLedger")),
        symbols: byQualified,
        records,
        enums,
        aliases,
        overlays,
        operations,
        diagnostics: diagnostics.items,
        hasErrors: false,
    };
    // Pass 6: inline non-union aliases (and array-length decorators) into every
    // field and operation type; lint named union aliases. Done last so the schema
    // is fully built.
    schema.operations = normalizeAliases(schema, diagnostics);
    lintUnionAliases(schema, diagnostics);
    lintLinks(schema, diagnostics);
    schema.hasErrors = diagnostics.items.some(d => d.severity === "error");
    return schema;
}
function registerModuleSymbols(module, namespace, byQualified, diagnostics) {
    const ownByLocal = new Map();
    for (const decl of module.program.declarations) {
        const kind = SYMBOL_KINDS[decl.kind];
        if (kind === undefined)
            continue;
        const named = decl;
        if (ownByLocal.has(named.name)) {
            diagnostics.error("OS1001", `Duplicate declaration '${named.name}'`, named.span);
            continue;
        }
        const qualifiedName = qualify(namespace, named.name);
        if (byQualified.has(qualifiedName)) {
            diagnostics.error("OS1002", `Duplicate qualified name '${qualifiedName}'`, named.span);
            continue;
        }
        const symbol = {
            kind, localName: named.name, qualifiedName,
            moduleId: module.moduleId, decl: named, span: named.span,
        };
        ownByLocal.set(symbol.localName, symbol);
        byQualified.set(qualifiedName, symbol);
    }
    return ownByLocal;
}
function buildModuleScope(module, ownByLocal, diagnostics) {
    const scope = new Map(ownByLocal.get(module.moduleId));
    for (const decl of module.program.declarations) {
        if (decl.kind !== "import")
            continue;
        bindImport(scope, decl, module, ownByLocal, diagnostics);
    }
    return scope;
}
function bindImport(scope, importDecl, module, ownByLocal, diagnostics) {
    const targetModuleId = module.importMap.get(importDecl.from);
    if (targetModuleId === undefined) {
        diagnostics.error("OS1008", `Cannot resolve import '${importDecl.from}'`, importDecl.span);
        return;
    }
    const exports = ownByLocal.get(targetModuleId);
    if (exports === undefined) {
        diagnostics.error("OS1008", `Imported module '${importDecl.from}' was not loaded`, importDecl.span);
        return;
    }
    for (const name of importDecl.names) {
        const exported = exports.get(name);
        if (exported === undefined) {
            diagnostics.error("OS1007", `'${name}' is not exported by '${importDecl.from}'`, importDecl.span);
            continue;
        }
        scope.set(name, exported);
    }
}
function collectOperations(program) {
    const operations = [];
    for (const decl of program.declarations) {
        if (decl.kind === "operation") {
            operations.push(decl);
            continue;
        }
        if (decl.kind === "interface") {
            operations.push(...decl.operations);
        }
    }
    return operations;
}
// ── Namespace ─────────────────────────────────────────────────────────────────
/** A directive on the namespace declaration, e.g. `#requireLedger`. */
function hasDirective(program, name) {
    for (const decl of program.declarations) {
        if (decl.kind !== "namespace")
            continue;
        if (decl.directives.some(directive => directive.name === name))
            return true;
    }
    return false;
}
function findNamespace(program) {
    for (const decl of program.declarations) {
        if (decl.kind === "namespace")
            return decl.path;
    }
    return [];
}
function qualify(namespace, name) {
    if (namespace.length === 0)
        return name;
    return `${namespace.join(".")}.${name}`;
}
// ── Symbol table ──────────────────────────────────────────────────────────────
const SYMBOL_KINDS = {
    model: "model",
    enum: "enum",
    type_alias: "type_alias",
};
function filterSymbols(byQualified, kind) {
    const result = new Map();
    for (const [name, symbol] of byQualified) {
        if (symbol.kind === kind)
            result.set(name, symbol);
    }
    return result;
}
// ── Name resolution ───────────────────────────────────────────────────────────
function resolveNamedReferences(program, byLocal, byQualified, diagnostics) {
    for (const decl of program.declarations) {
        const typeParams = declTypeParams(decl);
        forEachType(decl, type => {
            checkNamedReference(type, typeParams, byLocal, byQualified, diagnostics);
        });
    }
}
function declTypeParams(decl) {
    if (decl.kind === "model" || decl.kind === "type_alias") {
        return new Set(decl.typeParams.map(p => p.name));
    }
    return new Set();
}
function checkNamedReference(type, typeParams, byLocal, byQualified, diagnostics) {
    if (type.kind !== "named")
        return;
    if (type.path.length === 1 && typeParams.has(type.path[0]))
        return;
    if (resolveName(type.path, byLocal, byQualified))
        return;
    diagnostics.error("OS1003", `Undefined type '${type.path.join(".")}'`, type.span);
}
function resolveName(path, byLocal, byQualified) {
    if (path.length === 1) {
        return byLocal.get(path[0]) ?? null;
    }
    const joined = path.join(".");
    if (byQualified.has(joined))
        return byQualified.get(joined);
    return byLocal.get(path[path.length - 1]) ?? null;
}
// ── Type traversal ────────────────────────────────────────────────────────────
function forEachType(decl, visit) {
    if (decl.kind === "model") {
        for (const field of decl.members)
            walkType(field.type, visit);
        return;
    }
    if (decl.kind === "type_alias") {
        walkType(decl.type, visit);
        return;
    }
    if (decl.kind === "operation") {
        for (const param of decl.params)
            walkType(param.type, visit);
        walkType(decl.returnType, visit);
        return;
    }
    if (decl.kind === "interface") {
        for (const op of decl.operations) {
            for (const param of op.params)
                walkType(param.type, visit);
            walkType(op.returnType, visit);
        }
        return;
    }
    if (decl.kind === "overlay") {
        for (const field of decl.fields)
            walkType(field.type, visit);
        return;
    }
}
function walkType(type, visit) {
    visit(type);
    switch (type.kind) {
        case "named":
            for (const arg of type.typeArgs)
                walkType(arg, visit);
            return;
        case "array":
            walkType(type.element, visit);
            return;
        case "map":
            walkType(type.key, visit);
            walkType(type.value, visit);
            return;
        case "nullable":
            walkType(type.inner, visit);
            return;
        case "union":
            for (const variant of type.variants)
                walkType(variant, visit);
            return;
        case "oneof":
            for (const variant of type.variants)
                walkType(variant.type, visit);
            return;
        default:
            return;
    }
}
// ── Extends flattening ────────────────────────────────────────────────────────
function flattenModel(symbol, byLocal, byQualified, diagnostics) {
    const record = symbol.decl;
    const baseChain = resolveBaseChain(symbol, byLocal, byQualified, diagnostics);
    const fields = [];
    // Root-first so derived fields override nothing and order is stable.
    for (let i = baseChain.length - 1; i >= 0; i--) {
        const base = baseChain[i].decl;
        appendFields(fields, base.members, baseChain[i].qualifiedName, "inherited");
    }
    appendFields(fields, record.members, symbol.qualifiedName, "own");
    // A derived record inherits its bases' reservations: the flattened record is
    // what gets encoded, so a base's retired ordinal is spent here too.
    const reserved = collectModelReserved(symbol, baseChain, diagnostics);
    validateOrdinals(fields, symbol, reserved, diagnostics);
    fields.sort((a, b) => a.ordinal - b.ordinal);
    return {
        symbol,
        baseChain,
        fields,
        isGeneric: record.typeParams.length > 0,
        decorators: record.decorators,
    };
}
function resolveBaseChain(symbol, byLocal, byQualified, diagnostics) {
    const chain = [];
    const visited = new Set([symbol.qualifiedName]);
    let current = symbol;
    while (true) {
        const base = current.decl.extends;
        if (base === null)
            break;
        const baseSymbol = resolveName(base, byLocal, byQualified);
        if (baseSymbol === null) {
            diagnostics.error("OS1005", `Undefined base record '${base.join(".")}'`, current.span);
            break;
        }
        if (baseSymbol.kind !== "model") {
            diagnostics.error("OS1005", `Base '${base.join(".")}' is not a record`, current.span);
            break;
        }
        if (visited.has(baseSymbol.qualifiedName)) {
            diagnostics.error("OS1004", `Cyclic extends involving '${baseSymbol.qualifiedName}'`, current.span);
            break;
        }
        visited.add(baseSymbol.qualifiedName);
        chain.push(baseSymbol);
        current = baseSymbol;
    }
    return chain;
}
function appendFields(into, members, declaredIn, origin) {
    for (const field of members) {
        into.push({
            ordinal: field.ordinal ?? -1,
            name: field.name,
            type: field.type,
            isPrivate: field.private,
            doc: field.doc,
            decorators: field.decorators,
            origin,
            declaredIn,
            span: field.span,
        });
    }
}
/** Own reservations plus every base record's, merged into one set. */
function collectModelReserved(symbol, baseChain, diagnostics) {
    const decls = [...symbol.decl.reserved];
    for (const base of baseChain) {
        decls.push(...base.decl.reserved);
    }
    if (decls.length === 0)
        return EMPTY_RESERVED;
    const { set, diagnostics: issues } = expandReserved(decls, `record '${symbol.localName}'`);
    diagnostics.addAll(issues);
    return set;
}
function validateOrdinals(fields, symbol, reserved, diagnostics) {
    const seen = new Set();
    for (const field of fields) {
        if (field.ordinal < 0) {
            diagnostics.error("OS2006", `Field '${field.name}' in '${symbol.localName}' is missing an ordinal`, field.span);
            continue;
        }
        if (seen.has(field.ordinal)) {
            diagnostics.error("OS2001", `Duplicate ordinal ${field.ordinal} in '${symbol.localName}'`, field.span);
            continue;
        }
        reportReservedClash(field.ordinal, field.name, reserved, `record '${symbol.localName}'`, field.span, diagnostics);
        seen.add(field.ordinal);
    }
}
/** OS2005: a declared ordinal (or name) that the same space has reserved. */
function reportReservedClash(ordinal, name, reserved, scopeLabel, span, diagnostics) {
    if (reserved.has(ordinal)) {
        diagnostics.error("OS2005", `Ordinal ${ordinal} is reserved in ${scopeLabel} and cannot be used by '${name}'`, span);
        return;
    }
    if (reserved.hasName(name)) {
        diagnostics.error("OS2005", `Name '${name}' is reserved in ${scopeLabel}`, span);
    }
}
// ── Enum and oneof tag spaces (Pass 4b) ───────────────────────────────────────
//
// Both are wire tag spaces for the binary codec: an enum variant's ordinal IS
// its encoded value, and a oneof variant's ordinal is its inner tag. Neither was
// validated before, so a duplicate silently produced an ambiguous encoding that
// decodes to a wrong-but-valid value without throwing.
//
// Walks raw declarations rather than ResolvedField.type, which pass 6 reassigns
// to the alias-inlined form.
function validateTagSpaces(modules, diagnostics) {
    for (const module of modules) {
        for (const decl of module.program.declarations) {
            validateDeclTagSpaces(decl, diagnostics);
        }
    }
}
function validateDeclTagSpaces(decl, diagnostics) {
    if (decl.kind === "enum") {
        validateEnumOrdinals(decl, diagnostics);
        return;
    }
    if (decl.kind === "model") {
        for (const member of decl.members) {
            walkOneofs(member.type, `field '${member.name}' in '${decl.name}'`, diagnostics);
        }
        return;
    }
    if (decl.kind === "overlay") {
        for (const field of decl.fields) {
            walkOneofs(field.type, `overlay '${decl.company}' field '${field.name}'`, diagnostics);
        }
        return;
    }
    if (decl.kind === "type_alias") {
        walkOneofs(decl.type, `type alias '${decl.name}'`, diagnostics);
    }
}
function validateEnumOrdinals(decl, diagnostics) {
    const scopeLabel = `enum '${decl.name}'`;
    const { set, diagnostics: issues } = expandReserved(decl.reserved, scopeLabel);
    diagnostics.addAll(issues);
    const seen = new Set();
    for (const variant of decl.variants) {
        if (seen.has(variant.ordinal)) {
            diagnostics.error("OS2003", `Duplicate ordinal ${variant.ordinal} in ${scopeLabel}`, variant.span);
            continue;
        }
        reportReservedClash(variant.ordinal, variant.name, set, scopeLabel, variant.span, diagnostics);
        seen.add(variant.ordinal);
    }
}
function walkOneofs(type, scopeLabel, diagnostics) {
    switch (type.kind) {
        case "oneof":
            validateOneofOrdinals(type, scopeLabel, diagnostics);
            for (const variant of type.variants)
                walkOneofs(variant.type, scopeLabel, diagnostics);
            return;
        case "array":
            walkOneofs(type.element, scopeLabel, diagnostics);
            return;
        case "nullable":
            walkOneofs(type.inner, scopeLabel, diagnostics);
            return;
        case "map":
            walkOneofs(type.key, scopeLabel, diagnostics);
            walkOneofs(type.value, scopeLabel, diagnostics);
            return;
        case "union":
            for (const variant of type.variants)
                walkOneofs(variant, scopeLabel, diagnostics);
            return;
        case "named":
            for (const arg of type.typeArgs)
                walkOneofs(arg, scopeLabel, diagnostics);
            return;
        case "scalar":
        case "decimal":
            return;
    }
}
function validateOneofOrdinals(type, scopeLabel, diagnostics) {
    const seen = new Set();
    for (const variant of type.variants) {
        if (seen.has(variant.ordinal)) {
            diagnostics.error("OS2004", `Duplicate ordinal ${variant.ordinal} in oneof at ${scopeLabel}`, variant.span);
            continue;
        }
        seen.add(variant.ordinal);
    }
}
// ── Overlays ──────────────────────────────────────────────────────────────────
function mergeOverlays(overlays, program, byLocal, byQualified, records, diagnostics) {
    for (const decl of program.declarations) {
        if (decl.kind !== "overlay")
            continue;
        const resolved = resolveOverlay(decl, byLocal, byQualified, records, diagnostics);
        if (resolved === null)
            continue;
        const byCompany = overlays.get(resolved.baseName) ?? new Map();
        if (byCompany.has(resolved.company)) {
            diagnostics.error("OS3004", `Duplicate overlay for company '${resolved.company}' on '${resolved.baseName}'`, decl.span);
            continue;
        }
        byCompany.set(resolved.company, resolved);
        overlays.set(resolved.baseName, byCompany);
    }
}
function resolveOverlay(decl, byLocal, byQualified, records, diagnostics) {
    const baseSymbol = resolveName(decl.base, byLocal, byQualified);
    if (baseSymbol === null) {
        diagnostics.error("OS3001", `Overlay base '${decl.base.join(".")}' is undefined`, decl.span);
        return null;
    }
    if (baseSymbol.kind !== "model") {
        diagnostics.error("OS3002", `Overlay base '${decl.base.join(".")}' is not a record`, decl.span);
        return null;
    }
    const fields = [];
    appendFields(fields, decl.fields, `${baseSymbol.qualifiedName}@${decl.company}`, "own");
    validateOverlayOrdinals(fields, decl, diagnostics);
    validateOverlayReserved(fields, decl, diagnostics);
    checkOverlayNameClashes(fields, baseSymbol.qualifiedName, records, decl, diagnostics);
    fields.sort((a, b) => a.ordinal - b.ordinal);
    return { company: decl.company, baseName: baseSymbol.qualifiedName, fields, reserved: decl.reserved };
}
function validateOverlayOrdinals(fields, decl, diagnostics) {
    const seen = new Set();
    for (const field of fields) {
        if (field.ordinal < 0) {
            diagnostics.error("OS2006", `Overlay field '${field.name}' (company '${decl.company}') is missing an ordinal`, field.span);
            continue;
        }
        if (seen.has(field.ordinal)) {
            diagnostics.error("OS2002", `Duplicate ordinal ${field.ordinal} in overlay '${decl.company}' on '${decl.base.join(".")}'`, field.span);
            continue;
        }
        seen.add(field.ordinal);
    }
}
/** Overlay ordinals live in their own space, so their reservations do too. */
function validateOverlayReserved(fields, decl, diagnostics) {
    if (decl.reserved.length === 0)
        return;
    const scopeLabel = `overlay '${decl.company}' on '${decl.base.join(".")}'`;
    const { set, diagnostics: issues } = expandReserved(decl.reserved, scopeLabel);
    diagnostics.addAll(issues);
    for (const field of fields) {
        if (field.ordinal < 0)
            continue;
        reportReservedClash(field.ordinal, field.name, set, scopeLabel, field.span, diagnostics);
    }
}
function checkOverlayNameClashes(fields, baseName, records, decl, diagnostics) {
    const base = records.get(baseName);
    if (base === undefined)
        return;
    const baseNames = new Set(base.fields.map(f => f.name));
    for (const field of fields) {
        if (!baseNames.has(field.name))
            continue;
        diagnostics.error("OS3003", `Overlay field '${field.name}' clashes with a base field on '${decl.base.join(".")}'`, field.span);
    }
}
// ── Alias normalization & lints (Pass 6) ──────────────────────────────────────
/**
 * Inline every non-union alias reference in field and operation types (with
 * generic substitution), and stamp array-length decorators onto each field's
 * outermost array. Field types are reassigned on the ResolvedField to a fresh
 * TypeExpr — the underlying AST node is never mutated, so the differ/LSP/MCP keep
 * seeing the original source types. Operations are returned as shallow clones
 * with rewritten param/return types for the same reason.
 */
function normalizeAliases(schema, diagnostics) {
    for (const model of schema.records.values()) {
        for (const field of model.fields) {
            const inlined = inlineType(field.type, schema, diagnostics, new Set());
            field.type = applyArrayLengthDecorators(inlined, field.decorators, field.name, field.span, diagnostics);
        }
    }
    return schema.operations.map(op => ({
        ...op,
        params: op.params.map(param => ({
            ...param,
            type: inlineType(param.type, schema, diagnostics, new Set()),
        })),
        returnType: inlineType(op.returnType, schema, diagnostics, new Set()),
    }));
}
/** Deep-rewrite a type, expanding non-union alias references. Builds new nodes;
 * the no-change path returns the input node untouched. Cycle-guarded; emits
 * OS1009 (arity) and OS1010 (cycle). */
function inlineType(type, schema, diagnostics, seen) {
    switch (type.kind) {
        case "named": {
            const name = type.path[type.path.length - 1];
            const alias = aliasByLocalName(name, schema);
            // Not an alias, or a union alias (stays named): only recurse into type args.
            if (alias === null || alias.type.kind === "union") {
                if (type.typeArgs.length === 0)
                    return type;
                return { ...type, typeArgs: type.typeArgs.map(arg => inlineType(arg, schema, diagnostics, seen)) };
            }
            if (seen.has(name)) {
                diagnostics.error("OS1010", `Cyclic type alias '${name}'`, type.span);
                return type;
            }
            if (alias.typeParams.length !== type.typeArgs.length) {
                diagnostics.error("OS1009", `Type alias '${name}' expects ${alias.typeParams.length} type argument(s), got ${type.typeArgs.length}`, type.span);
                return type;
            }
            const args = type.typeArgs.map(arg => inlineType(arg, schema, diagnostics, seen));
            const body = alias.typeParams.length > 0
                ? substituteTypeParams(alias.type, alias.typeParams.map(p => p.name), args)
                : alias.type;
            const nextSeen = new Set(seen);
            nextSeen.add(name);
            return inlineType(body, schema, diagnostics, nextSeen);
        }
        case "array": return { ...type, element: inlineType(type.element, schema, diagnostics, seen) };
        case "map": return { ...type, key: inlineType(type.key, schema, diagnostics, seen), value: inlineType(type.value, schema, diagnostics, seen) };
        case "nullable": return { ...type, inner: inlineType(type.inner, schema, diagnostics, seen) };
        case "union": return { ...type, variants: type.variants.map(v => inlineType(v, schema, diagnostics, seen)) };
        case "oneof": return { ...type, variants: type.variants.map(v => ({ ...v, type: inlineType(v.type, schema, diagnostics, seen) })) };
        default: return type;
    }
}
/** Stamp @minItems/@maxItems/@length bounds onto the field's outermost array. A
 * type-level bound (`[T; 2..3]`) already present wins over a conflicting
 * decorator. */
function applyArrayLengthDecorators(type, decorators, fieldName, span, diagnostics) {
    const exact = numericDecorator(decorators, "length");
    const min = exact !== null ? exact : numericDecorator(decorators, "minItems");
    const max = exact !== null ? exact : numericDecorator(decorators, "maxItems");
    if (min === null && max === null)
        return type;
    if (type.kind !== "array") {
        diagnostics.warning("OS1013", `@minItems/@maxItems/@length on non-array field '${fieldName}' is ignored`, span);
        return type;
    }
    const next = { ...type };
    if (min !== null)
        stampBound(next, "minItems", min, fieldName, span, diagnostics);
    if (max !== null)
        stampBound(next, "maxItems", max, fieldName, span, diagnostics);
    return next;
}
function stampBound(array, key, value, fieldName, span, diagnostics) {
    if (array[key] !== undefined && array[key] !== value) {
        diagnostics.warning("OS1014", `@${key} conflicts with the type-level bound on '${fieldName}'; the type-level bound wins`, span);
        return;
    }
    array[key] = value;
}
function numericDecorator(decorators, name) {
    const decorator = findDecorator(decorators, name);
    if (decorator === null || decorator.args.length === 0)
        return null;
    const value = decorator.args[0].value;
    if (value.kind === "number")
        return value.value;
    return null;
}
/** Enforce the cross-target contract for NAMED union aliases: every member must
 * be an object model (OS1011), and a union may not appear in operation input
 * position (OS1012). Inline anonymous unions are unaffected and still degrade to
 * the JSON scalar per target. */
function lintUnionAliases(schema, diagnostics) {
    for (const { name, alias } of unionAliases(schema)) {
        if (alias.type.kind !== "union")
            continue;
        for (const variant of alias.type.variants) {
            const resolved = resolveAliasInline(variant, schema);
            if (!isObjectModelRef(resolved, schema)) {
                diagnostics.error("OS1011", `Union alias '${name}' has a non-object member; named unions must union object models`, variant.span);
            }
        }
    }
    for (const op of schema.operations) {
        for (const param of op.params) {
            if (referencesUnionAlias(param.type, schema)) {
                diagnostics.error("OS1012", `A union type cannot be used as an operation input (parameter '${param.name}' of '${op.name}')`, param.span);
            }
        }
    }
}
/** A @link field stores the target model's primary-key id, so the target must be
 * a model with exactly one @primaryKey field — otherwise the id type is undefined.
 * OS1015: not a model reference. OS1016: zero or composite primary key. */
function lintLinks(schema, diagnostics) {
    for (const record of schema.records.values()) {
        for (const field of record.fields) {
            if (!hasDecorator(field.decorators, "link"))
                continue;
            lintLinkField(field, schema, diagnostics);
        }
    }
}
function lintLinkField(field, schema, diagnostics) {
    const named = unwrapToNamed(field.type);
    const target = named === null ? null : modelByLocalName(named.path[named.path.length - 1], schema);
    if (target === null) {
        diagnostics.error("OS1015", `@link field '${field.name}' must reference a model`, field.span);
        return;
    }
    const primaryKeys = target.fields.filter(f => hasDecorator(f.decorators, "primaryKey"));
    if (primaryKeys.length === 0) {
        diagnostics.error("OS1016", `@link target '${target.symbol.localName}' has no @primaryKey; the link id type is undefined`, field.span);
        return;
    }
    if (primaryKeys.length > 1) {
        diagnostics.error("OS1016", `@link target '${target.symbol.localName}' has a composite primary key; a scalar link needs exactly one @primaryKey`, field.span);
    }
}
/** Peel nullable/array wrappers to the underlying named type, or null. */
function unwrapToNamed(type) {
    if (type.kind === "named")
        return type;
    if (type.kind === "nullable")
        return unwrapToNamed(type.inner);
    if (type.kind === "array")
        return unwrapToNamed(type.element);
    return null;
}
function isObjectModelRef(type, schema) {
    if (type.kind !== "named")
        return false;
    const local = type.path[type.path.length - 1];
    for (const model of schema.records.values()) {
        if (model.symbol.localName === local)
            return !isInputModel(model);
    }
    return false; // enum, scalar, or unknown — not an object member
}
function referencesUnionAlias(type, schema) {
    switch (type.kind) {
        case "named": {
            const alias = aliasByLocalName(type.path[type.path.length - 1], schema);
            if (alias !== null && alias.type.kind === "union")
                return true;
            return type.typeArgs.some(arg => referencesUnionAlias(arg, schema));
        }
        case "array": return referencesUnionAlias(type.element, schema);
        case "map": return referencesUnionAlias(type.key, schema) || referencesUnionAlias(type.value, schema);
        case "nullable": return referencesUnionAlias(type.inner, schema);
        case "oneof": return type.variants.some(v => referencesUnionAlias(v.type, schema));
        default: return false; // inline unions degrade to JSON, not flagged here
    }
}
//# sourceMappingURL=index.js.map