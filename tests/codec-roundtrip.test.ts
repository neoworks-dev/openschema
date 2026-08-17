// tests/codec-roundtrip.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const SCALARS = `namespace t
model S {
  1 flag: bool
  2 small: i32
  3 big: i64
  4 unsignedSmall: u32
  5 unsignedBig: u64
  6 ratio: f64
  7 label: string
  8 blob: bytes
  9 id: uuid
  10 payload: json
  11 day: date
  12 clock: time
  13 moment: timestamp
  14 span: duration
  15 amount: decimal(12,2)
}`;

const SAMPLE = {
  flag: true,
  small: -2147483648,
  big: 9007199254740993n,
  unsignedSmall: 4294967295,
  unsignedBig: 18446744073709551615n,
  ratio: -0.5,
  label: "hello ✨",
  blob: new Uint8Array([0, 1, 255]),
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  payload: { b: 1, a: [1, 2] },
  day: "2026-07-28",
  clock: "13:45:06.000000123",
  moment: "2026-07-28T10:00:00.000Z",
  span: -1500000000n,
  amount: "1.50",
};

describe("scalar round-trip", () => {
  it("preserves every scalar exactly", async () => {
    const codec = await loadCodec(SCALARS);
    const back = codec.decodeS(codec.encodeS(SAMPLE));

    for (const key of Object.keys(SAMPLE)) {
      if (key === "blob" || key === "payload") continue;
      expect(back[key]).toEqual((SAMPLE as any)[key]);
    }
    expect([...back.blob]).toEqual([0, 1, 255]);
    expect(back.payload).toEqual({ a: [1, 2], b: 1 });
  });

  // The reason i64/u64 map to bigint rather than number.
  it("keeps 64-bit integers exact above 2^53", async () => {
    const codec = await loadCodec(SCALARS);
    const back = codec.decodeS(codec.encodeS(SAMPLE));
    expect(back.big).toBe(9007199254740993n);
    expect(back.unsignedBig).toBe(18446744073709551615n);
  });

  it("normalizes a uuid to lowercase and encodes it as 16 bytes", async () => {
    const codec = await loadCodec("namespace t\nmodel S { 1 id: uuid }");
    const bytes = codec.encodeS({ id: "3F2504E0-4F89-11D3-9A0C-0305E82C3301" });
    expect(codec.decodeS(bytes).id).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(bytes.length).toBe(18); // key + length + 16 raw bytes
  });

  it("pads a decimal to its declared scale", async () => {
    const codec = await loadCodec("namespace t\nmodel S { 1 amount: decimal(12,2) }");
    expect(codec.decodeS(codec.encodeS({ amount: "1.5" })).amount).toBe("1.50");
  });

  it("rejects a decimal with more fraction digits than the scale", async () => {
    const codec = await loadCodec("namespace t\nmodel S { 1 amount: decimal(12,2) }");
    expect(() => codec.encodeS({ amount: "1.234" })).toThrow(/scale is 2/);
  });
});

describe("presence", () => {
  const PRESENCE = "namespace t\nmodel P { 1 n: i32  2 s: string  3 b: bool  4 opt: i32? }";

  // Zero, empty string, and false are values, not absence.
  it("preserves falsy values rather than treating them as absent", async () => {
    const codec = await loadCodec(PRESENCE);
    const back = codec.decodeP(codec.encodeP({ n: 0, s: "", b: false, opt: 0 }));
    expect(back.n).toBe(0);
    expect(back.s).toBe("");
    expect(back.b).toBe(false);
    expect(back.opt).toBe(0);
  });

  it("omits an absent optional and decodes it back to undefined", async () => {
    const codec = await loadCodec(PRESENCE);
    const withAbsent = codec.encodeP({ n: 1, s: "x", b: true, opt: undefined });
    const withZero = codec.encodeP({ n: 1, s: "x", b: true, opt: 0 });
    expect(withAbsent.length).toBeLessThan(withZero.length);
    expect(codec.decodeP(withAbsent).opt).toBeUndefined();
  });

  it("throws naming the model, field, and tag when a required field is absent", async () => {
    const codec = await loadCodec(PRESENCE);
    const partial = await loadCodec("namespace t\nmodel P { 1 n: i32 }");
    expect(() => codec.decodeP(partial.encodeP({ n: 5 }))).toThrow(/'s' \(tag 2\)/);
  });
});

describe("containers", () => {
  it("round-trips packed and unpacked repeated fields", async () => {
    const codec = await loadCodec("namespace t\nmodel C { 1 ns: [i32]  2 ss: [string] }");
    const back = codec.decodeC(codec.encodeC({ ns: [1, -2, 300], ss: ["a", "b"] }));
    expect(back.ns).toEqual([1, -2, 300]);
    expect(back.ss).toEqual(["a", "b"]);
  });

  it("round-trips an empty repeated field", async () => {
    const codec = await loadCodec("namespace t\nmodel C { 1 ns: [i32] }");
    expect(codec.decodeC(codec.encodeC({ ns: [] })).ns).toEqual([]);
  });

  // The user-chosen semantics: an optional array keeps absent and [] distinct.
  it("keeps absent and [] distinct for an optional array", async () => {
    const codec = await loadCodec("namespace t\nmodel C { 1 ns: [i32]? }");
    expect(codec.decodeC(codec.encodeC({ ns: undefined })).ns).toBeUndefined();
    expect(codec.decodeC(codec.encodeC({ ns: [] })).ns).toEqual([]);
    expect(codec.decodeC(codec.encodeC({ ns: [7] })).ns).toEqual([7]);
  });

  it("round-trips a map and an optional map", async () => {
    const codec = await loadCodec("namespace t\nmodel C { 1 m: {string: i32}  2 o: {string: string}? }");
    const back = codec.decodeC(codec.encodeC({
      m: new Map([["a", 1], ["b", 2]]),
      o: undefined,
    }));
    expect([...back.m.entries()]).toEqual([["a", 1], ["b", 2]]);
    expect(back.o).toBeUndefined();
  });

  it("round-trips integer map keys", async () => {
    const codec = await loadCodec("namespace t\nmodel C { 1 m: {i32: string} }");
    const back = codec.decodeC(codec.encodeC({ m: new Map([[2, "b"], [1, "a"]]) }));
    expect([...back.m.entries()]).toEqual([[1, "a"], [2, "b"]]);
  });
});

describe("nested and recursive messages", () => {
  it("round-trips a nested message", async () => {
    const codec = await loadCodec("namespace t\nmodel Geo { 1 lat: f64 }\nmodel M { 1 geo: Geo?  2 all: [Geo] }");
    const back = codec.decodeM(codec.encodeM({ geo: { lat: 1.5 }, all: [{ lat: 2.5 }] }));
    expect(back.geo.lat).toBe(1.5);
    expect(back.all[0].lat).toBe(2.5);
  });

  it("round-trips a self-recursive message", async () => {
    const codec = await loadCodec("namespace t\nmodel Node { 1 name: string  2 child: Node? }");
    const back = codec.decodeNode(codec.encodeNode({
      name: "a", child: { name: "b", child: { name: "c", child: undefined } },
    }));
    expect(back.child.child.name).toBe("c");
    expect(back.child.child.child).toBeUndefined();
  });

  it("round-trips mutually recursive messages", async () => {
    const codec = await loadCodec("namespace t\nmodel A { 1 b: B? }\nmodel B { 1 a: A? }");
    const back = codec.decodeA(codec.encodeA({ b: { a: { b: undefined } } }));
    expect(back.b.a.b).toBeUndefined();
  });
});

describe("enums and oneofs", () => {
  it("round-trips an enum by ordinal", async () => {
    const codec = await loadCodec("namespace t\nenum E { 1 red  7 blue }\nmodel M { 1 e: E }");
    expect(codec.decodeM(codec.encodeM({ e: codec.E.blue })).e).toBe(7);
  });

  it("round-trips each oneof arm", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 p: oneof { 1 card: string  2 cash: i64 } }");
    expect(codec.decodeM(codec.encodeM({ p: { kind: "card", card: "x" } })).p)
      .toEqual({ kind: "card", card: "x" });
    expect(codec.decodeM(codec.encodeM({ p: { kind: "cash", cash: -5n } })).p)
      .toEqual({ kind: "cash", cash: -5n });
  });
});

describe("malformed input", () => {
  it("rejects a truncated buffer", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 s: string }");
    const bytes = codec.encodeM({ s: "hello" });
    expect(() => codec.decodeM(bytes.subarray(0, bytes.length - 2))).toThrow();
  });

  it("rejects an overlong varint", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 n: i32 }");
    const bogus = new Uint8Array([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => codec.decodeM(bogus)).toThrow(/varint/);
  });

  it("rejects a group wire type", async () => {
    const codec = await loadCodec("namespace t\nmodel M { 1 n: i32 }");
    // tag 2, wire type 3 (SGROUP)
    expect(() => codec.decodeM(new Uint8Array([0x13]))).toThrow(/wire type/);
  });
});
