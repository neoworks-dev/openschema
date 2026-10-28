// tests/version-range.test.ts
import { describe, it, expect } from "bun:test";
import { parseVersionRange, rangeIncludes, type Version } from "../src/registry/versionRange";

function version(text: string): Version {
  return text.split(".").map(Number) as Version;
}

function allows(requirement: string, versionText: string): boolean {
  const range = parseVersionRange(requirement);
  if (range === null) throw new Error(`not a range: ${requirement}`);
  return rangeIncludes(range, version(versionText));
}

// [requirement, versions it allows, versions it refuses], as Cargo documents them.
const CASES: [string, string[], string[]][] = [
  ["1.2.3",   ["1.2.3", "1.9.0"],  ["1.2.2", "2.0.0"]],
  ["^1.2",    ["1.2.0", "1.99.0"], ["1.1.9", "2.0.0"]],
  ["^1",      ["1.0.0", "1.9.9"],  ["0.9.9", "2.0.0"]],
  ["^0.2.3",  ["0.2.3", "0.2.9"],  ["0.2.2", "0.3.0"]],
  ["^0.0.3",  ["0.0.3"],           ["0.0.2", "0.0.4"]],
  ["^0.0",    ["0.0.0", "0.0.9"],  ["0.1.0"]],
  ["^0",      ["0.0.0", "0.9.9"],  ["1.0.0"]],
  ["~1.2.3",  ["1.2.3", "1.2.9"],  ["1.2.2", "1.3.0"]],
  ["~1",      ["1.0.0", "1.9.9"],  ["2.0.0"]],
  ["=1.2.3",  ["1.2.3"],           ["1.2.4"]],
  ["=1.2",    ["1.2.0", "1.2.9"],  ["1.3.0"]],
  ["1.*",     ["1.0.0", "1.9.9"],  ["2.0.0"]],
  ["*",       ["0.0.0", "9.9.9"],  []],
  [">1.2",    ["1.3.0"],           ["1.2.9"]],
  ["<=1.2",   ["1.2.9"],           ["1.3.0"]],
  [">= 1.2, < 1.5", ["1.2.0", "1.4.9"], ["1.1.9", "1.5.0"]],
];

describe("parseVersionRange", () => {
  for (const [requirement, allowed, refused] of CASES) {
    it(`reads ${requirement} the way Cargo does`, () => {
      for (const versionText of allowed) expect(allows(requirement, versionText)).toBe(true);
      for (const versionText of refused) expect(allows(requirement, versionText)).toBe(false);
    });
  }

  it("refuses what is not a requirement", () => {
    for (const text of ["", "latest", "^1.x", "1.2.3.4", "01.2", ">1.*", "1.2.3-beta", "1.2,"]) {
      expect(parseVersionRange(text)).toBeNull();
    }
  });
});
