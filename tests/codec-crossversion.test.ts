// tests/codec-crossversion.test.ts
//
// Multi-device sync means two app versions read and write the same rows. An
// older client must never destroy data a newer one wrote, and a schema widening
// must not change the bytes.

import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, hex, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const V1 = "namespace t\nmodel Note { 1 id: uuid  2 title: string }";
const V2 = `namespace t
enum Colour { 1 red  2 blue }
model Note { 1 id: uuid  2 title: string  3 body: string  4 pinned: bool  5 colour: Colour }`;

const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("read, edit, write on an older client", () => {
  it("preserves every field the newer schema added", async () => {
    const v1 = await loadCodec(V1);
    const v2 = await loadCodec(V2);

    const written = v2.encodeNote({ id: ID, title: "original", body: "text", pinned: true, colour: 2 });

    const atV1 = v1.decodeNote(written);
    expect(atV1.$unknown.map((f: any) => f.tag)).toEqual([3, 4, 5]);
    const rewritten = v1.encodeNote({ ...atV1, title: "edited" });

    const atV2 = v2.decodeNote(rewritten);
    expect(atV2.title).toBe("edited");
    expect(atV2.body).toBe("text");
    expect(atV2.pinned).toBe(true);
    expect(atV2.colour).toBe(2);
  });

  it("keeps the older client's re-encoding canonical", async () => {
    const v1 = await loadCodec(V1);
    const v2 = await loadCodec(V2);
    const written = v2.encodeNote({ id: ID, title: "t", body: "b", pinned: false, colour: 1 });
    const rewritten = v1.encodeNote(v1.decodeNote(written));
    expect(hex(v1.encodeNote(v1.decodeNote(rewritten)))).toBe(hex(rewritten));
  });

  it("carries no unknown bag when the schemas agree", async () => {
    const v1 = await loadCodec(V1);
    expect(v1.decodeNote(v1.encodeNote({ id: ID, title: "t" })).$unknown).toBeUndefined();
  });

  it("refuses an unknown field that collides with a declared tag", async () => {
    const v1 = await loadCodec(V1);
    const value = v1.decodeNote(v1.encodeNote({ id: ID, title: "t" }));
    value.$unknown = [{ tag: 2, wire: 2, raw: new Uint8Array([0x12, 0x00]) }];
    expect(() => v1.encodeNote(value)).toThrow(/tag 2/);
  });
});

describe("newer client reading older data", () => {
  it("defaults new nullable fields to null and new repeated fields to []", async () => {
    const v1 = await loadCodec("namespace t\nmodel N { 1 a: i32 }");
    const v2 = await loadCodec("namespace t\nmodel N { 1 a: i32  2 b: string?  3 c: [i32] }");
    const back = v2.decodeN(v1.encodeN({ a: 1 }));
    expect(back.b).toBeNull();
    expect(back.c).toEqual([]);
  });

  it("fails loudly when a new required field is absent", async () => {
    const v1 = await loadCodec("namespace t\nmodel N { 1 a: i32 }");
    const v2 = await loadCodec("namespace t\nmodel N { 1 a: i32  2 b: string }");
    expect(() => v2.decodeN(v1.encodeN({ a: 1 }))).toThrow(/'b' \(tag 2\)/);
  });

  // T? -> T is a narrowing; a row whose value was null must not decode silently.
  it("fails loudly when a nullable field became required and the value was null", async () => {
    const nullable = await loadCodec("namespace t\nmodel N { 1 a: i32  2 b: string? }");
    const required = await loadCodec("namespace t\nmodel N { 1 a: i32  2 b: string }");
    expect(() => required.decodeN(nullable.encodeN({ a: 1, b: null }))).toThrow(/'b' \(tag 2\)/);
  });
});

describe("widenings are byte no-ops", () => {
  async function encodeAs(type: string, value: unknown): Promise<string> {
    const codec = await loadCodec(`namespace t\nmodel W { 1 v: ${type} }`);
    return hex(codec.encodeW({ v: value }));
  }

  it("i8 to i64", async () => {
    expect(await encodeAs("i8", 5)).toBe(await encodeAs("i64", 5n));
  });

  it("u32 to i64", async () => {
    expect(await encodeAs("u32", 300)).toBe(await encodeAs("i64", 300n));
  });

  it("u8 to i16", async () => {
    expect(await encodeAs("u8", 200)).toBe(await encodeAs("i16", 200));
  });

  // f32 and f64 share one encoding precisely so this holds. Wire-type dispatch
  // could not deliver it for the packed repeated case below.
  it("f32 to f64", async () => {
    expect(await encodeAs("f32", 1.5)).toBe(await encodeAs("f64", 1.5));
  });

  it("f32 to f64 for a packed repeated field", async () => {
    const asF32 = await loadCodec("namespace t\nmodel W { 1 vs: [f32] }");
    const asF64 = await loadCodec("namespace t\nmodel W { 1 vs: [f64] }");
    expect(hex(asF32.encodeW({ vs: [1.5, 2.5] }))).toBe(hex(asF64.encodeW({ vs: [1.5, 2.5] })));
    expect(asF64.decodeW(asF32.encodeW({ vs: [1.5, 2.5] })).vs).toEqual([1.5, 2.5]);
  });

  it("T to T? leaves a present value's bytes unchanged", async () => {
    expect(await encodeAs("i32", 7)).toBe(await encodeAs("i32?", 7));
  });
});

describe("unknown variants", () => {
  it("preserves an enum value the older schema does not know", async () => {
    const v1 = await loadCodec("namespace t\nenum E { 1 a }\nmodel M { 1 e: E }");
    const v2 = await loadCodec("namespace t\nenum E { 1 a  2 b }\nmodel M { 1 e: E }");
    const written = v2.encodeM({ e: 2 });
    const atV1 = v1.decodeM(written);
    expect(atV1.e).toBe(2);
    expect(hex(v1.encodeM(atV1))).toBe(hex(written));
  });

  it("preserves a oneof variant the older schema does not know", async () => {
    const v1 = await loadCodec("namespace t\nmodel M { 1 p: oneof { 1 card: string } }");
    const v2 = await loadCodec("namespace t\nmodel M { 1 p: oneof { 1 card: string  2 crypto: string } }");

    const written = v2.encodeM({ p: { kind: "crypto", crypto: "btc" } });
    const atV1 = v1.decodeM(written);
    expect(atV1.p.kind).toBe("$unknown");

    const atV2 = v2.decodeM(v1.encodeM(atV1));
    expect(atV2.p).toEqual({ kind: "crypto", crypto: "btc" });
  });
});

describe("cross-version hash equality", () => {
  // Two clients on different schema versions writing the same logical row must
  // produce the same bytes, or a content hash cannot detect real changes.
  it("agrees on bytes when only shared fields are set", async () => {
    const v1 = await loadCodec(V1);
    const v2 = await loadCodec("namespace t\nmodel Note { 1 id: uuid  2 title: string  3 body: string? }");
    expect(hex(v1.encodeNote({ id: ID, title: "t" })))
      .toBe(hex(v2.encodeNote({ id: ID, title: "t", body: null })));
  });
});
