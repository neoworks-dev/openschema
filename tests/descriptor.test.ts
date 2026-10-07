// tests/descriptor.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";
import { DescriptorError } from "../src/emit/descriptor/errors";
import { facetTag } from "../src/emit/descriptor/nodes";
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
@neoworks.node("item")
model Event {
  @neoworks.searchable
  1 title: string
  2 notes: string?
  @neoworks.facet("Availability")
  3 start: timestamp
  @neoworks.facet("Availability")
  4 end: timestamp
}

@neoworks.node("container")
model Calendar {
  1 name: string
}
`;

describe("registration", () => {
  it("writes schema.descriptor.json", () => {
    const schema = resolve(parse("namespace t\nmodel M { 1 a: i32 }"));
    const files = getEmitter("descriptor")!.emit({ schema, company: null, includePrivate: false, options: {} });
    expect(files.map(file => file.path)).toEqual(["schema.descriptor.json"]);
    expect(JSON.parse(files[0].contents).descriptorVersion).toBe(1);
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

describe("node models", () => {
  it("describes one node per marked model", () => {
    const descriptor = describeSchema(EVENT);
    expect(descriptor.nodes.map(node => [node.kind, node.model])).toEqual([["item", "Event"], ["container", "Calendar"]]);
  });

  it("puts fields without @neoworks.facet in the default facet with tag 1", () => {
    const event = describeSchema(EVENT).nodes[0];
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

  it("indexes searchable fields and the time range by ordinal", () => {
    const descriptor = describeSchema(EVENT.replace(
      '@neoworks.node("item")',
      '@neoworks.node("item") @neoworks.timeRange(start: "start", end: "end")',
    ));
    expect(descriptor.nodes[0].searchable).toEqual([1]);
    expect(descriptor.nodes[0].timeRange).toEqual({ start: 3, end: 4 });
  });

  it("leaves ordinary models out of the node list", () => {
    expect(describeSchema("model M { 1 a: i32 }").nodes).toEqual([]);
  });
});

describe("node decorator errors", () => {
  it("rejects an unknown @neoworks decorator", () => {
    expect(descriptorError("@neoworks.history model M { 1 a: i32 }").code).toBe("OSD001");
  });

  it("rejects an invalid node kind", () => {
    expect(descriptorError('@neoworks.node("leaf") model M { 1 a: i32 }').code).toBe("OSD002");
  });

  it("rejects two models for the same node kind", () => {
    expect(descriptorError('@neoworks.node("item") model A { 1 a: i32 }\n@neoworks.node("item") model B { 1 b: i32 }').code)
      .toBe("OSD003");
  });

  it("rejects facets and indexes on a model that is not a node", () => {
    expect(descriptorError('model M { @neoworks.facet("Private") 1 a: i32 }').code).toBe("OSD004");
    expect(descriptorError("model M { @neoworks.searchable 1 a: string }").code).toBe("OSD004");
  });

  it("rejects a facet named default or with invalid characters", () => {
    expect(descriptorError('@neoworks.node("item") model M { @neoworks.facet("Default") 1 a: i32 }').code).toBe("OSD005");
    expect(descriptorError('@neoworks.node("item") model M { @neoworks.facet("free busy") 1 a: i32 }').code).toBe("OSD005");
  });

  it("rejects @neoworks.searchable on a field that is not a string", () => {
    expect(descriptorError('@neoworks.node("item") model M { @neoworks.searchable 1 a: i32 }').code).toBe("OSD007");
  });

  it("rejects a time range over unknown fields, non-timestamps or two facets", () => {
    const unknownField = '@neoworks.node("item") @neoworks.timeRange(start: "from", end: "to") model M { 1 a: timestamp }';
    const notTimestamp = '@neoworks.node("item") @neoworks.timeRange(start: "a", end: "b") model M { 1 a: string  2 b: timestamp }';
    const twoFacets = `@neoworks.node("item") @neoworks.timeRange(start: "a", end: "b")
      model M { 1 a: timestamp  @neoworks.facet("Other") 2 b: timestamp }`;
    expect(descriptorError(unknownField).code).toBe("OSD008");
    expect(descriptorError(notTimestamp).code).toBe("OSD008");
    expect(descriptorError(twoFacets).code).toBe("OSD008");
  });
});
