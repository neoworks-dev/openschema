// tests/parser.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { ParseError } from "../src/parser/parser";
import type {
  Program, ModelDecl, EnumDecl, TypeAlias, ImportDecl, NamespaceDecl,
  FieldDecl, ScalarTypeExpr, ArrayTypeExpr, MapTypeExpr, NullableTypeExpr,
  UnionTypeExpr, OneofTypeExpr, NamedTypeExpr, DecimalTypeExpr,
  BinaryExpr, CallExpr, LiteralExpr, IdentExpr,
} from "../src/parser/ast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function model(src: string): ModelDecl {
  const prog = parse(src);
  const decl = prog.declarations.find(d => d.kind === "model");
  if (!decl) throw new Error("No model declaration found");
  return decl as ModelDecl;
}

function fields(src: string): FieldDecl[] {
  return model(src).members;
}

function firstField(src: string): FieldDecl {
  const fs = fields(src);
  if (!fs.length) throw new Error("No fields");
  return fs[0];
}

function enumDecl(src: string): EnumDecl {
  const prog = parse(src);
  const decl = prog.declarations.find(d => d.kind === "enum");
  if (!decl) throw new Error("No enum declaration found");
  return decl as EnumDecl;
}

// ── Namespace ─────────────────────────────────────────────────────────────────

describe("namespace declaration", () => {
  it("parses a simple namespace", () => {
    const prog = parse("namespace myorg");
    const ns = prog.declarations[0] as NamespaceDecl;
    expect(ns.kind).toBe("namespace");
    expect(ns.path).toEqual(["myorg"]);
  });

  it("parses a dotted namespace", () => {
    const prog = parse("namespace myorg.ecommerce.v2");
    const ns = prog.declarations[0] as NamespaceDecl;
    expect(ns.path).toEqual(["myorg", "ecommerce", "v2"]);
  });
});

// ── Import ────────────────────────────────────────────────────────────────────

describe("import declaration", () => {
  it("parses a single import", () => {
    const prog = parse('import { Money } from "@myorg/common/v1"');
    const imp = prog.declarations[0] as ImportDecl;
    expect(imp.kind).toBe("import");
    expect(imp.names).toEqual(["Money"]);
    expect(imp.from).toBe("@myorg/common/v1");
  });

  it("parses multiple imports", () => {
    const prog = parse('import { A, B, C } from "pkg"');
    const imp = prog.declarations[0] as ImportDecl;
    expect(imp.names).toEqual(["A", "B", "C"]);
  });

  it("allows a trailing comma", () => {
    const prog = parse('import { A, B, } from "pkg"');
    const imp = prog.declarations[0] as ImportDecl;
    expect(imp.names).toEqual(["A", "B"]);
  });
});

// ── Type alias ────────────────────────────────────────────────────────────────

describe("type alias", () => {
  it("parses a simple alias", () => {
    const prog = parse("type Id = uuid");
    const alias = prog.declarations[0] as TypeAlias;
    expect(alias.kind).toBe("type_alias");
    expect(alias.name).toBe("Id");
    expect(alias.type.kind).toBe("scalar");
  });

  it("parses a union alias", () => {
    const prog = parse("type Identifier = uuid | string");
    const alias = prog.declarations[0] as TypeAlias;
    expect(alias.type.kind).toBe("union");
    const u = alias.type as UnionTypeExpr;
    expect(u.variants).toHaveLength(2);
  });
});

describe("array length bounds", () => {
  function arrayType(src: string): any {
    const prog = parse(src);
    return (prog.declarations[0] as any).members[0].type;
  }

  it("parses a fixed length [T; n]", () => {
    const t = arrayType("model R { 1 a: [f64; 3] }");
    expect(t).toMatchObject({ kind: "array", minItems: 3, maxItems: 3 });
  });

  it("parses a range [T; min..max]", () => {
    const t = arrayType("model R { 1 a: [f64; 2..3] }");
    expect(t).toMatchObject({ kind: "array", minItems: 2, maxItems: 3 });
  });

  it("parses open-ended ranges", () => {
    const lower = arrayType("model R { 1 a: [i32; 2..] }");
    expect(lower.minItems).toBe(2);
    expect(lower.maxItems).toBeUndefined();
    const upper = arrayType("model R { 1 a: [i32; ..5] }");
    expect(upper.minItems).toBeUndefined();
    expect(upper.maxItems).toBe(5);
  });

  it("rejects an inverted range", () => {
    expect(() => parse("model R { 1 a: [f64; 5..2] }")).toThrow();
  });
});

