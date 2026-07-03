// tests/resolver.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve, resolveModules } from "../src/resolver";
import type { ResolvedSchema, Module } from "../src/resolver/types";

function resolveSrc(src: string): ResolvedSchema {
  return resolve(parse(src));
}

function codes(schema: ResolvedSchema): string[] {
  return schema.diagnostics.map(d => d.code);
}

// Build a Module without touching the filesystem; importMap wires `from` → id.
function mod(moduleId: string, src: string, importMap: Record<string, string> = {}): Module {
  return { moduleId, sourcePath: null, program: parse(src), importMap: new Map(Object.entries(importMap)) };
}

describe("symbol table", () => {
  it("indexes records under their qualified name", () => {
    const s = resolveSrc("namespace myorg\nmodel User { 1 id: uuid }");
    expect(s.records.has("myorg.User")).toBe(true);
    expect(s.hasErrors).toBe(false);
  });

  it("works without a namespace", () => {
    const s = resolveSrc("model User { 1 id: uuid }");
    expect(s.records.has("User")).toBe(true);
  });

  it("flags duplicate declaration names", () => {
    const s = resolveSrc("model A { 1 x: i32 }  model A { 1 y: i32 }");
    expect(codes(s)).toContain("OS1001");
    expect(s.hasErrors).toBe(true);
  });
});

describe("name resolution", () => {
  it("resolves a reference to another model", () => {
    const s = resolveSrc("model A { 1 b: B }  model B { 1 x: i32 }");
    expect(s.hasErrors).toBe(false);
  });

  it("flags an undefined type reference", () => {
    const s = resolveSrc("model A { 1 b: Missing }");
    expect(codes(s)).toContain("OS1003");
  });

  it("does not flag generic type parameters as undefined", () => {
    const s = resolveSrc("model Page<T> { 1 items: [T] }");
    expect(s.hasErrors).toBe(false);
  });

  it("resolves a qualified reference within the same namespace", () => {
    const s = resolveSrc("namespace schema.org\nmodel A { 1 b: schema.org.B }  model B { 1 x: i32 }");
    expect(s.hasErrors).toBe(false);
  });
});

describe("extends flattening", () => {
  it("inherits base fields", () => {
    const s = resolveSrc("model Base { 1 id: uuid }  model Sub extends Base { 2 name: string }");
    const sub = s.records.get("Sub")!;
    expect(sub.fields.map(f => f.name)).toEqual(["id", "name"]);
    expect(sub.fields.find(f => f.name === "id")!.origin).toBe("inherited");
    expect(sub.baseChain.map(b => b.localName)).toEqual(["Base"]);
  });

  it("detects an extends cycle", () => {
    const s = resolveSrc("model A extends B { 1 x: i32 }  model B extends A { 2 y: i32 }");
    expect(codes(s)).toContain("OS1004");
  });

  it("flags extending a non-model", () => {
    const s = resolveSrc("enum E { 1 a }  model R extends E { 1 x: i32 }");
    expect(codes(s)).toContain("OS1005");
  });
});

describe("ordinal validation", () => {
  it("flags a duplicate ordinal", () => {
    const s = resolveSrc("model R { 1 a: i32  1 b: string }");
    expect(codes(s)).toContain("OS2001");
  });

  it("flags a missing ordinal", () => {
    const s = resolveSrc("model R { name: string }");
    expect(codes(s)).toContain("OS2006");
  });

  it("flags an inherited/own ordinal collision", () => {
    const s = resolveSrc("model Base { 1 id: uuid }  model Sub extends Base { 1 name: string }");
    expect(codes(s)).toContain("OS2001");
  });
});

describe("multi-file imports", () => {
  const COMMON = "namespace org.common\nmodel Money { 1 amount: i64  2 currency: string }";

  it("resolves an imported type used in another module", () => {
    const shop = mod("shop", 'namespace org.shop\nimport { Money } from "./common"\nmodel Order { 1 total: Money }',
      { "./common": "common" });
    const schema = resolveModules([shop, mod("common", COMMON)]);
    expect(schema.hasErrors).toBe(false);
    expect(schema.records.has("org.shop.Order")).toBe(true);
    expect(schema.records.has("org.common.Money")).toBe(true);
  });

  it("flags importing a name the module does not export", () => {
    const shop = mod("shop", 'namespace org.shop\nimport { Ghost } from "./common"\nmodel Order { 1 g: Ghost }',
      { "./common": "common" });
    expect(codes(resolveModules([shop, mod("common", COMMON)]))).toContain("OS1007");
  });

  it("flags an import whose module was not loaded", () => {
    const shop = mod("shop", 'namespace org.shop\nimport { Money } from "./missing"\nmodel Order { 1 total: Money }');
    expect(codes(resolveModules([shop]))).toContain("OS1008");
  });

  it("flags duplicate qualified names across modules", () => {
    const a = mod("a", "namespace org\nmodel Dup { 1 x: i32 }");
    const b = mod("b", "namespace org\nmodel Dup { 1 y: i32 }");
    expect(codes(resolveModules([a, b]))).toContain("OS1002");
  });
});

