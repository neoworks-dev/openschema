// src/engine/index.ts
// Public API for the OpenSchema diff engine.

export { Differ }          from "./differ.js";
export { compareTypes,
         describeType }    from "./type-compat.js";
export type { Change, ChangeKind, Severity, DiffResult } from "./types.js";

import { Differ }   from "./differ.js";
import { parse }    from "../index.js";
import type { DiffResult } from "./types.js";
import type { CompatMode } from "../parser/ast.js";

/**
 * Diff two OpenSchema source strings and return a structured result.
 *
 * @param oldSource  The previously-published schema source.
 * @param newSource  The proposed new schema source.
 */
export function diff(oldSource: string, newSource: string): DiffResult {
  const oldProg = parse(oldSource);
  const newProg = parse(newSource);
  return new Differ().diff(oldProg, newProg);
}

/**
 * Returns true if `newSource` is compatible with `oldSource` under `mode`.
 */
export function isCompatible(
  oldSource: string,
  newSource: string,
  mode: CompatMode
): boolean {
  return diff(oldSource, newSource).isCompatible(mode);
}