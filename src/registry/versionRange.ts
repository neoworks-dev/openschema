// src/registry/versionRange.ts
// Version requirements with Cargo's meaning: a bare "1.2" is "^1.2", and
// comparators joined by commas must all hold (">=1.2, <1.5"). Each comparator
// is a half-open interval of versions; a requirement is their intersection.

export type Version = [number, number, number];

/** Versions from `lowest` (inclusive) up to `below` (exclusive); null is unbounded. */
export interface VersionRange {
  lowest: Version | null;
  below: Version | null;
}

interface PartialVersion {
  major: number;
  minor: number | null;
  patch: number | null;
}

type Operator = "^" | "~" | "=" | ">" | ">=" | "<" | "<=";

const COMPARATOR = /^(\^|~|=|>=|>|<=|<)?\s*([0-9.*]+)$/;
const VERSION_PART = /^(0|[1-9]\d*)$/;
const UNBOUNDED: VersionRange = { lowest: null, below: null };

/** The range a requirement allows, or null when it is not one. */
export function parseVersionRange(text: string): VersionRange | null {
  let range = UNBOUNDED;
  for (const comparatorText of text.split(",")) {
    const comparator = parseComparator(comparatorText.trim());
    if (comparator === null) return null;
    range = intersect(range, comparator);
  }
  return range;
}

export function rangeIncludes(range: VersionRange, version: Version): boolean {
  if (range.lowest !== null && compareVersions(version, range.lowest) < 0) return false;
  if (range.below !== null && compareVersions(version, range.below) >= 0) return false;
  return true;
}

export function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseComparator(text: string): VersionRange | null {
  if (text === "*") return UNBOUNDED;
  const match = COMPARATOR.exec(text);
  if (match === null) return null;
  const operator = match[1] as Operator | undefined;
  const versionText = match[2];

  if (versionText.endsWith(".*")) {
    if (operator !== undefined) return null;
    const partial = parsePartialVersion(versionText.slice(0, -2));
    if (partial === null || partial.patch !== null) return null;
    return operatorRange("=", partial);
  }
  const partial = parsePartialVersion(versionText);
  if (partial === null) return null;
  if (operator === undefined) return operatorRange("^", partial);
  return operatorRange(operator, partial);
}

function parsePartialVersion(text: string): PartialVersion | null {
  const parts = text.split(".");
  if (parts.length > 3) return null;
  if (!parts.every(part => VERSION_PART.test(part))) return null;
  const numbers = parts.map(Number);
  return { major: numbers[0], minor: partAt(numbers, 1), patch: partAt(numbers, 2) };
}

function partAt(numbers: number[], index: number): number | null {
  if (index >= numbers.length) return null;
  return numbers[index];
}

function operatorRange(operator: Operator, partial: PartialVersion): VersionRange {
  switch (operator) {
    case "^":  return { lowest: filled(partial), below: caretLimit(partial) };
    case "~":  return { lowest: filled(partial), below: tildeLimit(partial) };
    case "=":  return { lowest: filled(partial), below: nextAfter(partial) };
    case ">":  return { lowest: nextAfter(partial), below: null };
    case ">=": return { lowest: filled(partial), below: null };
    case "<":  return { lowest: null, below: filled(partial) };
    case "<=": return { lowest: null, below: nextAfter(partial) };
  }
}

function filled(partial: PartialVersion): Version {
  return [partial.major, zeroWhenMissing(partial.minor), zeroWhenMissing(partial.patch)];
}

function zeroWhenMissing(part: number | null): number {
  if (part === null) return 0;
  return part;
}

/** The first version past every version the partial one stands for: 1.2 → 1.3.0. */
function nextAfter(partial: PartialVersion): Version {
  if (partial.minor === null) return [partial.major + 1, 0, 0];
  if (partial.patch === null) return [partial.major, partial.minor + 1, 0];
  return [partial.major, partial.minor, partial.patch + 1];
}

/** Caret keeps the leftmost non-zero part: ^1.2.3 < 2.0.0, ^0.2.3 < 0.3.0, ^0.0.3 < 0.0.4. */
function caretLimit(partial: PartialVersion): Version {
  if (partial.major > 0 || partial.minor === null) return [partial.major + 1, 0, 0];
  if (partial.minor > 0 || partial.patch === null) return [0, partial.minor + 1, 0];
  return [0, 0, partial.patch + 1];
}

function tildeLimit(partial: PartialVersion): Version {
  if (partial.minor === null) return [partial.major + 1, 0, 0];
  return [partial.major, partial.minor + 1, 0];
}

function intersect(left: VersionRange, right: VersionRange): VersionRange {
  return { lowest: higherLowest(left.lowest, right.lowest), below: lowerBelow(left.below, right.below) };
}

function higherLowest(left: Version | null, right: Version | null): Version | null {
  if (left === null) return right;
  if (right === null) return left;
  if (compareVersions(left, right) >= 0) return left;
  return right;
}

function lowerBelow(left: Version | null, right: Version | null): Version | null {
  if (left === null) return right;
  if (right === null) return left;
  if (compareVersions(left, right) <= 0) return left;
  return right;
}
