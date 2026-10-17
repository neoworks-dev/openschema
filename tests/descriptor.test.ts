// tests/descriptor.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";
import { DescriptorError } from "../src/emit/descriptor/errors";
import { facetTag } from "../src/emit/descriptor/tables";
import type { SchemaDescriptor } from "../src/emit/descriptor/descriptorTypes";

function describeSchema(body: string): SchemaDescriptor {
  const schema = resolve(parse(`namespace test.calendar\n${body}`));
  expect(schema.hasErrors).toBe(false);
  return buildDescriptor({ schema, company: null, includePrivate: false, options: {} });
}

function descriptorError(body: string): DescriptorError {
  try {
    describeSchema(body);
  } catch (error) {
    if (error instanceof DescriptorError) return error;
    throw error;
  }
  throw new Error("expected a DescriptorError");
}

const EVENT = `
@neoworks.table
model Event {
  1 title: string
  2 notes: string?
  @neoworks.facet("Availability")
  3 start: timestamp
  @neoworks.facet("Availability")
  4 end: timestamp
}

@neoworks.table
model Calendar {
  @neoworks.title
  1 name: string
}
`;

describe("registration", () => {
  it("writes schema.descriptor.json", () => {
    const schema = resolve(parse("namespace t\nmodel M { 1 a: i32 }"));
    const files = getEmitter("descriptor")!.emit({ schema, company: null, includePrivate: false, options: {} });
    expect(files.map(file => file.path)).toEqual(["schema.descriptor.json"]);
    expect(JSON.parse(files[0].contents).descriptorVersion).toBe(2);
  });
});

describe("models and enums", () => {
  it("describes each field's wire layout from the codec plan", () => {
    const descriptor = describeSchema("model M { 1 id: uuid  2 tags: [string]  3 counts: [i32]?  4 note: string? }");
    const fields = descriptor.models[0].fields;
    expect(fields.map(field => [field.ordinal, field.container.kind, field.required])).toEqual([
      [1, "singular", true],
      [2, "repeatedLen", false],
      [3, "wrapperRepeated", false],
      [4, "singular", false],
    ]);
    expect(fields[0].value).toEqual({ kind: "scalar", scalar: "uuid" });
  });

  it("lists enum variants with their ordinals", () => {
    const descriptor = describeSchema("enum Status { 1 tentative  2 confirmed }\nmodel M { 1 status: Status }");
    expect(descriptor.enums).toEqual([{ name: "Status", variants: [
      { name: "tentative", ordinal: 1 },
      { name: "confirmed", ordinal: 2 },
    ] }]);
    expect(descriptor.models[0].fields[0].value).toEqual({ kind: "enum", name: "Status" });
  });

  it("records the namespace", () => {
    expect(describeSchema("model M { 1 a: i32 }").namespace).toBe("test.calendar");
  });
});

describe("constraints", () => {
  it("reads the validation decorators", () => {
    const descriptor = describeSchema(`model M {
      @minValue(0) @maxValue(120) 1 age: i32
      @minLength(1) @maxLength(200) @pattern("^[a-z]+$") @format("slug") 2 slug: string
      @maxLength(3) 3 codes: [string]
    }`);
    const [age, slug, codes] = descriptor.models[0].fields;
    expect(age.constraints).toEqual({ minValue: 0, maxValue: 120 });
    expect(slug.constraints).toEqual({ minLength: 1, maxLength: 200, pattern: "^[a-z]+$", format: "slug" });
    expect(codes.constraints).toEqual({ maxLength: 3 });
  });

  it("rejects a constraint that cannot apply to the field's type", () => {
    expect(descriptorError("model M { @maxLength(3) 1 count: i32 }").code).toBe("OSD009");
    expect(descriptorError("model M { @minValue(1) 1 name: string }").code).toBe("OSD009");
  });

  it("rejects an invalid pattern or length", () => {
    expect(descriptorError('model M { @pattern("[") 1 name: string }').code).toBe("OSD009");
    expect(descriptorError("model M { @minLength(1.5) 1 name: string }").code).toBe("OSD009");
  });
});