// ── Enum ──────────────────────────────────────────────────────────────────────

describe("enum declaration", () => {
  const SRC = `
    enum Status {
      1 pending
      2 active
      3 cancelled
    }
  `;

  it("parses the enum name", () => {
    expect(enumDecl(SRC).name).toBe("Status");
  });

  it("parses variant ordinals", () => {
    const ordinals = enumDecl(SRC).variants.map(v => v.ordinal);
    expect(ordinals).toEqual([1, 2, 3]);
  });

  it("parses variant names", () => {
    const names = enumDecl(SRC).variants.map(v => v.name);
    expect(names).toEqual(["pending", "active", "cancelled"]);
  });

  it("attaches span to each variant", () => {
    for (const v of enumDecl(SRC).variants) {
      expect(v.span.line).toBeGreaterThan(0);
    }
  });
});

// ── Record structure ──────────────────────────────────────────────────────────

describe("model declaration", () => {
  it("parses model name", () => {
    expect(model("model Foo {}").name).toBe("Foo");
  });

  it("has empty decorators by default", () => {
    expect(model("model Foo {}").decorators).toEqual([]);
  });

  it("parses a @compatibility decorator", () => {
    const r = model("@compatibility(backward) model Foo {}");
    expect(r.decorators[0].name).toBe("compatibility");
    expect(r.decorators[0].args[0].value).toMatchObject({ kind: "ident", value: "backward" });
  });

  it("parses all compatibility modes", () => {
    for (const mode of ["backward", "forward", "full", "none"] as const) {
      const r = model(`@compatibility(${mode}) model Foo {}`);
      expect(r.decorators[0].args[0].value).toMatchObject({ kind: "ident", value: mode });
    }
  });

  it("parses a @table decorator", () => {
    const r = model('@table("my_table") model Foo {}');
    expect(r.decorators[0].args[0].value).toMatchObject({ kind: "string", value: "my_table" });
  });

  it("parses both model decorators", () => {
    const r = model('@compatibility(full) @table("t") model Foo {}');
    expect(r.decorators.map(d => d.name)).toEqual(["compatibility", "table"]);
  });

  it("parses an empty model body", () => {
    expect(model("model Foo {}").members).toHaveLength(0);
  });
});

// ── Field declarations ────────────────────────────────────────────────────────

describe("field declarations", () => {
  it("parses ordinal", () => {
    expect(firstField("model R { 42 x: i32 }").ordinal).toBe(42);
  });

  it("parses name", () => {
    expect(firstField("model R { 1 my_field: i32 }").name).toBe("my_field");
  });

  it("parses type", () => {
    const f = firstField("model R { 1 x: i64 }");
    expect(f.type.kind).toBe("scalar");
    expect((f.type as ScalarTypeExpr).scalar).toBe("i64");
  });

  it("has empty decorators by default", () => {
    expect(firstField("model R { 1 x: string }").decorators).toEqual([]);
  });

  it("parses multiple fields in order", () => {
    const fs = fields("model R { 1 a: i32  2 b: string  3 c: bool }");
    expect(fs.map(f => f.name)).toEqual(["a", "b", "c"]);
  });
});

// ── Scalar types ──────────────────────────────────────────────────────────────

describe("scalar types", () => {
  const scalars = [
    "bool","i8","i16","i32","i64","u8","u16","u32","u64",
    "f32","f64","string","bytes","uuid","date","time","timestamp","duration",
  ] as const;

  for (const s of scalars) {
    it(`parses scalar '${s}'`, () => {
      const f = firstField(`model R { 1 x: ${s} }`);
      expect(f.type.kind).toBe("scalar");
      expect((f.type as ScalarTypeExpr).scalar).toBe(s);
    });
  }

  it("parses decimal(p, s)", () => {
    const f = firstField("model R { 1 x: decimal(10, 2) }");
    expect(f.type.kind).toBe("decimal");
    const d = f.type as DecimalTypeExpr;
    expect(d.precision).toBe(10);
    expect(d.scale).toBe(2);
  });
});

// ── Compound types ────────────────────────────────────────────────────────────