describe("per-company overlays", () => {
  const SRC = `
    model Person { 1 name: string }
    overlay acme on Person {
      1 spamScore: f32
      2 internalNote: string
    }
    overlay globex on Person {
      1 riskTier: i32
    }
  `;

  it("scopes overlays by base and company", () => {
    const s = resolveSrc(SRC);
    expect(s.hasErrors).toBe(false);
    const byCompany = s.overlays.get("Person")!;
    expect([...byCompany.keys()].sort()).toEqual(["acme", "globex"]);
    expect(byCompany.get("acme")!.fields.map(f => f.name)).toEqual(["spamScore", "internalNote"]);
  });

  it("two companies reuse ordinal 1 without colliding", () => {
    const s = resolveSrc(SRC);
    const acme = s.overlays.get("Person")!.get("acme")!;
    const globex = s.overlays.get("Person")!.get("globex")!;
    expect(acme.fields[0].ordinal).toBe(1);
    expect(globex.fields[0].ordinal).toBe(1);
    expect(s.hasErrors).toBe(false);
  });

  it("flags an overlay on an undefined base", () => {
    const s = resolveSrc("overlay acme on Ghost { 1 x: i32 }");
    expect(codes(s)).toContain("OS3001");
  });

  it("flags an overlay field clashing with a base field name", () => {
    const s = resolveSrc("model Person { 1 name: string }  overlay acme on Person { 1 name: string }");
    expect(codes(s)).toContain("OS3003");
  });

  it("flags a duplicate ordinal within one overlay", () => {
    const s = resolveSrc("model Person { 1 name: string }  overlay acme on Person { 1 a: i32  1 b: i32 }");
    expect(codes(s)).toContain("OS2002");
  });
});

describe("type alias inlining", () => {
  function firstField(s: ResolvedSchema) {
    return [...s.records.values()][0].fields[0].type;
  }

  it("inlines a scalar alias", () => {
    const s = resolveSrc("type Id = uuid\nmodel R { 1 a: Id }");
    const t = firstField(s);
    expect(t).toMatchObject({ kind: "scalar", scalar: "uuid" });
    expect(s.hasErrors).toBe(false);
  });

  it("inlines an array alias", () => {
    const s = resolveSrc("type Tags = [string]\nmodel R { 1 a: Tags }");
    expect(firstField(s)).toMatchObject({ kind: "array", element: { scalar: "string" } });
  });

  it("inlines an alias chain", () => {
    const s = resolveSrc("type A = B\ntype B = uuid\nmodel R { 1 a: A }");
    expect(firstField(s)).toMatchObject({ kind: "scalar", scalar: "uuid" });
  });

  it("substitutes a generic alias", () => {
    const s = resolveSrc("type Box<T> = [T]\nmodel R { 1 a: Box<i32> }");
    expect(firstField(s)).toMatchObject({ kind: "array", element: { scalar: "i32" } });
    expect(s.hasErrors).toBe(false);
  });

  it("leaves a union alias as a named reference", () => {
    const s = resolveSrc("model Point { 1 x: f64 }  model Line { 1 y: f64 }\ntype Geometry = Point | Line\nmodel F { 1 g: Geometry }");
    expect(s.records.get("F")!.fields[0].type).toMatchObject({ kind: "named", path: ["Geometry"] });
    expect(s.hasErrors).toBe(false);
  });

  it("flags a generic alias arity mismatch (OS1009)", () => {
    const s = resolveSrc("type Box<T> = [T]\nmodel R { 1 a: Box }");
    expect(codes(s)).toContain("OS1009");
  });

  it("flags a cyclic alias (OS1010)", () => {
    const s = resolveSrc("type A = B\ntype B = A\nmodel R { 1 a: A }");
    expect(codes(s)).toContain("OS1010");
  });

  it("flags a non-object union member (OS1011)", () => {
    const s = resolveSrc("model Point { 1 x: f64 }\ntype Bad = string | Point\nmodel F { 1 g: Bad }");
    expect(codes(s)).toContain("OS1011");
  });

  it("flags a union used in operation input (OS1012)", () => {
    const s = resolveSrc("model Point { 1 x: f64 }  model Line { 1 y: f64 }\ntype Geometry = Point | Line\n@query op f(g: Geometry): Point");
    expect(codes(s)).toContain("OS1012");
  });
});

describe("array length decorators", () => {
  function firstField(s: ResolvedSchema) {
    return [...s.records.values()][0].fields[0].type;
  }

  it("stamps @minItems/@maxItems onto the outer array", () => {
    const s = resolveSrc("model R { @minItems(2) @maxItems(3) 1 a: [f64] }");
    expect(firstField(s)).toMatchObject({ kind: "array", minItems: 2, maxItems: 3 });
  });

  it("@length sets both bounds", () => {
    const s = resolveSrc("model R { @length(4) 1 a: [f64] }");
    expect(firstField(s)).toMatchObject({ kind: "array", minItems: 4, maxItems: 4 });
  });

  it("warns when the decorator is on a non-array field", () => {
    const s = resolveSrc("model R { @minItems(2) 1 a: string }");
    expect(codes(s)).toContain("OS1013");
  });
});

describe("@link validation", () => {
  it("accepts a link to a model with a single @primaryKey", () => {
    const s = resolveSrc("model Geo { @primaryKey 1 id: uuid  2 lat: f64 }  model M { @link 1 g: Geo? }");
    expect(s.hasErrors).toBe(false);
  });

  it("rejects a link whose target has no @primaryKey (OS1016)", () => {
    const s = resolveSrc("model Geo { 1 lat: f64 }  model M { @link 1 g: Geo? }");
    expect(codes(s)).toContain("OS1016");
    expect(s.hasErrors).toBe(true);
  });

  it("rejects a link to a composite-key target (OS1016)", () => {
    const s = resolveSrc("model Geo { @primaryKey 1 lat: f64  @primaryKey 2 lng: f64 }  model M { @link 1 g: Geo }");
    expect(codes(s)).toContain("OS1016");
  });

  it("rejects @link on a non-model field (OS1015)", () => {
    const s = resolveSrc("model M { @link 1 g: string }");
    expect(codes(s)).toContain("OS1015");
  });

  it("validates links through array element types", () => {
    const s = resolveSrc("model Geo { 1 lat: f64 }  model M { @link 1 g: [Geo] }");
    expect(codes(s)).toContain("OS1016");
  });
});