describe("tables", () => {
  it("describes one table per marked model, any number per schema", () => {
    const descriptor = describeSchema(EVENT);
    expect(descriptor.tables.map(table => table.model)).toEqual(["Event", "Calendar"]);
  });

  it("puts fields without @neoworks.facet in the default facet with tag 1", () => {
    const event = describeSchema(EVENT).tables[0];
    expect(event.facets).toEqual([
      { name: "default", tag: 1, fields: [1, 2] },
      { name: "Availability", tag: facetTag("Availability"), fields: [3, 4] },
    ]);
  });

  it("derives facet tags from the name, within the encodable range", () => {
    const tag = facetTag("Availability");
    expect(tag).toBe(facetTag("Availability"));
    expect(tag).not.toBe(facetTag("Details"));
    expect(tag).toBeGreaterThan(1);
    expect(tag).toBeLessThan(536870911);
  });

  it("lists the sorted indexes of a table by field ordinal", () => {
    const descriptor = describeSchema(`
@neoworks.table
model Album { 1 name: string }

@neoworks.table
@neoworks.index(fields: ["album", "start"])
@neoworks.index(fields: ["start", "end"])
model Event {
  @belongsTo
  1 album: ref<Album>
  @neoworks.index
  2 start: timestamp
  3 end: timestamp
}`);
    expect(descriptor.tables[0].indexes).toEqual([]);
    expect(descriptor.tables[1].indexes).toEqual([{ fields: [1] }, { fields: [2] }, { fields: [1, 2] }, { fields: [2, 3] }]);
  });

  it("gives the @belongsTo field an index and keeps one a schema declares again", () => {
    const body = `@neoworks.table model A { 1 a: i32 }
@neoworks.table model B { @belongsTo @neoworks.index 1 a: ref<A>  2 b: i32 }`;
    expect(describeSchema(body).tables[1].indexes).toEqual([{ fields: [1] }]);
  });

  it("leaves ordinary models out of the table list", () => {
    expect(describeSchema("model M { 1 a: i32 }").tables).toEqual([]);
  });

  it("names the title field by ordinal", () => {
    const [event, calendar] = describeSchema(EVENT).tables;
    expect(event.title).toBeNull();
    expect(calendar.title).toBe(1);
  });
});

describe("references", () => {
  const PHOTOS = `
@neoworks.table
model Photo { 1 caption: string }

@neoworks.table
model Album { 1 name: string }

@neoworks.table
model AlbumPhoto {
  @belongsTo
  1 album: ref<Album>
  @onDelete("cascade")
  2 photo: ref<Photo>
  3 position: f64
  4 related: [ref<Photo>]?
}
`;

  it("describes a reference as its own value kind naming the target table", () => {
    const entry = describeSchema(PHOTOS).models.find(model => model.name === "AlbumPhoto")!;
    expect(entry.fields[0].value).toEqual({ kind: "ref", model: "test.calendar.Album" });
    expect(entry.fields[0].container).toEqual({ kind: "singular", nullable: false });
    expect(entry.fields[3].value).toEqual({ kind: "ref", model: "test.calendar.Photo" });
    expect(entry.fields[3].container.kind).toBe("wrapperRepeated");
  });

  it("names the field the row belongs to and the references it is deleted with", () => {
    const entry = describeSchema(PHOTOS).tables.find(table => table.model === "AlbumPhoto")!;
    expect(entry.belongsTo).toBe(1);
    expect(entry.cascade).toEqual([2]);
    const album = describeSchema(PHOTOS).tables.find(table => table.model === "Album")!;
    expect(album.belongsTo).toBeNull();
    expect(album.cascade).toEqual([]);
  });

  it("allows a row to belong to a row of its own table, or to nothing", () => {
    const folders = describeSchema("@neoworks.table model Folder { 1 name: string  @belongsTo 2 parent: ref<Folder>? }");
    expect(folders.tables[0].belongsTo).toBe(2);
  });

  it("rejects @belongsTo on anything but one single reference to a table of the schema", () => {
    const repeated = "@neoworks.table model A { 1 a: i32 }\n@neoworks.table model B { @belongsTo 1 a: [ref<A>] }";
    const twice = "@neoworks.table model A { 1 a: i32 }\n@neoworks.table model B { @belongsTo 1 a: ref<A>  @belongsTo 2 b: ref<A> }";
    const notReference = "@neoworks.table model B { @belongsTo 1 a: uuid }";
    const withCascade = '@neoworks.table model A { 1 a: i32 }\n@neoworks.table model B { @belongsTo @onDelete("cascade") 1 a: ref<A> }';
    expect(descriptorError(repeated).code).toBe("OSD011");
    expect(descriptorError(twice).code).toBe("OSD011");
    expect(descriptorError(notReference).code).toBe("OSD011");
    expect(descriptorError(withCascade).code).toBe("OSD011");
  });

  it("rejects @onDelete other than cascade on a reference", () => {
    const restrict = '@neoworks.table model A { 1 a: i32 }\n@neoworks.table model B { @onDelete("restrict") 1 a: ref<A> }';
    const notReference = '@neoworks.table model B { @onDelete("cascade") 1 a: string }';
    expect(descriptorError(restrict).code).toBe("OSD012");
    expect(descriptorError(notReference).code).toBe("OSD012");
  });

  it("rejects relation decorators outside a table", () => {
    expect(descriptorError("@neoworks.table model A { 1 a: i32 }\nmodel B { @belongsTo 1 a: ref<A> }").code).toBe("OSD004");
  });

  it("reports a reference to an unknown model or to a model that is not a table", () => {
    const unknown = resolve(parse("namespace t\nmodel M { 1 photo: ref<Missing> }"));
    expect(unknown.diagnostics.map(diagnostic => diagnostic.code)).toContain("OS1003");
    const plain = resolve(parse("namespace t\nmodel Plain { 1 a: i32 }\nmodel M { 1 photo: ref<Plain> }"));
    expect(plain.diagnostics.map(diagnostic => diagnostic.code)).toContain("OS1017");
  });

  it("types a reference as a string in the generated code", () => {
    const schema = resolve(parse(`namespace t\n${PHOTOS}`));
    const files = getEmitter("codec")!.emit({ schema, company: null, includePrivate: false, options: {} });
    expect(files[0].contents).toContain("photo: string");
  });
});