describe("compound types", () => {
  it("parses array type", () => {
    const f = firstField("model R { 1 x: [string] }");
    expect(f.type.kind).toBe("array");
    const a = f.type as ArrayTypeExpr;
    expect(a.element.kind).toBe("scalar");
  });

  it("parses map type", () => {
    const f = firstField("model R { 1 x: {string: i64} }");
    expect(f.type.kind).toBe("map");
    const m = f.type as MapTypeExpr;
    expect((m.key as ScalarTypeExpr).scalar).toBe("string");
    expect((m.value as ScalarTypeExpr).scalar).toBe("i64");
  });

  it("parses nullable type", () => {
    const f = firstField("model R { 1 x: string? }");
    expect(f.type.kind).toBe("nullable");
    const n = f.type as NullableTypeExpr;
    expect((n.inner as ScalarTypeExpr).scalar).toBe("string");
  });

  it("parses nullable array", () => {
    const f = firstField("model R { 1 x: [i32]? }");
    expect(f.type.kind).toBe("nullable");
    expect((f.type as NullableTypeExpr).inner.kind).toBe("array");
  });

  it("parses union type", () => {
    const f = firstField("model R { 1 x: uuid | string | i64 }");
    expect(f.type.kind).toBe("union");
    const u = f.type as UnionTypeExpr;
    expect(u.variants).toHaveLength(3);
  });

  it("parses named type", () => {
    const f = firstField("model R { 1 x: User }");
    expect(f.type.kind).toBe("named");
    expect((f.type as NamedTypeExpr).path).toEqual(["User"]);
  });

  it("parses qualified named type", () => {
    const f = firstField("model R { 1 x: myorg.common.Address }");
    const n = f.type as NamedTypeExpr;
    expect(n.path).toEqual(["myorg", "common", "Address"]);
  });

  it("parses oneof type", () => {
    const src = `model R {
      1 payload: oneof {
        1 email: string
        2 sms:   string
      }
    }`;
    const f = firstField(src);
    expect(f.type.kind).toBe("oneof");
    const o = f.type as OneofTypeExpr;
    expect(o.variants).toHaveLength(2);
    expect(o.variants[0].ordinal).toBe(1);
    expect(o.variants[0].name).toBe("email");
    expect(o.variants[1].ordinal).toBe(2);
    expect(o.variants[1].name).toBe("sms");
  });
});

// ── Decorators ────────────────────────────────────────────────────────────────

describe("decorators", () => {
  it("parses a bare decorator on a field", () => {
    const f = firstField("model R { @primaryKey 1 id: uuid }");
    expect(f.decorators).toHaveLength(1);
    expect(f.decorators[0].name).toBe("primaryKey");
    expect(f.decorators[0].args).toHaveLength(0);
  });

  it("parses a namespaced decorator name", () => {
    const f = firstField('model R { @sql.type("JSONB") 1 blob: bytes }');
    expect(f.decorators[0].path).toEqual(["sql", "type"]);
    expect(f.decorators[0].name).toBe("sql.type");
  });

  it("parses a positional string argument", () => {
    const f = firstField('model R { @format("email") 1 e: string }');
    expect(f.decorators[0].args[0]).toMatchObject({
      name: null,
      value: { kind: "string", value: "email" },
    });
  });

  it("parses a negative number argument", () => {
    const f = firstField("model R { @minValue(-90) 1 lat: f64 }");
    expect(f.decorators[0].args[0].value).toMatchObject({ kind: "number", value: -90 });
  });

  it("parses a bare-identifier argument", () => {
    const r = model("@compatibility(backward) model R { 1 id: uuid }");
    expect(r.decorators[0].args[0].value).toMatchObject({ kind: "ident", value: "backward" });
  });

  it("parses named arguments", () => {
    const f = firstField('model R { @http.route(path: "/x", method: "GET") 1 id: uuid }');
    const args = f.decorators[0].args;
    expect(args[0]).toMatchObject({ name: "path", value: { kind: "string", value: "/x" } });
    expect(args[1]).toMatchObject({ name: "method", value: { kind: "string", value: "GET" } });
  });

  it("parses an expression argument (@check)", () => {
    const f = firstField("model R { @check(total >= 0) 1 total: i32 }");
    const value = f.decorators[0].args[0].value;
    expect(value.kind).toBe("expr");
    expect((value as { kind: "expr"; expr: BinaryExpr }).expr.op).toBe(">=");
  });

  it("parses a call expression argument (@default)", () => {
    const f = firstField("model R { @default(gen_uuid()) 1 id: uuid }");
    const value = f.decorators[0].args[0].value;
    expect(value.kind).toBe("expr");
    expect((value as { kind: "expr"; expr: CallExpr }).expr.callee).toBe("gen_uuid");
  });

  it("parses a qualified-identifier argument (@references)", () => {
    const f = firstField("model R { @references(User.id) 1 uid: i64 }");
    expect(f.decorators[0].args[0].value).toMatchObject({ kind: "ident", value: "User.id" });
  });

  it("parses multiple decorators on one field", () => {
    const f = firstField('model R { @minValue(0) @maxValue(1) 1 score: f32 }');
    expect(f.decorators.map(d => d.name)).toEqual(["minValue", "maxValue"]);
  });

  it("parses a decorator on a model declaration", () => {
    const r = model('@table("orders") model Order { 1 id: uuid }');
    expect(r.decorators[0].name).toBe("table");
    expect(r.decorators[0].args[0].value).toMatchObject({ kind: "string", value: "orders" });
  });

  it("rejects decorators on a namespace", () => {
    expect(() => parse("@table(\"x\") namespace foo")).toThrow(ParseError);
  });

  it("keeps doc comment attached across decorators", () => {
    const f = firstField("model R {\n  /// the score\n  @minValue(0) 1 score: f32\n}");
    expect(f.doc).toBe("the score");
    expect(f.decorators[0].name).toBe("minValue");
  });
});

