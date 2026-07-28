// src/resolver/reserved.ts
// Expansion and validation of `reserved 7, 9..12;` declarations.
//
// Ranges are kept as ranges rather than expanded into a Set, so that a wide
// reservation (`reserved 1000..536870911;`) costs nothing to represent.
import { MAX_ORDINAL } from "../emit/codec/wireFormat.js";
export { MAX_ORDINAL };
export const EMPTY_RESERVED = makeSet([], new Set());
/**
 * Collect every `reserved` declaration in one ordinal space into a single set,
 * reporting malformed or overlapping reservations as OS2012.
 *
 * `scopeLabel` appears in diagnostics, e.g. "record 'Order'".
 */
export function expandReserved(decls, scopeLabel) {
    const diagnostics = [];
    const names = new Set();
    const ranges = [];
    for (const decl of decls) {
        for (const name of decl.names)
            names.add(name);
        for (const range of decl.ranges) {
            const problem = rangeProblem(range);
            if (problem !== null) {
                diagnostics.push(error(`Invalid reserved ${describe(range)} in ${scopeLabel}: ${problem}`, range));
                continue;
            }
            ranges.push(range);
        }
    }
    ranges.sort((a, b) => a.from - b.from);
    reportOverlaps(ranges, scopeLabel, diagnostics);
    return { set: makeSet(ranges, names), diagnostics };
}
function rangeProblem(range) {
    if (range.from < 1)
        return "ordinals start at 1";
    if (range.to > MAX_ORDINAL)
        return `ordinals may not exceed ${MAX_ORDINAL}`;
    return null;
}
function reportOverlaps(sorted, scopeLabel, diagnostics) {
    for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (current.from > previous.to)
            continue;
        diagnostics.push(error(`Overlapping reserved ranges in ${scopeLabel}: ${describe(previous)} and ${describe(current)}`, current));
    }
}
function makeSet(ranges, names) {
    return {
        ranges,
        names,
        has(ordinal) {
            return ranges.some(range => ordinal >= range.from && ordinal <= range.to);
        },
        hasName(name) {
            return names.has(name);
        },
    };
}
function describe(range) {
    if (range.from === range.to)
        return `ordinal ${range.from}`;
    return `range ${range.from}..${range.to}`;
}
function error(message, range) {
    return { code: "OS2012", severity: "error", message, span: range.span };
}
//# sourceMappingURL=reserved.js.map