import type { ReservedDecl, ReservedRange } from "../parser/ast.js";
import type { Diagnostic } from "./types.js";
import { MAX_ORDINAL } from "../emit/codec/wireFormat.js";
export { MAX_ORDINAL };
export interface ReservedSet {
    ranges: ReservedRange[];
    names: Set<string>;
    has(ordinal: number): boolean;
    hasName(name: string): boolean;
}
export declare const EMPTY_RESERVED: ReservedSet;
/**
 * Collect every `reserved` declaration in one ordinal space into a single set,
 * reporting malformed or overlapping reservations as OS2012.
 *
 * `scopeLabel` appears in diagnostics, e.g. "record 'Order'".
 */
export declare function expandReserved(decls: ReservedDecl[], scopeLabel: string): {
    set: ReservedSet;
    diagnostics: Diagnostic[];
};
//# sourceMappingURL=reserved.d.ts.map