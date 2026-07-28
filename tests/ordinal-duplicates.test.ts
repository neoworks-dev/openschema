// tests/ordinal-duplicates.test.ts
//
// Enum variant ordinals and oneof variant ordinals are wire tag spaces for the
// binary codec: the enum variant's ordinal IS its encoded value, and a oneof
// variant's ordinal is its inner tag. Before OS2003/OS2004 neither was checked,
// so a duplicate resolved clean and produced an ambiguous encoding that decodes
// to a wrong-but-valid value without throwing.

import { describe, it, expect } from "bun:test";
import { parse, resolve } from "../src/index";

function codes(src: string): string[] {
  return resolve(parse(src)).diagnostics.map(d => d.code);
}

describe("enum variant ordinals (OS2003)", () => {
  it("rejects a duplicate variant ordinal", () => {
    expect(codes("namespace t\nenum S { 1 a  1 b }")).toEqual(["OS2003"]);
  });

  it("reports each duplicate once", () => {
    expect(codes("namespace t\nenum S { 1 a  1 b  2 c  2 d }")).toEqual(["OS2003", "OS2003"]);
  });

  it("accepts distinct, non-contiguous ordinals", () => {
    expect(codes("namespace t\nenum S { 1 a  7 b  3 c }")).toEqual([]);
  });
});

describe("oneof variant ordinals (OS2004)", () => {
  it("rejects a duplicate variant ordinal on a field", () => {
    expect(codes("namespace t\nmodel M { 1 p: oneof { 1 a: i32  1 b: string } }")).toEqual(["OS2004"]);
  });

  it("rejects a duplicate inside a type alias", () => {
    expect(codes("namespace t\ntype P = oneof { 2 a: i32  2 b: string }\nmodel M { 1 p: P }"))
      .toEqual(["OS2004"]);
  });

  it("reports a oneof declared in an alias exactly once, however many fields use it", () => {
    const src = "namespace t\ntype P = oneof { 2 a: i32  2 b: string }\nmodel M { 1 x: P  2 y: P }";
    expect(codes(src)).toEqual(["OS2004"]);
  });

  it("finds a oneof nested inside a nullable array", () => {
    expect(codes("namespace t\nmodel M { 1 p: [oneof { 3 a: i32  3 b: string }]? }")).toEqual(["OS2004"]);
  });

  it("finds a oneof nested inside a map value", () => {
    expect(codes("namespace t\nmodel M { 1 p: {string: oneof { 4 a: i32  4 b: string }} }"))
      .toEqual(["OS2004"]);
  });

  it("finds a oneof nested inside another oneof", () => {
    const src = "namespace t\nmodel M { 1 p: oneof { 1 a: i32  2 b: oneof { 5 c: i32  5 d: string } } }";
    expect(codes(src)).toEqual(["OS2004"]);
  });

  it("checks overlay field types too", () => {
    const src = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 p: oneof { 6 x: i32  6 y: string } }";
    expect(codes(src)).toEqual(["OS2004"]);
  });

  it("treats sibling oneofs as independent spaces", () => {
    expect(codes("namespace t\nmodel M { 1 p: oneof { 1 a: i32 }  2 q: oneof { 1 b: string } }"))
      .toEqual([]);
  });
});
