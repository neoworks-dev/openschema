// tests/engine/type-compat.test.ts
import { describe, it, expect } from "bun:test";
import { compareTypes, describeType } from "../src/engine/type-compat";
import type { TypeExpr } from "../src/parser/ast";

// ── Type expression builders ──────────────────────────────────────────────────

const SPAN = { line: 0, col: 0 };

const scalar = (s: TypeExpr["kind"] extends "scalar" ? any : never, scalar: any): TypeExpr =>
  ({ kind: "scalar", scalar, span: SPAN } as TypeExpr);

const bool      = (): TypeExpr => ({ kind: "scalar", scalar: "bool",      span: SPAN });
const i8        = (): TypeExpr => ({ kind: "scalar", scalar: "i8",        span: SPAN });
const i16       = (): TypeExpr => ({ kind: "scalar", scalar: "i16",       span: SPAN });
const i32       = (): TypeExpr => ({ kind: "scalar", scalar: "i32",       span: SPAN });
const i64       = (): TypeExpr => ({ kind: "scalar", scalar: "i64",       span: SPAN });
const u8        = (): TypeExpr => ({ kind: "scalar", scalar: "u8",        span: SPAN });
const u16       = (): TypeExpr => ({ kind: "scalar", scalar: "u16",       span: SPAN });
const u32       = (): TypeExpr => ({ kind: "scalar", scalar: "u32",       span: SPAN });
const u64       = (): TypeExpr => ({ kind: "scalar", scalar: "u64",       span: SPAN });
const f32       = (): TypeExpr => ({ kind: "scalar", scalar: "f32",       span: SPAN });
const f64       = (): TypeExpr => ({ kind: "scalar", scalar: "f64",       span: SPAN });
const str       = (): TypeExpr => ({ kind: "scalar", scalar: "string",    span: SPAN });
const bytes     = (): TypeExpr => ({ kind: "scalar", scalar: "bytes",     span: SPAN });
const uuid      = (): TypeExpr => ({ kind: "scalar", scalar: "uuid",      span: SPAN });
const timestamp = (): TypeExpr => ({ kind: "scalar", scalar: "timestamp", span: SPAN });

const nullable  = (inner: TypeExpr): TypeExpr => ({ kind: "nullable", inner, span: SPAN });
const array     = (element: TypeExpr): TypeExpr => ({ kind: "array", element, span: SPAN });
const mapT      = (key: TypeExpr, value: TypeExpr): TypeExpr => ({ kind: "map", key, value, span: SPAN });
const named     = (...path: string[]): TypeExpr => ({ kind: "named", path, typeArgs: [], span: SPAN });
const decimal   = (precision: number, scale: number): TypeExpr =>
  ({ kind: "decimal", precision, scale, span: SPAN });
const union     = (...variants: TypeExpr[]): TypeExpr => ({ kind: "union", variants, span: SPAN });
const oneof     = (...vs: Array<{ ordinal: number; name: string; type: TypeExpr }>): TypeExpr =>
  ({ kind: "oneof", variants: vs.map(v => ({ ...v, span: SPAN })), span: SPAN });

// ── Identity ──────────────────────────────────────────────────────────────────

describe("same type returns 'same'", () => {
  it("scalar identity", () => {
    expect(compareTypes(i32(), i32())).toBe("same");
  });

  it("nullable identity", () => {
    expect(compareTypes(nullable(str()), nullable(str()))).toBe("same");
  });

  it("array identity", () => {
    expect(compareTypes(array(i32()), array(i32()))).toBe("same");
  });

  it("named identity", () => {
    expect(compareTypes(named("User"), named("User"))).toBe("same");
  });

  it("qualified named identity", () => {
    expect(compareTypes(named("myorg", "User"), named("myorg", "User"))).toBe("same");
  });

  it("decimal identity", () => {
    expect(compareTypes(decimal(10, 2), decimal(10, 2))).toBe("same");
  });
});

// ── Integer widenings ─────────────────────────────────────────────────────────