describe("table decorator errors", () => {
  it("rejects an unknown @neoworks decorator and the retired node marker", () => {
    expect(descriptorError("@neoworks.history model M { 1 a: i32 }").code).toBe("OSD001");
    expect(descriptorError('@neoworks.node("item") model M { 1 a: i32 }').code).toBe("OSD001");
  });

  it("rejects a table marker with arguments", () => {
    expect(descriptorError('@neoworks.table("item") model M { 1 a: i32 }').code).toBe("OSD002");
  });

  it("rejects a title that is not one single string or File field", () => {
    expect(descriptorError("@neoworks.table model M { @neoworks.title 1 a: [string] }").code).toBe("OSD010");
    expect(descriptorError("@neoworks.table model M { @neoworks.title 1 a: string  @neoworks.title 2 b: string }").code)
      .toBe("OSD010");
    expect(descriptorError("model M { @neoworks.title 1 a: string }").code).toBe("OSD004");
  });

  it("rejects facets and indexes on a model that is not a table", () => {
    expect(descriptorError('model M { @neoworks.facet("Private") 1 a: i32 }').code).toBe("OSD004");
    expect(descriptorError("model M { @neoworks.index 1 a: string }").code).toBe("OSD004");
    expect(descriptorError('@neoworks.index(fields: ["a"]) model M { 1 a: string }').code).toBe("OSD004");
  });

  it("rejects a facet named default or with invalid characters", () => {
    expect(descriptorError('@neoworks.table model M { @neoworks.facet("Default") 1 a: i32 }').code).toBe("OSD005");
    expect(descriptorError('@neoworks.table model M { @neoworks.facet("free busy") 1 a: i32 }').code).toBe("OSD005");
  });

  it("rejects an index over fields that cannot be sorted or do not exist", () => {
    const rejected = [
      "@neoworks.table model M { @neoworks.index 1 a: [string] }",
      "@neoworks.table model M { @neoworks.index 1 a: bytes }",
      "@neoworks.table model M { @neoworks.index 1 a: {string: i32} }",
      "@neoworks.table model M { @neoworks.index 1 a: File }",
      "@neoworks.table model M { @neoworks.index 1 a: Part }\nmodel Part { 1 x: i32 }",
      '@neoworks.table @neoworks.index(fields: ["b"]) model M { 1 a: i32 }',
      '@neoworks.table @neoworks.index(fields: ["a", "a"]) model M { 1 a: i32 }',
      '@neoworks.table @neoworks.index(fields: []) model M { 1 a: i32 }',
      '@neoworks.table @neoworks.index model M { 1 a: i32 }',
      '@neoworks.table @neoworks.index(fields: "a") model M { 1 a: i32 }',
      '@neoworks.table model M { @neoworks.index(fields: ["a"]) 1 a: i32 }',
      "@neoworks.table model M { @neoworks.index @neoworks.index 1 a: i32 }",
    ];
    for (const body of rejected) expect(descriptorError(body).code).toBe("OSD013");
  });

  it("names the replacement for the removed searchable and timeRange decorators", () => {
    const searchable = descriptorError("@neoworks.table model M { @neoworks.searchable 1 a: string }");
    const timeRange = descriptorError('@neoworks.table @neoworks.timeRange(start: "a", end: "b") model M { 1 a: timestamp  2 b: timestamp }');
    expect(searchable.code).toBe("OSD001");
    expect(searchable.message).toContain("was removed");
    expect(searchable.message).toContain("contains");
    expect(timeRange.code).toBe("OSD001");
    expect(timeRange.message).toContain("where");
  });
});
