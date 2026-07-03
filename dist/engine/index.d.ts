export { Differ } from "./differ.js";
export { compareTypes, describeType } from "./type-compat.js";
export type { Change, ChangeKind, Severity, DiffResult } from "./types.js";
import type { DiffResult } from "./types.js";
import type { CompatMode } from "../parser/ast.js";
/**
 * Diff two OpenSchema source strings and return a structured result.
 *
 * @param oldSource  The previously-published schema source.
 * @param newSource  The proposed new schema source.
 */
export declare function diff(oldSource: string, newSource: string): DiffResult;
/**
 * Returns true if `newSource` is compatible with `oldSource` under `mode`.
 */
export declare function isCompatible(oldSource: string, newSource: string, mode: CompatMode): boolean;
//# sourceMappingURL=index.d.ts.map