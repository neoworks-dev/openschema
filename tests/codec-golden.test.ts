// tests/codec-golden.test.ts
//
// Frozen wire vectors. This is the only thing that stops a future refactor from
// silently changing the format — a diff here must be a deliberate, reviewed wire
// change, because existing encrypted rows cannot be re-read after one.

import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, fromHex, hex, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

interface Vector {
  label:    string;
  schema:   string;
  value:    unknown;
  expected: string;
}

function model(type: string): string {
  return `namespace t\nmodel M { 1 v: ${type} }`;
}

const VECTORS: Vector[] = [
  { label: "bool true",           schema: model("bool"),          value: true,                              expected: "0801" },
  { label: "i32 1",               schema: model("i32"),           value: 1,                                 expected: "0801" },
  // Plain two's-complement varint: negatives are sign-extended to 64 bits.
  { label: "i32 -1",              schema: model("i32"),           value: -1,                                expected: "08ffffffffffffffffff01" },
  { label: "i32 300",             schema: model("i32"),           value: 300,                               expected: "08ac02" },
  { label: "u64 max",             schema: model("u64"),           value: 18446744073709551615n,             expected: "08ffffffffffffffffff01" },
  // f32 and f64 share one encoding, which is what makes f32->f64 a no-op.
  { label: "f64 1.5",             schema: model("f64"),           value: 1.5,                               expected: "09000000000000f83f" },
  { label: "f32 1.5",             schema: model("f32"),           value: 1.5,                               expected: "09000000000000f83f" },
  { label: "string abc",          schema: model("string"),        value: "abc",                             expected: "0a03616263" },
  { label: "bytes 00ff",          schema: model("bytes"),         value: new Uint8Array([0, 255]),          expected: "0a0200ff" },
  // 16 raw bytes, not a 36-character string.
  { label: "uuid",                schema: model("uuid"),          value: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", expected: "0a103f2504e04f8911d39a0c0305e82c3301" },
  { label: "date",                schema: model("date"),          value: "2026-07-28",                      expected: "08b6a101" },
  { label: "time",                schema: model("time"),          value: "01:00:00",                        expected: "0880c0e285e368" },
  { label: "timestamp",           schema: model("timestamp"),     value: "2026-07-28T10:00:00.000Z",        expected: "0880f2aac1fa33" },
  { label: "duration",            schema: model("duration"),      value: 1500000000n,                       expected: "0880dea0cb05" },
  // Canonicalized to the declared scale.
  { label: "decimal 1.5",         schema: model("decimal(12,2)"), value: "1.5",                             expected: "0a04312e3530" },
  // JCS: object keys sorted before encoding.
  { label: "json",                schema: model("json"),          value: { b: 1, a: 2 },                    expected: "0a0d7b2261223a322c2262223a317d" },
  { label: "packed [i32]",        schema: model("[i32]"),         value: [1, 2, 300],                       expected: "0a040102ac02" },
  { label: "repeated [string]",   schema: model("[string]"),      value: ["a", "b"],                        expected: "0a01610a0162" },
  // A nullable array keeps [] and null distinct: an empty wrapper versus nothing.
  { label: "[i32]? empty",        schema: model("[i32]?"),        value: [],                                expected: "0a00" },
  { label: "[i32]? null",         schema: model("[i32]?"),        value: null,                              expected: "" },
  { label: "map sorted by key",   schema: model("{string: i32}"), value: new Map([["b", 2], ["a", 1]]),     expected: "0a050a016110010a050a01621002" },
];

describe("golden wire vectors", () => {
  for (const vector of VECTORS) {
    it(`encodes ${vector.label}`, async () => {
      const codec = await loadCodec(vector.schema);
      expect(hex(codec.encodeM({ v: vector.value }))).toBe(vector.expected);
    });

    it(`decodes ${vector.label}`, async () => {
      const codec = await loadCodec(vector.schema);
      const decoded = codec.decodeM(fromHex(vector.expected));
      expect(hex(codec.encodeM(decoded))).toBe(vector.expected);
    });
  }
});

describe("golden vectors for named types", () => {
  it("encodes an enum by its ordinal", async () => {
    const codec = await loadCodec("namespace t\nenum E { 1 a  7 b }\nmodel M { 1 v: E }");
    expect(hex(codec.encodeM({ v: 7 }))).toBe("0807");
  });

  it("encodes a nested message as a length-delimited body", async () => {
    const codec = await loadCodec("namespace t\nmodel I { 1 n: i32 }\nmodel M { 1 v: I }");
    expect(hex(codec.encodeM({ v: { n: 5 } }))).toBe("0a020805");
  });

  it("encodes a oneof as a nested message keyed by the variant ordinal", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 v: oneof { 1 a: string  2 b: i64 } }");
    expect(hex(codec.encodeM({ v: { kind: "b", b: 7n } }))).toBe("0a021007");
  });
});

describe("golden vector for a full record", () => {
  const CONTACT = `namespace t
enum Kind { 1 home  2 work }
model Geo { 1 lat: f64  2 lng: f64 }
model Contact {
  1 id: uuid
  2 name: string
  3 kind: Kind
  4 tags: [string]
  5 geo: Geo?
}`;

  const VALUE = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    name: "Ada",
    kind: 2,
    tags: ["a"],
    geo: { lat: 1.5, lng: 2.5 },
  };

  const EXPECTED =
    "0a103f2504e04f8911d39a0c0305e82c3301" + // 1 id    — 16 raw uuid bytes
    "1203416461" +                           // 2 name  — "Ada"
    "1802" +                                 // 3 kind  — work
    "220161" +                               // 4 tags  — ["a"]
    "2a12" +                                 // 5 geo   — 18-byte nested body
    "09000000000000f83f" +                   //     1 lat 1.5
    "110000000000000440";                    //     2 lng 2.5

  it("matches the frozen encoding", async () => {
    const codec = await loadCodec(CONTACT);
    expect(hex(codec.encodeContact(VALUE))).toBe(EXPECTED);
  });

  it("round-trips the frozen encoding unchanged", async () => {
    const codec = await loadCodec(CONTACT);
    expect(hex(codec.encodeContact(codec.decodeContact(fromHex(EXPECTED))))).toBe(EXPECTED);
  });
});
