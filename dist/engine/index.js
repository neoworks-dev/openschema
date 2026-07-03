// src/engine/index.ts
// Public API for the OpenSchema diff engine.
export { Differ } from "./differ.js";
export { compareTypes, describeType } from "./type-compat.js";
import { Differ } from "./differ.js";
import { parse } from "../index.js";
/**
 * Diff two OpenSchema source strings and return a structured result.
 *
 * @param oldSource  The previously-published schema source.
 * @param newSource  The proposed new schema source.
 */
export function diff(oldSource, newSource) {
    const oldProg = parse(oldSource);
    const newProg = parse(newSource);
    return new Differ().diff(oldProg, newProg);
}
/**
 * Returns true if `newSource` is compatible with `oldSource` under `mode`.
 */
export function isCompatible(oldSource, newSource, mode) {
    return diff(oldSource, newSource).isCompatible(mode);
}
//# sourceMappingURL=index.js.map