// ── Directives ────────────────────────────────────────────────────────────────

describe("directives", () => {
  it("parses a #suppress directive before a field", () => {
    const f = firstField('model R { #suppress "R005" "intentional" 1 name: string }');
    expect(f.directives).toHaveLength(1);
    expect(f.directives[0].name).toBe("suppress");
    expect(f.directives[0].args).toEqual(["R005", "intentional"]);
  });

  it("parses a directive before a model declaration", () => {
    const r = model('#suppress "R017" "renamed" model R { 1 id: uuid }');
    expect(r.directives[0].name).toBe("suppress");
  });

  it("parses a directive with no arguments", () => {
    const f = firstField("model R { #experimental 1 x: i32 }");
    expect(f.directives[0]).toMatchObject({ name: "experimental", args: [] });
  });

  it("parses a directive and a decorator together on a field", () => {
    const f = firstField('model R { #suppress "R007" "ok" @minValue(0) 1 x: i32 }');
    expect(f.directives[0].name).toBe("suppress");
    expect(f.decorators[0].name).toBe("minValue");
  });
});

// ── Templates (generics) ──────────────────────────────────────────────────────

describe("templates", () => {
  it("parses a model type parameter", () => {
    const r = model("model Page<T> { 1 items: [T] }");
    expect(r.typeParams).toHaveLength(1);
    expect(r.typeParams[0].name).toBe("T");
    expect(r.typeParams[0].constraint).toBeNull();
  });

  it("parses multiple type parameters", () => {
    const r = model("model Pair<K, V> { 1 k: K  2 v: V }");
    expect(r.typeParams.map(p => p.name)).toEqual(["K", "V"]);
  });

  it("parses a constrained type parameter", () => {
    const r = model("model Page<T extends Entity> { 1 items: [T] }");
    expect(r.typeParams[0].constraint?.kind).toBe("named");
    expect((r.typeParams[0].constraint as NamedTypeExpr).path).toEqual(["Entity"]);
  });

  it("parses a generic type alias", () => {
    const prog = parse("type Box<T> = T");
    const alias = prog.declarations[0] as TypeAlias;
    expect(alias.typeParams[0].name).toBe("T");
  });

  it("parses a type argument at a use site", () => {
    const f = firstField("model R { 1 page: Page<Order> }");
    const named = f.type as NamedTypeExpr;
    expect(named.path).toEqual(["Page"]);
    expect(named.typeArgs).toHaveLength(1);
    expect((named.typeArgs[0] as NamedTypeExpr).path).toEqual(["Order"]);
  });

  it("parses nested type arguments (>> closes two levels)", () => {
    const f = firstField("model R { 1 page: Page<List<Order>> }");
    const outer = f.type as NamedTypeExpr;
    const inner = outer.typeArgs[0] as NamedTypeExpr;
    expect(inner.path).toEqual(["List"]);
    expect((inner.typeArgs[0] as NamedTypeExpr).path).toEqual(["Order"]);
  });

  it("parses multiple type arguments", () => {
    const f = firstField("model R { 1 m: Map2<string, Order> }");
    const named = f.type as NamedTypeExpr;
    expect(named.typeArgs).toHaveLength(2);
  });

  it("leaves typeParams empty for a non-generic model", () => {
    expect(model("model R { 1 x: i32 }").typeParams).toEqual([]);
  });
});

// ── Operations & interfaces ───────────────────────────────────────────────────

