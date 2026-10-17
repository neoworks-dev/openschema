// tests/codec-ref.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const ENTRIES = `namespace t
@neoworks.table
model Photo { 1 caption: string }

@neoworks.table
model Entry {
  1 photo: ref<Photo>
  2 related: [ref<Photo>]?
}`;

const PHOTO_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_ID = "9a1b2c3d-0000-4000-8000-000000000001";

function uuidBytes(id: string): number[] {
  return id.replaceAll("-", "").match(/../g)!.map(pair => parseInt(pair, 16));
}

describe("references", () => {
  it("encode as a Ref message holding the id, and decode to the id", async () => {
    const codec = await loadCodec(ENTRIES);
    const bytes = codec.encodeEntry({ photo: PHOTO_ID, related: [OTHER_ID] });
    expect([...bytes.subarray(0, 4)]).toEqual([0x0a, 18, 0x0a, 16]);
    expect([...bytes.subarray(4, 20)]).toEqual(uuidBytes(PHOTO_ID));
    expect(codec.decodeEntry(bytes)).toEqual({ photo: PHOTO_ID, related: [OTHER_ID] });
  });

  it("read past the key the Neoworks core stores beside the id", async () => {
    const codec = await loadCodec(ENTRIES);
    const key = new Array(32).fill(7);
    const reference = [0x0a, 16, ...uuidBytes(PHOTO_ID), 0x12, 32, ...key];
    const message = new Uint8Array([0x0a, reference.length, ...reference]);
    expect(codec.decodeEntry(message).photo).toBe(PHOTO_ID);
  });

  it("refuses a Ref without an id", async () => {
    const codec = await loadCodec(ENTRIES);
    expect(() => codec.decodeEntry(new Uint8Array([0x0a, 0]))).toThrow("required field 'id'");
  });
});
