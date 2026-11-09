// src/emit/collection/pluralize.ts
// How the SDKs name the resource of a table: the TypeScript SDK's `pluralize`.
const CONSONANT_BEFORE_Y = /[bcdfghjklmnpqrstvwxz]y$/;
const SIBILANT_ENDING = /(s|x|z|ch|sh)$/;
/** The plural of the last word of a camel-cased name: `memory` is `memories`, `address` is `addresses`. */
export function pluralize(name) {
    if (CONSONANT_BEFORE_Y.test(name))
        return `${name.slice(0, -1)}ies`;
    if (SIBILANT_ENDING.test(name))
        return `${name}es`;
    return `${name}s`;
}
//# sourceMappingURL=pluralize.js.map