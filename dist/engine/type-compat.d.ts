import type { TypeExpr } from "../parser/ast.js";
export type TypeRelation = "same" | "widened" | "narrowed" | "incompatible";
/**
 * Returns the relation between `oldType` and `newType` from the perspective
 * of stored data and existing application code.
 *
 *   "widened"      → safe: new type accepts everything the old one did
 *   "narrowed"     → breaking_writer: old data or writes may exceed new type
 *   "incompatible" → breaking_both: types are unrelated
 *   "same"         → no change
 */
export declare function compareTypes(oldType: TypeExpr, newType: TypeExpr): TypeRelation;
/**
 * Produces a canonical string description of a type — used for set operations.
 * A reference is its scalar (`uuid`) unless `showReferences` asks for `ref<A>`:
 * the ordinal ledger records this text, so its default must not change.
 */
export declare function describeType(t: TypeExpr, showReferences?: boolean): string;
//# sourceMappingURL=type-compat.d.ts.map