describe("integer widening (safe)", () => {
  const widenings: Array<[() => TypeExpr, () => TypeExpr]> = [
    [i8,  i16], [i8,  i32], [i8,  i64],
    [i16, i32], [i16, i64],
    [i32, i64],
    [u8,  u16], [u8,  u32], [u8,  u64],
    [u16, u32], [u16, u64],
    [u32, u64],
  ];

  for (const [from, to] of widenings) {
    it(`${from().kind === "scalar" ? (from() as any).scalar : "?"} → ${(to() as any).scalar}`, () => {
      expect(compareTypes(from(), to())).toBe("widened");
    });
  }
});

describe("integer narrowing (breaking_writer)", () => {
  const narrowings: Array<[() => TypeExpr, () => TypeExpr]> = [
    [i64, i32], [i64, i16], [i64, i8],
    [i32, i16], [i32, i8],
    [i16, i8],
    [u64, u32], [u64, u16], [u64, u8],
    [u32, u16], [u32, u8],
    [u16, u8],
  ];

  for (const [from, to] of narrowings) {
    it(`${(from() as any).scalar} → ${(to() as any).scalar}`, () => {
      expect(compareTypes(from(), to())).toBe("narrowed");
    });
  }
});

// ── Cross-sign widening ───────────────────────────────────────────────────────

describe("unsigned → wider signed (safe)", () => {
  it("u8 → i16", () => expect(compareTypes(u8(),  i16())).toBe("widened"));
  it("u8 → i32", () => expect(compareTypes(u8(),  i32())).toBe("widened"));
  it("u8 → i64", () => expect(compareTypes(u8(),  i64())).toBe("widened"));
  it("u16 → i32", () => expect(compareTypes(u16(), i32())).toBe("widened"));
  it("u16 → i64", () => expect(compareTypes(u16(), i64())).toBe("widened"));
  it("u32 → i64", () => expect(compareTypes(u32(), i64())).toBe("widened"));
});

// ── Float widening ────────────────────────────────────────────────────────────

describe("float widening", () => {
  it("f32 → f64 is widened", () => expect(compareTypes(f32(), f64())).toBe("widened"));
  it("f64 → f32 is narrowed", () => expect(compareTypes(f64(), f32())).toBe("narrowed"));
});

// ── Incompatible scalars ──────────────────────────────────────────────────────

describe("incompatible scalar types", () => {
  it("string → bytes", () => expect(compareTypes(str(),   bytes())).toBe("incompatible"));
  it("bytes → string", () => expect(compareTypes(bytes(), str()  )).toBe("incompatible"));
  it("uuid → string",  () => expect(compareTypes(uuid(),  str()  )).toBe("incompatible"));
  it("bool → i32",     () => expect(compareTypes(bool(),  i32()  )).toBe("incompatible"));
  it("timestamp → string", () => expect(compareTypes(timestamp(), str())).toBe("incompatible"));
  it("i32 → f32", () => expect(compareTypes(i32(), f32())).toBe("incompatible"));
});

// ── Nullable promotions ───────────────────────────────────────────────────────

describe("nullable promotions", () => {
  it("T → T? is widened", () => {
    expect(compareTypes(str(), nullable(str()))).toBe("widened");
  });

  it("T? → T is narrowed", () => {
    expect(compareTypes(nullable(str()), str())).toBe("narrowed");
  });

  it("T? → T? same inner is same", () => {
    expect(compareTypes(nullable(i32()), nullable(i32()))).toBe("same");
  });

  it("T? → U? where U is wider is widened", () => {
    expect(compareTypes(nullable(i32()), nullable(i64()))).toBe("widened");
  });

  it("T? → U? where U is incompatible is incompatible", () => {
    expect(compareTypes(nullable(str()), nullable(bytes()))).toBe("incompatible");
  });
});

// ── Decimal ───────────────────────────────────────────────────────────────────

describe("decimal types", () => {
  it("same precision and scale is same", () => {
    expect(compareTypes(decimal(10, 2), decimal(10, 2))).toBe("same");
  });

  it("larger precision and scale is widened", () => {
    expect(compareTypes(decimal(10, 2), decimal(12, 4))).toBe("widened");
  });

  it("smaller precision and scale is narrowed", () => {
    expect(compareTypes(decimal(12, 4), decimal(10, 2))).toBe("narrowed");
  });

  it("larger precision smaller scale is incompatible", () => {
    expect(compareTypes(decimal(10, 4), decimal(12, 2))).toBe("incompatible");
  });
});

