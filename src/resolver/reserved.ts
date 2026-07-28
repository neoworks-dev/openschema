// src/resolver/reserved.ts
// Expansion and validation of `reserved 7, 9..12;` declarations.
//
// Ranges are kept as ranges rather than expanded into a Set, so that a wide
// reservation (`reserved 1000..536870911;`) costs nothing to represent.

import type { ReservedDecl, ReservedRange } from "../parser/ast.js";
import type { Diagnostic } from "./types.js";
import { MAX_ORDINAL } from "../emit/codec/wireFormat.js";

export { MAX_ORDINAL };

export interface ReservedSet {
  ranges: ReservedRange[];   // normalized, ascending, non-overlapping
  names:  Set<string>;
  has(ordinal: number): boolean;
  hasName(name: string): boolean;
}

export const EMPTY_RESERVED: ReservedSet = makeSet([], new Set());

/**
 * Collect every `reserved` declaration in one ordinal space into a single set,
 * reporting malformed or overlapping reservations as OS2012.
 *
 * `scopeLabel` appears in diagnostics, e.g. "record 'Order'".
 */
export function expandReserved(
  decls: ReservedDecl[],
  scopeLabel: string,
): { set: ReservedSet; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const names = new Set<string>();
  const ranges: ReservedRange[] = [];

  for (const decl of decls) {
    for (const name of decl.names) names.add(name);
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

function rangeProblem(range: ReservedRange): string | null {
  if (range.from < 1) return "ordinals start at 1";
  if (range.to > MAX_ORDINAL) return `ordinals may not exceed ${MAX_ORDINAL}`;
  return null;
}

function reportOverlaps(sorted: ReservedRange[], scopeLabel: string, diagnostics: Diagnostic[]): void {
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.from > previous.to) continue;
    diagnostics.push(error(
      `Overlapping reserved ranges in ${scopeLabel}: ${describe(previous)} and ${describe(current)}`,
      current,
    ));
  }
}

function makeSet(ranges: ReservedRange[], names: Set<string>): ReservedSet {
  return {
    ranges,
    names,
    has(ordinal: number): boolean {
      return ranges.some(range => ordinal >= range.from && ordinal <= range.to);
    },
    hasName(name: string): boolean {
      return names.has(name);
    },
  };
}

function describe(range: ReservedRange): string {
  if (range.from === range.to) return `ordinal ${range.from}`;
  return `range ${range.from}..${range.to}`;
}

function error(message: string, range: ReservedRange): Diagnostic {
  return { code: "OS2012", severity: "error", message, span: range.span };
}
