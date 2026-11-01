// tests/abstract.test.ts
// @abstract models: shared bases that are never stored on their own. Each
// target renders them with the schema's own names only.

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { diff } from "../src/engine";
import { buildMigrationPlan } from "../src/engine/migration";
import { getMigrationEmitter } from "../src/emit/migration";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";
import { DescriptorError } from "../src/emit/descriptor/errors";
import { CodecUnsupportedError } from "../src/emit/codec/errors";

const MEDIA = `namespace t
@abstract model Record { @primaryKey 1 id: uuid }
@abstract model Media extends Record { 10 title: string  11 studio: ref<Studio>? }
model Video extends Media { 30 duration: f64? }
model Gallery extends Media { 30 count: i32 }
model Studio extends Record { 10 name: string }
model Item extends Record { 10 media: ref<Media>  11 inline: Media? }
@query op media(id: uuid): Media
`;

function emit(target: string, src: string = MEDIA): string {
  const schema = resolve(parse(src));
  expect(schema.hasErrors).toBe(false);
  return getEmitter(target)!.emit({ schema, company: null, includePrivate: false, options: {} })[0].contents;
}

function codes(src: string): string[] {
  return resolve(parse(src)).diagnostics.map(diagnostic => diagnostic.code);
}

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected an error");
}

describe("@abstract in the resolver", () => {
  it("rejects an abstract model as an operation input, directly or inside an input model (OS1020)", () => {
    expect(codes(`${MEDIA}\n@mutation op save(media: Media): bool`)).toContain("OS1020");
    expect(codes(`${MEDIA}\nmodel Wrapper { 1 media: Media }\n@mutation op save(wrapper: Wrapper): bool`)).toContain("OS1020");
    expect(codes(`${MEDIA}\n@mutation op save(media: ref<Media>): bool`)).not.toContain("OS1020");
  });

  it("warns about an abstract model nothing extends (OS1021)", () => {
    expect(codes("@abstract model Lonely { 1 a: i32 }")).toContain("OS1021");
    expect(codes(MEDIA)).not.toContain("OS1021");
  });
});

describe("@abstract in GraphQL", () => {
  it("renders interfaces that implement their abstract ancestors", () => {
    const out = emit("graphql");
    expect(out).toContain("interface Record {");
    expect(out).toContain("interface Media implements Record {");
    expect(out).toContain("type Video implements Media & Record {");
    expect(out).toContain("type Studio implements Record {");
    expect(out).toContain("  inline: Media\n");
    expect(out).toContain("media(id: UUID!): Media!");
  });
});

describe("@abstract in TypeScript and Zod", () => {
  it("ts: extends the abstract interface and lists only the added fields", () => {
    const out = emit("ts");
    expect(out).toContain("export interface Media extends Record {\n  title: string;\n  studio?: string;\n}");
    expect(out).toContain("export interface Video extends Media {\n  duration?: number;\n}");
  });

  it("ts: still flattens a plain base", () => {
    const out = emit("ts", "model Base { 1 a: i32 }  model Child extends Base { 2 b: i32 }");
    expect(out).toContain("export interface Child {\n  a: number;\n  b: number;\n}");
  });

  it("zod: extends the base schema, defined first, and parses an abstract value as any subtype", () => {
    const out = emit("zod");
    expect(out).toContain("export const VideoSchema = MediaSchema.extend({");
    expect(out.indexOf("export const MediaSchema")).toBeLessThan(out.indexOf("export const VideoSchema"));
    expect(out).toContain("inline: z.lazy(() => z.union([VideoSchema, GallerySchema])).nullish(),");
  });
});

describe("@abstract in JSON Schema, OpenAPI and Go", () => {
  it("json-schema: an abstract value is any of the concrete subtypes", () => {
    const item = JSON.parse(emit("json-schema")).$defs.Item;
    expect(item.properties.inline).toEqual({ anyOf: [{ $ref: "#/$defs/Video" }, { $ref: "#/$defs/Gallery" }] });
  });

  it("openapi: an abstract value is one of the concrete subtypes", () => {
    const schemas = JSON.parse(emit("openapi")).components.schemas;
    expect(schemas.Item.properties.inline).toEqual({
      oneOf: [{ $ref: "#/components/schemas/Video" }, { $ref: "#/components/schemas/Gallery" }],
    });
    expect(schemas.Media.properties.title).toEqual({ type: "string" });
  });

  it("go: embeds the nearest abstract base and holds an abstract value as any", () => {
    const out = emit("go");
    expect(out).toContain("type Media struct {\n\tRecord\n\tTitle  string");
    expect(out).toContain("type Video struct {\n\tMedia\n\tDuration *float64");
    expect(out).toContain("\tInline any    `json:\"inline,omitempty\"`");
  });
});

describe("@abstract in the database targets", () => {
  it("gives abstract models no table", () => {
    for (const target of ["sql", "sqlite", "surrealdb"]) {
      const out = emit(target);
      expect(out).not.toMatch(/TABLE "?(Record|Media)\b/);
      expect(out).toMatch(/TABLE "?Video\b/);
    }
  });

  it("sqlite: the DDL loads", () => {
    const db = new Database(":memory:");
    db.exec(emit("sqlite"));
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => (row as { name: string }).name))
      .toEqual(["Gallery", "Item", "Studio", "Video"]);
  });

  it("migrations drop the table of a model that becomes abstract", () => {
    const before = "model Base { @primaryKey 1 id: uuid }  model Child extends Base { 2 a: i32 }";
    const after = "@abstract model Base { @primaryKey 1 id: uuid }  model Child extends Base { 2 a: i32 }";
    const oldSchema = resolve(parse(before));
    const newSchema = resolve(parse(after));
    const plan = buildMigrationPlan(oldSchema, newSchema);
    expect(plan.ops.map(op => op.kind)).toEqual(["DropModel"]);
    const out = getMigrationEmitter("migration-sqlite")!.emit({ oldSchema, newSchema, plan, company: null, includePrivate: false })[0].contents;
    expect(out).toContain("DROP TABLE Base;");
  });

  it("the differ reports a model becoming or ceasing to be abstract as breaking (R021)", () => {
    const plain = "model Base { 1 id: uuid }";
    const abstract = "@abstract model Base { 1 id: uuid }";
    for (const [before, after] of [[plain, abstract], [abstract, plain]]) {
      const change = diff(before, after).changes.find(candidate => candidate.ruleId === "R021");
      expect(change?.severity).toBe("breaking_both");
    }
  });
});

describe("@abstract in the codec and descriptor", () => {
  it("codec: rejects a value typed as an abstract model (OSC009)", () => {
    const schema = resolve(parse(MEDIA));
    const error = thrownBy(() => getEmitter("codec")!.emit({ schema, company: null, includePrivate: false, options: {} }));
    expect(error).toBeInstanceOf(CodecUnsupportedError);
    expect((error as CodecUnsupportedError).code).toBe("OSC009");
  });

  it("descriptor: an abstract model cannot be a table (OSD015)", () => {
    const schema = resolve(parse("namespace t\n@abstract @neoworks.table model Base { 1 a: i32 }\n@neoworks.table model Child extends Base { 2 b: i32 }"));
    const error = thrownBy(() => buildDescriptor({ schema, company: null, includePrivate: false, options: {} }));
    expect(error).toBeInstanceOf(DescriptorError);
    expect((error as DescriptorError).code).toBe("OSD015");
  });
});