describe("operations", () => {
  function op(src: string) {
    const decl = parse(src).declarations.find(d => d.kind === "operation");
    if (!decl) throw new Error("No operation declaration found");
    return decl as import("../src/parser/ast").OperationDecl;
  }

  it("parses an operation with one parameter and a return type", () => {
    const o = op("op getOrder(id: uuid): Order");
    expect(o.name).toBe("getOrder");
    expect(o.params).toHaveLength(1);
    expect(o.params[0].name).toBe("id");
    expect((o.params[0].type as ScalarTypeExpr).scalar).toBe("uuid");
    expect((o.returnType as NamedTypeExpr).path).toEqual(["Order"]);
  });

  it("parses an operation with no parameters", () => {
    const o = op("op listOrders(): [Order]");
    expect(o.params).toHaveLength(0);
    expect(o.returnType.kind).toBe("array");
  });

  it("parses multiple parameters", () => {
    const o = op("op move(id: uuid, to: string): bool");
    expect(o.params.map(p => p.name)).toEqual(["id", "to"]);
  });

  it("carries routing decorators (@query / @mutation)", () => {
    const o = op("@query op getOrder(id: uuid): Order");
    expect(o.decorators[0].name).toBe("query");
  });
});

describe("interfaces", () => {
  function iface(src: string) {
    const decl = parse(src).declarations.find(d => d.kind === "interface");
    if (!decl) throw new Error("No interface declaration found");
    return decl as import("../src/parser/ast").InterfaceDecl;
  }

  it("groups operations", () => {
    const i = iface("interface Orders { op list(): [Order]  op get(id: uuid): Order }");
    expect(i.name).toBe("Orders");
    expect(i.operations.map(o => o.name)).toEqual(["list", "get"]);
  });

  it("carries operation decorators inside the interface", () => {
    const i = iface("interface Orders { @query op list(): [Order]  @mutation op add(o: Order): Order }");
    expect(i.operations[0].decorators[0].name).toBe("query");
    expect(i.operations[1].decorators[0].name).toBe("mutation");
  });
});

// ── Escaped identifiers ───────────────────────────────────────────────────────

describe("escaped identifiers", () => {
  it("allows a reserved word as a field name via backticks", () => {
    const f = firstField("model M { 1 `type`: string }");
    expect(f.name).toBe("type");
  });

  it("allows spaces in a model name via backticks", () => {
    const m = model("model `User Account` { 1 id: uuid }");
    expect(m.name).toBe("User Account");
  });

  it("allows a reserved word as a model name via backticks", () => {
    const m = model("model `model` { 1 id: uuid }");
    expect(m.name).toBe("model");
  });
});

// ── Spans ─────────────────────────────────────────────────────────────────────

describe("spans", () => {
  it("attaches a span to model declaration", () => {
    const r = model("model Foo {}");
    expect(r.span.line).toBe(1);
    expect(r.span.col).toBe(1);
  });

  it("attaches a span to each field", () => {
    const fs = fields("model R {\n  1 a: i32\n  2 b: string\n}");
    expect(fs[0].span.line).toBe(2);
    expect(fs[1].span.line).toBe(3);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("parse errors", () => {
  it("throws on unknown top-level token", () => {
    expect(() => parse("garbage")).toThrow(ParseError);
  });

  it("throws on model missing opening brace", () => {
    expect(() => parse("model Foo")).toThrow(ParseError);
  });

  it("throws on field missing colon", () => {
    expect(() => parse("model R { 1 x i32 }")).toThrow(ParseError);
  });

  it("throws on unclosed constraint bracket", () => {
    expect(() => parse("model R { 1 x: i32 [not_null }")).toThrow(ParseError);
  });

  it("throws on import missing from keyword", () => {
    expect(() => parse('import { A } "@pkg"')).toThrow(ParseError);
  });

  it("includes line info in error message", () => {
    try {
      parse("model\nFoo\ngone");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message).toMatch(/3:/);
    }
  });
});

// ── Multi-declaration program ─────────────────────────────────────────────────

describe("multi-declaration program", () => {
  const SRC = `
    namespace myorg

    import { Money } from "@myorg/common/v1"

    type Id = uuid

    enum Color { 1 red  2 green  3 blue }

    model Product {
      1 id:    uuid
      2 price: Money
    }
  `;

  it("parses all four declaration kinds", () => {
    const prog = parse(SRC);
    const kinds = prog.declarations.map(d => d.kind);
    expect(kinds).toContain("namespace");
    expect(kinds).toContain("import");
    expect(kinds).toContain("type_alias");
    expect(kinds).toContain("enum");
    expect(kinds).toContain("model");
  });

  it("preserves declaration order", () => {
    const prog = parse(SRC);
    expect(prog.declarations[0].kind).toBe("namespace");
    expect(prog.declarations[1].kind).toBe("import");
  });
});