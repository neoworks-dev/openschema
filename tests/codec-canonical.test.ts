// tests/codec-canonical.test.ts
//
// Canonical encoding is what lets a hash of the payload stand in for the payload:
// identical data must always produce identical bytes, so an unchanged row can be
// recognised without decrypting it.

import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, generateCodec, hex, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const MIXED = `namespace t
enum E { 1 a  2 b }
model Inner { 1 v: i32 }
model M {
  1 id: uuid
  2 name: string
  3 count: i64
  4 tags: [string]
  5 nums: [i32]
  6 labels: {string: string}
  7 inner: Inner?
  8 kind: E
  9 optional: [i32]?
}`;

function sample(overrides: Record<string, unknown> = {}) {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    name: "n",
    count: 5n,
    tags: ["x", "y"],
    nums: [3, 1, 2],
    labels: new Map([["b", "2"], ["a", "1"]]),
    inner: { v: 9 },
    kind: 2,
    optional: null,
    ...overrides,
  };
}

describe("determinism", () => {
  it("produces identical bytes for identical data", async () => {
    const codec = await loadCodec(MIXED);
    expect(hex(codec.encodeM(sample()))).toBe(hex(codec.encodeM(sample())));
  });

  it("is stable across decode and re-encode", async () => {
    const codec = await loadCodec(MIXED);
    const first = codec.encodeM(sample());
    expect(hex(codec.encodeM(codec.decodeM(first)))).toBe(hex(first));
  });

  it("does not depend on map insertion order", async () => {
    const codec = await loadCodec(MIXED);
    const forward = codec.encodeM(sample({ labels: new Map([["a", "1"], ["b", "2"]]) }));
    const reverse = codec.encodeM(sample({ labels: new Map([["b", "2"], ["a", "1"]]) }));
    expect(hex(forward)).toBe(hex(reverse));
  });

  it("does not depend on json key order", async () => {
    const codec = await loadCodec("namespace t\nmodel J { 1 payload: json }");
    const forward = codec.encodeJ({ payload: { a: 1, b: { c: 2, d: 3 } } });
    const reverse = codec.encodeJ({ payload: { b: { d: 3, c: 2 }, a: 1 } });
    expect(hex(forward)).toBe(hex(reverse));
  });

  it("emits fields in ascending ordinal order regardless of object key order", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 a: i32  2 b: i32  3 c: i32 }");
    expect(hex(codec.encodeM({ c: 3, a: 1, b: 2 }))).toBe(hex(codec.encodeM({ a: 1, b: 2, c: 3 })));
  });

  it("generates byte-identical output on repeated emit", () => {
    expect(generateCodec(MIXED)).toBe(generateCodec(MIXED));
  });
});

describe("normalizing non-canonical input", () => {
  it("normalizes descending field order", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 a: i32  2 b: i32 }");
    const canonical = codec.encodeM({ a: 1, b: 2 });
    // Hand-built: tag 2 first, then tag 1.
    const descending = new Uint8Array([0x10, 0x02, 0x08, 0x01]);
    expect(hex(codec.encodeM(codec.decodeM(descending)))).toBe(hex(canonical));
  });

  it("normalizes an unpacked repeated scalar into the packed form", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 ns: [i32] }");
    const canonical = codec.encodeM({ ns: [1, 2] });
    // Two separate varint fields at tag 1 rather than one packed LEN field.
    const unpacked = new Uint8Array([0x08, 0x01, 0x08, 0x02]);
    expect(codec.decodeM(unpacked).ns).toEqual([1, 2]);
    expect(hex(codec.encodeM(codec.decodeM(unpacked)))).toBe(hex(canonical));
  });

  it("normalizes unsorted map entries", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 m: {string: string} }");
    const sorted = codec.encodeM({ m: new Map([["a", "1"], ["z", "2"]]) });
    const unsorted = codec.encodeM({ m: new Map([["z", "2"], ["a", "1"]]) });
    expect(hex(unsorted)).toBe(hex(sorted));
  });

  it("normalizes a non-canonical decimal", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 d: decimal(12,2) }");
    expect(hex(codec.encodeM({ d: "1.5" }))).toBe(hex(codec.encodeM({ d: "1.50" })));
    expect(hex(codec.encodeM({ d: "-0.00" }))).toBe(hex(codec.encodeM({ d: "0" })));
    expect(hex(codec.encodeM({ d: "007.10" }))).toBe(hex(codec.encodeM({ d: "7.1" })));
  });
});

describe("map key ordering", () => {
  // JS string comparison is UTF-16 code-unit order, which disagrees with UTF-8
  // byte order across the surrogate boundary. Emoji reach that case.
  it("sorts by encoded UTF-8 bytes, not UTF-16 code units", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 m: {string: i32} }");
    const low = "￿";
    const high = "\u{10000}";
    expect(low < high).toBe(false); // UTF-16 order disagrees with UTF-8 order

    const bytes = codec.encodeM({ m: new Map([[high, 1], [low, 2]]) });
    const keys = [...codec.decodeM(bytes).m.keys()];
    // UTF-8: U+FFFF is ef bf bf, U+10000 is f0 90 80 80 — so U+FFFF sorts first.
    expect(keys).toEqual([low, high]);
  });
});

describe("varint minimality", () => {
  it("uses one byte for small positive integers", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 n: i32 }");
    expect(codec.encodeM({ n: 1 }).length).toBe(2);
    expect(codec.encodeM({ n: 127 }).length).toBe(2);
    expect(codec.encodeM({ n: 128 }).length).toBe(3);
  });

  // Plain two's-complement varint keeps every NUMERIC_WIDENS entry a byte-level
  // no-op; the price is that negatives are always sign-extended to 64 bits.
  it("sign-extends negative integers to ten bytes", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 n: i32 }");
    expect(codec.encodeM({ n: -1 }).length).toBe(11);
  });
});