// ── Arrays ────────────────────────────────────────────────────────────────────

describe("array types", () => {
  it("same element type is same", () => {
    expect(compareTypes(array(i32()), array(i32()))).toBe("same");
  });

  it("widened element type is widened", () => {
    expect(compareTypes(array(i32()), array(i64()))).toBe("widened");
  });

  it("narrowed element type is narrowed", () => {
    expect(compareTypes(array(i64()), array(i32()))).toBe("narrowed");
  });

  it("incompatible element type is incompatible", () => {
    expect(compareTypes(array(str()), array(bytes()))).toBe("incompatible");
  });
});

// ── Maps ──────────────────────────────────────────────────────────────────────

describe("map types", () => {
  it("same key and value is same", () => {
    expect(compareTypes(mapT(str(), i32()), mapT(str(), i32()))).toBe("same");
  });

  it("widened value is widened", () => {
    expect(compareTypes(mapT(str(), i32()), mapT(str(), i64()))).toBe("widened");
  });

  it("incompatible key is incompatible", () => {
    expect(compareTypes(mapT(str(), i32()), mapT(bytes(), i32()))).toBe("incompatible");
  });
});

// ── Named types ───────────────────────────────────────────────────────────────

describe("named types", () => {
  it("same single-part name is same", () => {
    expect(compareTypes(named("User"), named("User"))).toBe("same");
  });

  it("same multi-part name is same", () => {
    expect(compareTypes(named("a", "b", "C"), named("a", "b", "C"))).toBe("same");
  });

  it("different name is incompatible", () => {
    expect(compareTypes(named("User"), named("Account"))).toBe("incompatible");
  });

  it("qualified vs unqualified with same last part is incompatible", () => {
    expect(compareTypes(named("User"), named("myorg", "User"))).toBe("incompatible");
  });
});

// ── Unions ────────────────────────────────────────────────────────────────────

describe("union types", () => {
  it("identical unions are same", () => {
    expect(compareTypes(union(str(), i32()), union(str(), i32()))).toBe("same");
  });

  it("adding a variant is widened", () => {
    expect(compareTypes(union(str()), union(str(), i32()))).toBe("widened");
  });

  it("removing a variant is narrowed", () => {
    expect(compareTypes(union(str(), i32()), union(str()))).toBe("narrowed");
  });

  it("adding and removing is incompatible", () => {
    expect(compareTypes(union(str(), i32()), union(str(), bytes()))).toBe("incompatible");
  });
});

// ── Oneofs ────────────────────────────────────────────────────────────────────

describe("oneof types", () => {
  const v1 = { ordinal: 1, name: "email", type: str() };
  const v2 = { ordinal: 2, name: "sms",   type: str() };
  const v3 = { ordinal: 3, name: "push",  type: str() };

  it("identical oneofs are same", () => {
    expect(compareTypes(oneof(v1, v2), oneof(v1, v2))).toBe("same");
  });

  it("adding an ordinal is widened", () => {
    expect(compareTypes(oneof(v1, v2), oneof(v1, v2, v3))).toBe("widened");
  });

  it("removing an ordinal is narrowed", () => {
    expect(compareTypes(oneof(v1, v2), oneof(v1))).toBe("narrowed");
  });
});

// ── describeType ──────────────────────────────────────────────────────────────

describe("describeType", () => {
  it("describes a scalar", () => {
    expect(describeType(i32())).toBe("i32");
  });

  it("describes nullable", () => {
    expect(describeType(nullable(str()))).toBe("string?");
  });

  it("describes array", () => {
    expect(describeType(array(i32()))).toBe("[i32]");
  });

  it("describes map", () => {
    expect(describeType(mapT(str(), i64()))).toBe("{string:i64}");
  });

  it("describes named", () => {
    expect(describeType(named("myorg", "User"))).toBe("myorg.User");
  });

  it("describes decimal", () => {
    expect(describeType(decimal(10, 2))).toBe("decimal(10,2)");
  });

  it("describes union", () => {
    expect(describeType(union(str(), uuid()))).toBe("string|uuid");
  });

  it("describes nested type", () => {
    expect(describeType(array(nullable(i32())))).toBe("[i32?]");
  });
});