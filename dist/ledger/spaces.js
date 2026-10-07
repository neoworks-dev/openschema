// src/ledger/spaces.ts
// Extract every ordinal space a resolved schema declares. Pure — no I/O.
//
// A schema has four independent tag spaces:
//   model:<qualifiedName>              a record's own fields
//   overlay:<base>@<company>           an overlay's fields (its own space)
//   enum:<qualifiedName>               enum variant values
//   oneof:<model>:<fieldOrdinal>       a oneof's inner tags
//
// oneof spaces key off the declaring field's ORDINAL rather than its name, so a
// field rename does not churn the ledger.
import { expandReserved } from "../resolver/reserved.js";
import { describeType } from "../engine/type-compat.js";
import { encodingSignatureOf } from "../emit/codec/wireFormat.js";
import { firstStringArg } from "../emit/typeMapping.js";
export function modelSpaceId(qualifiedName) {
    return `model:${qualifiedName}`;
}
export function overlaySpaceId(base, company) {
    return `overlay:${base}@${company}`;
}
export function enumSpaceId(qualifiedName) {
    return `enum:${qualifiedName}`;
}
export function oneofSpaceId(owner, fieldOrdinal) {
    return `oneof:${owner}:${fieldOrdinal}`;
}
export function collectSpaces(schema) {
    const spaces = [];
    collectModelSpaces(schema, spaces);
    collectOverlaySpaces(schema, spaces);
    collectEnumSpaces(schema, spaces);
    collectOneofSpaces(schema, spaces);
    return spaces;
}
// ── Models ────────────────────────────────────────────────────────────────────
function collectModelSpaces(schema, into) {
    for (const record of schema.records.values()) {
        // Only own fields: inherited ones belong to the base's space, and are
        // reachable through inheritsFrom.
        const declared = record.fields
            .filter(field => field.origin === "own" && field.ordinal >= 0)
            .map(field => ({
            ordinal: field.ordinal,
            name: field.name,
            type: describeType(field.type),
            encoding: encodingSignatureOf(field.type, schema),
            facet: firstStringArg(field.decorators, "neoworks.facet"),
            span: field.span,
        }));
        into.push({
            id: modelSpaceId(record.symbol.qualifiedName),
            kind: "model",
            declared,
            reserved: reservedOrdinals(record.symbol.decl.reserved, record.symbol.localName),
            inheritsFrom: record.baseChain.map(base => modelSpaceId(base.qualifiedName)),
        });
    }
}
// ── Overlays ──────────────────────────────────────────────────────────────────
function collectOverlaySpaces(schema, into) {
    for (const [baseName, byCompany] of schema.overlays) {
        for (const [company, overlay] of byCompany) {
            const declared = overlay.fields
                .filter(field => field.ordinal >= 0)
                .map(field => ({
                ordinal: field.ordinal,
                name: field.name,
                type: describeType(field.type),
                encoding: encodingSignatureOf(field.type, schema),
                facet: null,
                span: field.span,
            }));
            into.push({
                id: overlaySpaceId(baseName, company),
                kind: "overlay",
                base: baseName,
                company,
                declared,
                reserved: reservedOrdinals(overlay.reserved, `overlay '${company}'`),
                inheritsFrom: [],
            });
        }
    }
}
// ── Enums ─────────────────────────────────────────────────────────────────────
function collectEnumSpaces(schema, into) {
    for (const symbol of schema.enums.values()) {
        const decl = symbol.decl;
        into.push({
            id: enumSpaceId(symbol.qualifiedName),
            kind: "enum",
            declared: decl.variants.map(variant => ({
                ordinal: variant.ordinal,
                name: variant.name,
                type: null,
                encoding: null,
                facet: null,
                span: variant.span,
            })),
            reserved: reservedOrdinals(decl.reserved, symbol.localName),
            inheritsFrom: [],
        });
    }
}
// ── Oneofs ────────────────────────────────────────────────────────────────────
//
// Walks the RAW declarations. ResolvedField.type is reassigned to the
// alias-inlined form during pass 6, which would key a oneof declared in a type
// alias under every field that consumes it.
function collectOneofSpaces(schema, into) {
    for (const symbol of schema.symbols.values()) {
        if (symbol.kind === "model") {
            collectOneofsInModel(symbol, into);
            continue;
        }
        if (symbol.kind === "type_alias") {
            walkOneofs(symbol.decl.type, `alias:${symbol.qualifiedName}`, 0, into);
        }
    }
}
function collectOneofsInModel(symbol, into) {
    for (const member of symbol.decl.members) {
        if (member.ordinal === null)
            continue;
        walkOneofs(member.type, symbol.qualifiedName, member.ordinal, into);
    }
}
function walkOneofs(type, owner, fieldOrdinal, into) {
    switch (type.kind) {
        case "oneof":
            into.push({
                id: oneofSpaceId(owner, fieldOrdinal),
                kind: "oneof",
                declared: type.variants.map(variant => ({
                    ordinal: variant.ordinal,
                    name: variant.name,
                    type: describeType(variant.type),
                    encoding: null,
                    facet: null,
                    span: variant.span,
                })),
                reserved: [],
                inheritsFrom: [],
            });
            for (const variant of type.variants)
                walkOneofs(variant.type, owner, fieldOrdinal, into);
            return;
        case "array":
            walkOneofs(type.element, owner, fieldOrdinal, into);
            return;
        case "nullable":
            walkOneofs(type.inner, owner, fieldOrdinal, into);
            return;
        case "map":
            walkOneofs(type.key, owner, fieldOrdinal, into);
            walkOneofs(type.value, owner, fieldOrdinal, into);
            return;
        case "union":
            for (const variant of type.variants)
                walkOneofs(variant, owner, fieldOrdinal, into);
            return;
        case "named":
            for (const arg of type.typeArgs)
                walkOneofs(arg, owner, fieldOrdinal, into);
            return;
        case "scalar":
        case "decimal":
            return;
    }
}
// ── Reserved ──────────────────────────────────────────────────────────────────
/**
 * Flatten source reservations to concrete ordinals so they can be stored.
 * Wide ranges are capped: a reservation like `1000..536870911` is a legitimate
 * way to fence off a region, but materialising it would be absurd. Ranges above
 * the cap stay enforced by the resolver's OS2005 check, which works on ranges.
 */
const MAX_MATERIALISED_RESERVED = 1024;
function reservedOrdinals(decls, scopeLabel) {
    if (decls.length === 0)
        return [];
    const { set } = expandReserved(decls, scopeLabel);
    const ordinals = [];
    for (const range of set.ranges) {
        if (range.to - range.from >= MAX_MATERIALISED_RESERVED)
            continue;
        for (let ordinal = range.from; ordinal <= range.to; ordinal++)
            ordinals.push(ordinal);
    }
    return ordinals;
}
//# sourceMappingURL=spaces.js.map