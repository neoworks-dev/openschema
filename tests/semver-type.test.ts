// tests/semver-type.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";
import { compareTypes } from "../src/engine/type-compat";
import { encodingSignatureOf } from "../src/emit/codec/wireFormat";
import { cleanupCodecs, fromHex, generateCodec, hex, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const RELEASE = `namespace t
model Release {
  1 version: semver
  2 previous: semver?
  3 history: [semver]
}`;

function emit(target: string, source: string): string {
  const schema = resolve(parse(source));
  expect(schema.hasErrors).toBe(false);
  return getEmitter(target)!.emit({ schema, company: null, includePrivate: false, options: {} })[0].contents;
}

function scalar(name: "semver" | "string" | "u32") {
  return { kind: "scalar" as const, scalar: name, span: { line: 0, col: 0 } };
}

describe("the semver type", () => {
  it("resolves as a scalar", () => {
    const model = resolve(parse(RELEASE)).records.get("t.Release")!;
    expect(model.fields[0].type).toMatchObject({ kind: "scalar", scalar: "semver" });
  });

  it("is incompatible with every other type", () => {
    expect(compareTypes(scalar("semver"), scalar("semver"))).toBe("same");
    expect(compareTypes(scalar("string"), scalar("semver"))).toBe("incompatible");
    expect(compareTypes(scalar("semver"), scalar("u32"))).toBe("incompatible");
  });

  it("encodes as a singular LEN field and repeats one key per element", () => {
    const schema = resolve(parse(RELEASE));
    expect(encodingSignatureOf(scalar("semver"), schema)).toBe("singular:len");
    const history = schema.records.get("t.Release")!.fields[2].type;
    expect(encodingSignatureOf(history, schema)).toBe("repeated:len-element");
  });

  it("is a scalar in the descriptor", () => {
    const schema = resolve(parse(RELEASE));
    const descriptor = buildDescriptor({ schema, company: null, includePrivate: false, options: {} });
    expect(descriptor.models[0].fields[0].value).toEqual({ kind: "scalar", scalar: "semver" });
  });

  it("is three numbers in TypeScript and Zod", () => {
    expect(emit("ts", RELEASE)).toContain("version: { major: number; minor: number; patch: number };");
    expect(emit("zod", RELEASE)).toContain("major: z.number().int().nonnegative()");
  });

  it("is the text major.minor.patch in JSON Schema, OpenAPI, GraphQL and Go", () => {
    const jsonSchema = JSON.parse(emit("json-schema", RELEASE));
    const pattern = new RegExp(jsonSchema.$defs.Release.properties.version.pattern);
    expect(pattern.test("0.6.1")).toBe(true);
    expect(pattern.test("01.6.1")).toBe(false);
    expect(pattern.test("1.0.0-beta.2")).toBe(false);
    expect(emit("openapi", RELEASE)).toContain("(0|[1-9][0-9]*)");
    expect(emit("graphql", RELEASE)).toContain("scalar Semver");
    expect(emit("graphql", RELEASE)).toContain("version: Semver!");
    expect(emit("go", RELEASE)).toContain("Version string `json:\"version\"`");
  });
});

describe("the semver codec", () => {
  it("carries the semver runtime only when a field holds a semver", () => {
    expect(generateCodec(RELEASE)).toContain("function writeSemver(");
    expect(generateCodec("namespace t\nmodel M { 1 v: oneof { 1 version: semver  2 note: string } }")).toContain("function readSemverField(");
    expect(generateCodec("namespace t\nmodel M { 1 a: i32 }")).not.toContain("Semver");
  });

  it("writes a tag, a length and three varints", async () => {
    const codec = await loadCodec(RELEASE);
    const bytes = codec.encodeRelease({ version: { major: 0, minor: 6, patch: 1 }, history: [] });
    expect(hex(bytes)).toBe("0a03000601");
  });

  it("writes parts above 127 as multi-byte varints", async () => {
    const codec = await loadCodec(RELEASE);
    const bytes = codec.encodeRelease({ version: { major: 1, minor: 300, patch: 0 }, history: [] });
    expect(hex(bytes)).toBe("0a0401ac0200");
  });

  it("round-trips optional and repeated versions", async () => {
    const codec = await loadCodec(RELEASE);
    const release = {
      version: { major: 1, minor: 0, patch: 0 },
      previous: { major: 0, minor: 9, patch: 12 },
      history: [{ major: 0, minor: 1, patch: 0 }, { major: 4294967295, minor: 0, patch: 0 }],
    };
    expect(codec.decodeRelease(codec.encodeRelease(release))).toEqual(release);
  });

  it("round-trips versions in maps, oneofs and nullable lists", async () => {
    const codec = await loadCodec(
      "namespace t\nmodel M { 1 byName: {string: semver}  2 pick: oneof { 1 version: semver  2 note: string }?  3 maybe: [semver]? }");
    const value = {
      byName: new Map([["app", { major: 2, minor: 1, patch: 0 }]]),
      pick: { kind: "version", version: { major: 0, minor: 0, patch: 7 } },
      maybe: [],
    };
    expect(codec.decodeM(codec.encodeM(value))).toEqual(value);
  });

  it("rejects parts that are negative, fractional or wider than 32 bits", async () => {
    const codec = await loadCodec(RELEASE);
    for (const major of [-1, 1.5, 4294967296]) {
      expect(() => codec.encodeRelease({ version: { major, minor: 0, patch: 0 }, history: [] })).toThrow("semver part");
    }
  });

  it("rejects a body that does not hold exactly three varints", async () => {
    const codec = await loadCodec(RELEASE);
    expect(() => codec.decodeRelease(fromHex("0a020006"))).toThrow("exactly three");
    expect(() => codec.decodeRelease(fromHex("0a0400060100"))).toThrow("exactly three");
    expect(() => codec.decodeRelease(fromHex("0a0700008080808010"))).toThrow("semver part");
  });

  it("rejects a semver read with the wrong wire type", async () => {
    const codec = await loadCodec(RELEASE);
    expect(() => codec.decodeRelease(fromHex("0801"))).toThrow();
  });
});
