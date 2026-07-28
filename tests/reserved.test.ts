// tests/reserved.test.ts
import { describe, it, expect } from "bun:test";
import { parse, resolve } from "../src/index";
import { ParseError } from "../src/parser/parser";
import { diff } from "../src/engine";
import type { ModelDecl, EnumDecl, OverlayDecl, NamespaceDecl } from "../src/parser/ast";

function codes(src: string): string[] {
  return resolve(parse(src)).diagnostics.map(d => d.code);
}

function model(src: string, name = "M"): ModelDecl {
  const decl = parse(src).declarations.find(d => d.kind === "model" && d.name === name);
  return decl as ModelDecl;
}

function parseError(src: string): string {
  try {
    parse(src);
  } catch (error) {
    if (error instanceof ParseError) return error.message;
    throw error;
  }
  throw new Error("expected a ParseError");
}

describe("reserved syntax", () => {
  it("parses a single ordinal", () => {
    const decl = model("namespace t\nmodel M { 1 id: uuid  reserved 7; }");
    expect(decl.reserved).toHaveLength(1);
    expect(decl.reserved[0].ranges.map(r => [r.from, r.to])).toEqual([[7, 7]]);
    expect(decl.reserved[0].ranges[0].span.line).toBe(2);
  });

  it("parses a mixed list of ordinals and ranges", () => {
    const decl = model("namespace t\nmodel M { 1 id: uuid  reserved 9..12, 20; }");
    const ranges = decl.reserved[0].ranges.map(r => [r.from, r.to]);
    expect(ranges).toEqual([[9, 12], [20, 20]]);
  });

  it("parses reserved names", () => {
    const decl = model('namespace t\nmodel M { 1 id: uuid  reserved "oldName", "other"; }');
    expect(decl.reserved[0].names).toEqual(["oldName", "other"]);
  });

  it("accumulates several reserved declarations in one body", () => {
    const decl = model("namespace t\nmodel M { 1 id: uuid  reserved 7;  reserved 9..12; }");
    expect(decl.reserved).toHaveLength(2);
  });

  it("parses reserved in an enum body", () => {
    const decl = parse("namespace t\nenum E { 1 a  reserved 5..6;  2 b }")
      .declarations.find(d => d.kind === "enum") as EnumDecl;
    expect(decl.reserved[0].ranges.map(r => [r.from, r.to])).toEqual([[5, 6]]);
    expect(decl.variants.map(v => v.name)).toEqual(["a", "b"]);
  });

  it("parses reserved in an overlay body", () => {
    const decl = parse("namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32  reserved 4; }")
      .declarations.find(d => d.kind === "overlay") as OverlayDecl;
    expect(decl.reserved[0].ranges.map(r => [r.from, r.to])).toEqual([[4, 4]]);
  });

  // `reserved` is deliberately NOT a lexer keyword: promoting it would break
  // every existing schema that has a field of that name.
  it("still allows a field named 'reserved'", () => {
    const decl = model("namespace t\nmodel M { 1 id: uuid  3 reserved: string }");
    expect(decl.members.map(f => f.name)).toEqual(["id", "reserved"]);
    expect(decl.reserved).toHaveLength(0);
  });

  it("keeps reserved out of the model's members", () => {
    const decl = model("namespace t\nmodel M { 1 id: uuid  reserved 7; }");
    expect(decl.members).toHaveLength(1);
  });

  it("does not surface as a change to the differ", () => {
    const OLD = "namespace t\nmodel M { 1 id: uuid }";
    const NEW = "namespace t\nmodel M { 1 id: uuid  reserved 7; }";
    expect(diff(OLD, NEW).changes).toHaveLength(0);
  });
});

describe("reserved syntax errors", () => {
  it("rejects an inverted range", () => {
    expect(parseError("namespace t\nmodel M { 1 a: i32  reserved 12..9; }"))
      .toContain("Reserved range is inverted: 12..9");
  });

  it("rejects the dash form with a pointer to '..'", () => {
    expect(parseError("namespace t\nmodel M { 1 a: i32  reserved 9-12; }"))
      .toContain("'..'");
  });

  it("requires a terminating semicolon", () => {
    expect(parseError("namespace t\nmodel M { 1 a: i32  reserved 7 }"))
      .toContain("';'");
  });
});

describe("namespace directives", () => {
  it("accepts a directive on namespace", () => {
    const decl = parse("#requireLedger\nnamespace t").declarations[0] as NamespaceDecl;
    expect(decl.directives.map(d => d.name)).toEqual(["requireLedger"]);
  });

  it("still rejects a decorator on namespace", () => {
    expect(parseError('@table("x")\nnamespace t')).toContain("Decorators are not allowed");
  });
});

describe("reserved validation (OS2005 / OS2012)", () => {
  it("rejects a field claiming a reserved ordinal", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  7 x: i32  reserved 7; }")).toEqual(["OS2005"]);
  });

  it("rejects a field inside a reserved range", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  10 x: i32  reserved 9..12; }")).toEqual(["OS2005"]);
  });

  it("rejects a field reusing a reserved name", () => {
    expect(codes('namespace t\nmodel M { 1 legacy: i32  reserved "legacy"; }')).toEqual(["OS2005"]);
  });

  it("allows ordinals outside every reserved range", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  13 x: i32  reserved 9..12; }")).toEqual([]);
  });

  it("rejects ordinal 0", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  reserved 0; }")).toEqual(["OS2012"]);
  });

  it("rejects an ordinal above the wire maximum", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  reserved 536870912; }")).toEqual(["OS2012"]);
  });

  it("rejects overlapping ranges", () => {
    expect(codes("namespace t\nmodel M { 1 id: uuid  reserved 5..9, 8..11; }")).toEqual(["OS2012"]);
  });

  it("applies to enum variants", () => {
    expect(codes("namespace t\nenum S { 1 a  3 c  reserved 3; }")).toEqual(["OS2005"]);
  });
});

describe("reserved ordinal spaces", () => {
  // The flattened record is what gets encoded, so a base's reservation is spent
  // in every derived record too.
  it("inherits a base record's reservations", () => {
    expect(codes("namespace t\nmodel B { 1 a: i32  reserved 5; }\nmodel D extends B { 5 x: i32 }"))
      .toEqual(["OS2005"]);
  });

  it("does not leak a derived record's reservations back to its base", () => {
    expect(codes("namespace t\nmodel B { 1 a: i32  5 b: i32 }\nmodel D extends B { reserved 9; }"))
      .toEqual([]);
  });

  // Overlay ordinals are scoped to the (company, base) pair.
  it("keeps overlay reservations out of the base record's space", () => {
    expect(codes("namespace t\nmodel M { 1 a: i32  3 c: i32 }\noverlay acme on t.M { 1 x: i32  reserved 3; }"))
      .toEqual([]);
  });

  it("keeps base reservations out of the overlay's space", () => {
    expect(codes("namespace t\nmodel M { 1 a: i32  reserved 7; }\noverlay acme on t.M { 7 x: i32 }"))
      .toEqual([]);
  });

  it("rejects an overlay field on the overlay's own reserved ordinal", () => {
    expect(codes("namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 4 x: i32  reserved 4; }"))
      .toEqual(["OS2005"]);
  });
});
