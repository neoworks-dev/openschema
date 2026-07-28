// tests/codec-emit.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { CodecUnsupportedError } from "../src/emit/codec/errors";
import { generateCodec } from "./helpers/loadCodec";

function emit(src: string, company: string | null = null): string {
  return generateCodec(src, company);
}

function emitError(src: string, company: string | null = null): CodecUnsupportedError {
  try {
    emit(src, company);
  } catch (error) {
    if (error instanceof CodecUnsupportedError) return error;
    throw error;
  }
  throw new Error("expected a CodecUnsupportedError");
}

describe("registration", () => {
  it("is registered as the 'codec' target", () => {
    expect(getEmitter("codec")).not.toBeNull();
  });

  it("writes to schema.codec.ts, not schema.ts", () => {
    const schema = resolve(parse("namespace t\nmodel M { 1 a: i32 }"));
    const files = getEmitter("codec")!.emit({ schema, company: null, includePrivate: false, options: {} });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("schema.codec.ts");
  });
});

describe("generated types", () => {
  it("maps 64-bit integers to bigint, not number", () => {
    const output = emit("namespace t\nmodel M { 1 a: i64  2 b: u64  3 c: i32 }");
    expect(output).toContain("a: bigint;");
    expect(output).toContain("b: bigint;");
    expect(output).toContain("c: number;");
  });

  it("maps decimal to string", () => {
    expect(emit("namespace t\nmodel M { 1 a: decimal(12,2) }")).toContain("a: string;");
  });

  it("maps a map to Map, not Record", () => {
    expect(emit("namespace t\nmodel M { 1 a: {string: i32} }")).toContain("a: Map<string, number>;");
  });

  it("keeps a nullable array nullable", () => {
    expect(emit("namespace t\nmodel M { 1 a: [i32]? }")).toContain("a: number[] | null;");
  });

  it("gives every message an optional unknown-field bag", () => {
    expect(emit("namespace t\nmodel M { 1 a: i32 }")).toContain("$unknown?: UnknownField[];");
  });

  it("gives a oneof an unknown arm so future variants survive", () => {
    const output = emit("namespace t\nmodel M { 1 p: oneof { 1 a: string } }");
    expect(output).toContain(`{ kind: "$unknown"; $unknown: UnknownField[] }`);
  });

  it("emits enum members with their declared ordinals", () => {
    const output = emit("namespace t\nenum E { 1 red  7 blue }\nmodel M { 1 e: E }");
    expect(output).toContain("red = 1,");
    expect(output).toContain("blue = 7,");
  });

  it("uses bracket access for a backtick-escaped field name", () => {
    const output = emit("namespace t\nmodel M { 1 `odd name`: string }");
    expect(output).toContain(`value["odd name"]`);
    expect(output).toContain(`"odd name": string;`);
  });

  it("skips generic models, matching the zod target", () => {
    const output = emit("namespace t\nmodel Box<T> { 1 v: T }\nmodel M { 1 a: i32 }");
    expect(output).not.toContain("encodeBox");
    expect(output).toContain("encodeM");
  });

  it("records the declared ordinals in the known-tag set", () => {
    expect(emit("namespace t\nmodel M { 1 a: i32  5 b: i32 }")).toContain("KNOWN_M: ReadonlySet<number> = new Set([1, 5])");
  });

  // Filled by the ordinal ledger later; the decoder already consults it.
  it("emits an empty retired-tag set", () => {
    expect(emit("namespace t\nmodel M { 1 a: i32 }")).toContain("RETIRED_M: ReadonlySet<number> = new Set([])");
  });
});

describe("determinism of the emitter itself", () => {
  it("produces byte-identical output on repeated runs", () => {
    const src = "namespace t\nenum E { 1 a }\nmodel I { 1 n: i32 }\nmodel M { 1 e: E  2 i: I  3 m: {string: i32} }";
    expect(emit(src)).toBe(emit(src));
  });
});

describe("rejected constructs", () => {
  it("OSC001: an untagged union of models", () => {
    const src = "namespace t\nmodel A { 1 a: i32 }\nmodel B { 1 b: i32 }\ntype G = A | B\nmodel M { 1 g: G }";
    expect(emitError(src).code).toBe("OSC001");
  });

  it("OSC002: null inside a repeated field", () => {
    expect(emitError("namespace t\nmodel M { 1 a: [string?] }").code).toBe("OSC002");
  });

  it("OSC003: a map key that cannot be encoded", () => {
    expect(emitError("namespace t\nmodel M { 1 a: {f64: string} }").code).toBe("OSC003");
  });

  it("OSC004: ordinal 0", () => {
    expect(emitError("namespace t\nmodel M { 0 a: i32 }").code).toBe("OSC004");
  });

  it("OSC004: an ordinal above the tag maximum", () => {
    expect(emitError("namespace t\nmodel M { 536870912 a: i32 }").code).toBe("OSC004");
  });

  it("OSC005: --company, because overlay ordinals share the base tag space", () => {
    const src = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32 }";
    expect(emitError(src, "acme").code).toBe("OSC005");
  });

  it("OSC006: a field named $unknown", () => {
    expect(emitError("namespace t\nmodel M { 1 `$unknown`: string }").code).toBe("OSC006");
  });

  it("OSC008: the same local name in two namespaces", () => {
    const src = "namespace t\nmodel Name { 1 a: i32 }\nenum Name2 { 1 x }";
    // Two records with the same localName across modules is the real case; within
    // one module the resolver already rejects it, so assert the guard directly.
    const schema = resolve(parse(src));
    const duplicate = [...schema.records.values()][0];
    schema.records.set("other.Name", { ...duplicate });
    expect(() => getEmitter("codec")!.emit({ schema, company: null, includePrivate: false, options: {} }))
      .toThrow(/OSC008|declared in both/);
  });

  it("reports the field name and span", () => {
    const error = emitError("namespace t\nmodel M { 1 a: {f64: string} }");
    expect(error.message).toContain("M.a");
    expect(error.span?.line).toBe(2);
  });

  // A union alias nothing encodable references must not fail the build.
  it("ignores an unused union alias", () => {
    const src = "namespace t\nmodel A { 1 a: i32 }\nmodel B { 1 b: i32 }\ntype G = A | B\nmodel M { 1 n: i32 }";
    expect(() => emit(src)).not.toThrow();
  });
});
