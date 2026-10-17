// tests/file-type.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter, listTargets } from "../src/emit";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";
import { DescriptorError } from "../src/emit/descriptor/errors";
import type { SchemaDescriptor } from "../src/emit/descriptor/descriptorTypes";
import { cleanupCodecs, generateCodec, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const PHOTO = `namespace test.photos
@neoworks.node("item")
model Photo {
  @neoworks.title
  1 image: File
  2 picture: File?
  @neoworks.searchable
  3 attachments: [File]
  4 caption: string?
}`;

function describeSchema(body: string): SchemaDescriptor {
  const schema = resolve(parse(body));
  expect(schema.hasErrors).toBe(false);
  return buildDescriptor({ schema, company: null, includePrivate: false, options: {} });
}

function descriptorErrorCode(body: string): string {
  try {
    describeSchema(body);
  } catch (error) {
    if (error instanceof DescriptorError) return error.code;
    throw error;
  }
  throw new Error("expected a DescriptorError");
}

const SAMPLE_FILE = {
  objectId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  name: "anna.jpg",
  mediaType: "image/jpeg",
  size: 4194305n,
  variants: new Map([
    ["thumbnail", { objectId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", size: 1024n }],
    ["preview", { objectId: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", size: 2048n }],
  ]),
  key: Uint8Array.from({ length: 32 }, (_, offset) => offset),
};

describe("the File type", () => {
  it("is a field type, required, optional or repeated", () => {
    const fields = describeSchema(PHOTO).models[0].fields;
    expect(fields.map(field => [field.name, field.value.kind, field.container.kind, field.required])).toEqual([
      ["image", "file", "singular", true],
      ["picture", "file", "singular", false],
      ["attachments", "file", "repeatedLen", false],
      ["caption", "scalar", "singular", false],
    ]);
  });

  it("cannot be declared as a model, enum or alias", () => {
    const diagnostics = resolve(parse("namespace t\nmodel File { 1 a: i32 }")).diagnostics;
    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain("OS1018");
  });

  it("keeps a qualified name as a named type", () => {
    const schema = resolve(parse("namespace t\nmodel M { 1 a: other.File }"));
    expect(schema.diagnostics.map(diagnostic => diagnostic.code)).toContain("OS1003");
  });

  it("names the title and the searchable fields by ordinal", () => {
    const node = describeSchema(PHOTO).nodes[0];
    expect(node.title).toBe(1);
    expect(node.searchable).toEqual([3]);
  });

  it("allows @neoworks.searchable on a File but not a title on a repeated File", () => {
    const repeatedTitle = 'namespace t\n@neoworks.node("item") model M { @neoworks.title 1 a: [File] }';
    expect(descriptorErrorCode(repeatedTitle)).toBe("OSD010");
    const mapSearch = 'namespace t\n@neoworks.node("item") model M { @neoworks.searchable 1 a: {string: File} }';
    expect(descriptorErrorCode(mapSearch)).toBe("OSD007");
  });

  it("rejects validation decorators, which do not apply to a File", () => {
    const body = 'namespace t\nmodel M { @maxLength(10) 1 a: File }';
    expect(descriptorErrorCode(body)).toBe("OSD009");
  });

  it("is emitted by the API-surface and database targets", () => {
    const schema = resolve(parse(PHOTO));
    const apiTargets = listTargets().filter(target => !["codec", "descriptor", "collection", "versions"].includes(target));
    expect(apiTargets.length).toBeGreaterThanOrEqual(8);
    for (const target of apiTargets) {
      const emitter = getEmitter(target)!;
      expect(() => emitter.emit({ schema, company: null, includePrivate: false, options: {} })).not.toThrow();
    }
  });
});

describe("the File codec", () => {
  it("declares File and FileVariant once, only when a File is used", () => {
    expect(generateCodec(PHOTO)).toContain("export interface File {");
    expect(generateCodec(PHOTO)).toContain("export interface FileVariant {");
    expect(generateCodec("namespace t\nmodel M { 1 a: i32 }")).not.toContain("interface File");
  });

  it("rejects a model that collides with the variant message", () => {
    const source = "namespace t\nmodel FileVariant { 1 a: i32 }\nmodel M { 1 a: File }";
    expect(() => generateCodec(source)).toThrow("FileVariant");
  });

  it("round-trips a record with required, optional and repeated files", async () => {
    const codec = await loadCodec(PHOTO);
    const photo = { image: SAMPLE_FILE, attachments: [SAMPLE_FILE, { ...SAMPLE_FILE, variants: new Map() }] };

    const back = codec.decodePhoto(codec.encodePhoto(photo));

    expect(back.image).toEqual(SAMPLE_FILE);
    expect(back.image.key).toEqual(SAMPLE_FILE.key);
    expect(back.picture).toBeUndefined();
    expect(back.attachments).toHaveLength(2);
    expect(back.attachments[1].variants.size).toBe(0);
  });

  it("encodes a File by its fixed layout, variants sorted by name", async () => {
    const codec = await loadCodec(PHOTO);
    const reversed = { ...SAMPLE_FILE, variants: new Map([...SAMPLE_FILE.variants].reverse()) };

    const first = codec.encodeFile(SAMPLE_FILE);
    const second = codec.encodeFile(reversed);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(first[0]).toBe(0x0a);
  });

  it("rejects a decoded record that has no image", async () => {
    const codec = await loadCodec(PHOTO);
    expect(() => codec.decodePhoto(new Uint8Array())).toThrow();
  });
});
