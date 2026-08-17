// tests/emit-targets.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";

function emit(target: string, src: string, company: string | null = null): string {
  const schema = resolve(parse(src));
  const files = getEmitter(target)!.emit({ schema, company, includePrivate: false, options: {} });
  return files[0].contents;
}

// `T?` (absent) and `T | null` (present, holding null) are separate things.
// Targets whose type system has both keep them apart; the rest collapse them.
describe("the null type", () => {
  const SRC = `namespace t
model R {
  1 required: string
  2 optional: string?
  3 maybeNull: string | null
  4 both: (string | null)?
}`;

  it("ts: keeps optional and nullable distinct", () => {
    const out = emit("ts", SRC);
    expect(out).toContain("required: string;");
    expect(out).toContain("optional?: string;");
    expect(out).toContain("maybeNull: string | null;");
    expect(out).toContain("both?: string | null;");
  });

  // The wire format models presence, not null: an absent tag is the only way to
  // say "no value", so the null arm carries no information and is dropped.
  it("codec: ignores the null arm", () => {
    const out = emit("codec", SRC);
    expect(out).toContain("required: string;");
    expect(out).toContain("optional?: string;");
    expect(out).toContain("maybeNull: string;");
    expect(out).toContain("both?: string;");
  });

  // GraphQL has one concept for both, so `T | null` is simply a nullable field.
  it("graphql: renders a nullable field rather than JSON", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("required: String!");
    expect(out).toContain("maybeNull: String");
    expect(out).toContain("both: String");
    expect(out).not.toContain("maybeNull: JSON");
  });

  it("json-schema: admits the null type", () => {
    const out = emit("json-schema", SRC);
    expect(out).toContain('"type": "null"');
  });
});

describe("typescript emitter", () => {
  // Enums emit as string unions of the variant names, not numeric enums — this
  // target is a JSON-serialized DTO surface, so the name is what travels. The
  // codec target keeps numeric enums, where the ordinal is the wire encoding.
  it("emits an interface and an enum", () => {
    const out = emit("ts", "enum S { 1 a  2 b }  model R { 1 x: i32  2 s: S }");
    expect(out).toContain("export type S =");
    expect(out).toContain('| "a"');
    expect(out).toContain('| "b"');
    expect(out).toContain("export interface R {");
    expect(out).toContain("x: number;");
  });

  // `T?` means absent, i.e. undefined — an optional property, not a null union.
  it("makes nullable fields optional properties", () => {
    const out = emit("ts", "model R { 1 a: string?  2 b: [i32] }");
    expect(out).toContain("a?: string;");
    expect(out).toContain("b: number[];");
  });

  it("emits generic type parameters", () => {
    const out = emit("ts", "model Page<T> { 1 items: [T] }");
    expect(out).toContain("export interface Page<T> {");
    expect(out).toContain("items: T[];");
  });

  it("maps the json scalar to unknown", () => {
    const out = emit("ts", "model R { 1 meta: json  2 opt: json? }");
    expect(out).toContain("meta: unknown;");
    expect(out).toContain("opt?: unknown;");
  });

  it("parenthesises array elements that are unions", () => {
    const out = emit("ts", "model A { 1 x: i32 }  model B { 1 y: i32 }  model R { 1 items: [A | B] }");
    expect(out).toContain("items: (A | B)[];");
  });
});

describe("go emitter", () => {
  it("emits a struct with json tags", () => {
    const out = emit("go", "model User { 1 displayName: string }");
    expect(out).toContain("package schema");
    expect(out).toContain("type User struct {");
    expect(out).toContain('DisplayName string `json:"displayName"`');
  });

  it("uses pointers and omitempty for nullable fields", () => {
    const out = emit("go", "model R { 1 a: string? }");
    expect(out).toContain('A *string `json:"a,omitempty"`');
  });

  it("emits enum constants", () => {
    const out = emit("go", "enum Status { 1 pending  2 shipped }");
    expect(out).toContain("type Status int32");
    expect(out).toContain("StatusPending Status = 1");
  });

  it("maps the json scalar to any", () => {
    const out = emit("go", "model R { 1 meta: json }");
    expect(out).toContain('Meta any `json:"meta"`');
  });
});

describe("json-schema emitter", () => {
  it("emits $defs with required and formats", () => {
    const out = emit("json-schema", 'model R { @format("email") 1 e: string  2 maybe: i32? }');
    const doc = JSON.parse(out);
    const r = doc.$defs.R;
    expect(r.properties.e.format).toBe("email");
    expect(r.required).toContain("e");
    expect(r.required).not.toContain("maybe");
  });

  it("maps numeric and length decorators to keywords", () => {
    const out = emit("json-schema", "model R { @minValue(0) @maxValue(10) 1 n: i32 }");
    const doc = JSON.parse(out);
    expect(doc.$defs.R.properties.n.minimum).toBe(0);
    expect(doc.$defs.R.properties.n.maximum).toBe(10);
  });

  it("references records and enums via $ref", () => {
    const out = emit("json-schema", "enum S { 1 a }  model R { 1 s: S }");
    const doc = JSON.parse(out);
    expect(doc.$defs.R.properties.s.$ref).toBe("#/$defs/S");
  });

  it("maps the json scalar to an unconstrained schema", () => {
    const out = emit("json-schema", "model R { 1 meta: json }");
    const doc = JSON.parse(out);
    expect(doc.$defs.R.properties.meta).toEqual({});
  });
});

describe("graphql emitter", () => {
  const SRC = `
    enum Status { 1 pending  2 shipped }
    model Order { 1 id: uuid  2 status: Status  3 note: string? }
    @query op getOrder(id: uuid): Order
    @mutation op placeOrder(order: Order): Order
  `;

  it("inverts nullability (non-null gets !)", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("id: UUID!");
    expect(out).toContain("note: String");
    expect(out).not.toContain("note: String!");
  });

  it("emits Query and Mutation roots from operations", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("type Query {");
    expect(out).toContain("getOrder(id: UUID!): Order!");
    expect(out).toContain("type Mutation {");
    expect(out).toContain("placeOrder(order: OrderInput!): Order!");
  });

  it("emits an input type for records used as operation parameters", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("input OrderInput {");
  });

  it("maps the json scalar to the JSON scalar type", () => {
    const out = emit("graphql", "model R { 1 meta: json }");
    expect(out).toContain("scalar JSON");
    expect(out).toContain("meta: JSON!");
  });

  it("keeps enums un-suffixed in input position", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("status: Status!");
    expect(out).not.toContain("StatusInput");
  });
});

describe("openapi emitter", () => {
  const SRC = `
    namespace shop
    model User {
      @visibility("read")
      1 id: uuid
      @visibility("create", "read")
      2 name: string
      @visibility("create", "update")
      3 password: string
    }
    @get @route("/users/{id}") op getUser(id: uuid): User
    @get @route("/users") op listUsers(active: bool): [User]
    @post @route("/users") op createUser(user: User): User
  `;

  function doc(src: string): any {
    return JSON.parse(emit("openapi", src));
  }

  it("emits a valid OpenAPI 3 document shell", () => {
    const d = doc(SRC);
    expect(d.openapi).toBe("3.0.3");
    expect(d.info.title).toBe("shop API");
  });

  it("maps @route and method decorators to paths", () => {
    const d = doc(SRC);
    expect(d.paths["/users/{id}"].get.operationId).toBe("getUser");
    expect(d.paths["/users"].get.operationId).toBe("listUsers");
    expect(d.paths["/users"].post.operationId).toBe("createUser");
  });

  it("turns {id} into a required path parameter", () => {
    const param = doc(SRC).paths["/users/{id}"].get.parameters[0];
    expect(param).toMatchObject({ name: "id", in: "path", required: true });
  });

  it("turns non-path GET params into query parameters", () => {
    const param = doc(SRC).paths["/users"].get.parameters[0];
    expect(param).toMatchObject({ name: "active", in: "query" });
  });

  it("uses the Input schema for a POST request body", () => {
    const body = doc(SRC).paths["/users"].post.requestBody;
    expect(body.content["application/json"].schema.$ref).toBe("#/components/schemas/UserInput");
  });

  it("references the output schema in responses", () => {
    const resp = doc(SRC).paths["/users/{id}"].get.responses["200"];
    expect(resp.content["application/json"].schema.$ref).toBe("#/components/schemas/User");
  });

  it("applies visibility: output has read fields, input has create/update fields", () => {
    const schemas = doc(SRC).components.schemas;
    expect(Object.keys(schemas.User.properties).sort()).toEqual(["id", "name"]);
    expect(Object.keys(schemas.UserInput.properties).sort()).toEqual(["name", "password"]);
  });

  it("defaults method to GET and path to /opName without decorators", () => {
    const d = doc("model M { 1 x: i32 }  op ping(): M");
    expect(d.paths["/ping"].get.operationId).toBe("ping");
  });
});

describe("graphql visibility", () => {
  const SRC = `
    model User {
      @visibility("read")
      1 id: uuid

      @visibility("create", "read")
      2 name: string

      @visibility("create", "update")
      3 password: string

      @invisible
      4 internalNotes: string?
    }
    @mutation op createUser(user: User): User
  `;

  it("output type shows only read-visible fields", () => {
    const out = emit("graphql", SRC);
    const objectType = out.slice(out.indexOf("type User {"), out.indexOf("input"));
    expect(objectType).toContain("id: UUID!");
    expect(objectType).toContain("name: String!");
    expect(objectType).not.toContain("password");
    expect(objectType).not.toContain("internalNotes");
  });

  it("input type shows only create/update-visible fields", () => {
    const out = emit("graphql", SRC);
    const inputType = out.slice(out.indexOf("input UserInput {"), out.indexOf("type Query"));
    expect(inputType).toContain("name: String!");
    expect(inputType).toContain("password: String!");
    expect(inputType).not.toContain("id:");        // read-only — not sent on create
    expect(inputType).not.toContain("internalNotes");
  });

  it("a field with no visibility appears in both", () => {
    const out = emit("graphql", "model M { 1 plain: string }  @mutation op m(x: M): M");
    expect(out).toContain("type M {\n  plain: String!");
    expect(out).toContain("input MInput {\n  plain: String!");
  });
});

describe("overlay across all targets", () => {
  const SRC = "model Person { 1 name: string }  overlay acme on Person { 1 spamScore: f32 }";

  it("includes the company overlay field in ts", () => {
    expect(emit("ts", SRC, "acme")).toContain("spamScore: number;");
  });

  it("includes the company overlay field in graphql", () => {
    expect(emit("graphql", SRC, "acme")).toContain("spamScore: Float!");
  });
});

describe("@input decorator", () => {
  // Model-level @input: a search filter that is input-only.
  const MODEL_SRC = `
    @input model ContactFilter { 1 name: string?  2 city: string? }
    model Contact { 1 id: uuid  2 name: string }
    @query op contacts(filter: ContactFilter?): [Contact]
  `;

  it("graphql: an @input model emits as an input, not an output type", () => {
    const out = emit("graphql", MODEL_SRC);
    expect(out).toContain("input ContactFilter {");
    expect(out).not.toContain("type ContactFilter {");
    // Bare name, no double Input suffix, and referenced bare in the operation.
    expect(out).not.toContain("ContactFilterInput");
    expect(out).toContain("contacts(filter: ContactFilter): [Contact!]!");
  });

  it("sql: an @input model produces no table", () => {
    const out = emit("sql", MODEL_SRC);
    expect(out).toContain("CREATE TABLE contact (");
    expect(out).not.toContain("contact_filter");
  });

  it("surrealdb: an @input model produces no table", () => {
    const out = emit("surrealdb", MODEL_SRC);
    expect(out).toContain("DEFINE TABLE contact SCHEMAFULL;");
    expect(out).not.toContain("contact_filter");
  });

  it("openapi: an @input model has only an input schema (bare name)", () => {
    const doc = JSON.parse(emit("openapi", `
      namespace shop
      @input model ContactFilter { 1 name: string? }
      model Contact { 1 id: uuid }
      @post @route("/search") op search(filter: ContactFilter): [Contact]
    `));
    expect(doc.components.schemas.ContactFilter).toBeDefined();
    expect(doc.components.schemas.ContactFilterInput).toBeUndefined();
  });

  // Field-level @input: a write-only field present in inputs, absent from output.
  const FIELD_SRC = `
    model Contact {
      @visibility("read") 1 id: uuid
      2 name: string
      @input 3 password: string
    }
    @mutation op createContact(c: Contact): Contact
  `;

  it("graphql: a read-only field's type does not become an orphan input", () => {
    const out = emit("graphql", `
      model Relation { 1 target: uuid }
      model Contact {
        @visibility("read") 1 id: uuid
        2 name: string
        @visibility("read") 3 links: [Relation]
      }
      @mutation op createContact(c: Contact): Contact
    `);
    expect(out).toContain("input ContactInput {");
    expect(out).not.toContain("input RelationInput");
  });

  it("graphql: a field-level @input is input-only (write-only)", () => {
    const out = emit("graphql", FIELD_SRC);
    const objectType = out.slice(out.indexOf("type Contact {"), out.indexOf("input ContactInput"));
    expect(objectType).not.toContain("password");
    const inputType = out.slice(out.indexOf("input ContactInput {"));
    expect(inputType).toContain("password: String!");
    // @visibility("read") field stays out of the input.
    expect(inputType).not.toContain("id:");
  });
});

describe("type alias inlining", () => {
  const SRC = "type Id = uuid\ntype Tags = [string]\nmodel R { 1 a: Id  2 b: Tags }";

  it("inlines a scalar alias and an array alias per target", () => {
    expect(emit("ts", SRC)).toContain("a: string;");
    expect(emit("ts", SRC)).toContain("b: string[];");
    expect(emit("go", SRC)).toContain('A string `json:"a"`');
    expect(emit("sql", SRC)).toContain("a UUID");           // not the JSONB fallback
    expect(emit("surrealdb", SRC)).toContain("TYPE uuid");
    expect(emit("graphql", SRC)).toContain("a: UUID!");
  });

  it("leaves no dangling $ref in json-schema / openapi", () => {
    const js = emit("json-schema", SRC);
    expect(js).not.toContain('"$ref": "#/$defs/Id"');
    expect(js).not.toContain('"$ref": "#/$defs/Tags"');
    expect(JSON.parse(js).$defs.R.properties.a).toMatchObject({ format: "uuid" });
  });
});

describe("named union aliases", () => {
  const SRC = "model Point { 1 x: f64 }  model Line { 1 y: f64 }\ntype Geometry = Point | Line\nmodel F { 1 g: Geometry }";

  it("GraphQL emits a union and references it by name", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("union Geometry = Point | Line");
    expect(out).toContain("g: Geometry");
  });

  it("TypeScript emits an exported union type", () => {
    expect(emit("ts", SRC)).toContain("export type Geometry = Point | Line;");
  });

  it("Go emits an any alias", () => {
    expect(emit("go", SRC)).toContain("type Geometry = any");
  });

  it("json-schema adds an anyOf def; openapi a oneOf schema", () => {
    expect(JSON.parse(emit("json-schema", SRC)).$defs.Geometry.anyOf).toHaveLength(2);
    expect(JSON.parse(emit("openapi", SRC)).components.schemas.Geometry.oneOf).toHaveLength(2);
  });

  it("GraphQL degrades a union in input position to JSON", () => {
    // emitter-level: a union-typed parameter renders as the JSON scalar.
    const out = emit("graphql", SRC + "\n@query op f(g: Geometry): Point");
    expect(out).toContain("f(g: JSON!): Point!");
  });
});

describe("array length bounds", () => {
  it("emits minItems/maxItems for json-schema and openapi, nested too", () => {
    const src = "model R { 1 a: [f64; 2..3]  2 b: [[f64; 2..3]] }";
    const js = JSON.parse(emit("json-schema", src)).$defs.R.properties;
    expect(js.a).toMatchObject({ minItems: 2, maxItems: 3 });
    expect(js.b.items).toMatchObject({ minItems: 2, maxItems: 3 });
    const oa = JSON.parse(emit("openapi", src)).components.schemas.R.properties;
    expect(oa.a).toMatchObject({ minItems: 2, maxItems: 3 });
  });

  it("emits array<T, max> and a min ASSERT for SurrealDB", () => {
    const out = emit("surrealdb", "model R { 1 a: [f64; 2..3] }");
    expect(out).toContain("array<float, 3>");
    expect(out).toContain("array::len($value) >= 2");
  });

  it("honours @minItems/@maxItems decorators", () => {
    const js = JSON.parse(emit("json-schema", "model R { @minItems(1) @maxItems(9) 1 a: [i32] }"));
    expect(js.$defs.R.properties.a).toMatchObject({ minItems: 1, maxItems: 9 });
  });
});

describe("@link across targets", () => {
  // GeoPoint's primary key is a uuid; @link fields store that id, not the object.
  const SRC = "model GeoPoint { @primaryKey 1 id: uuid  2 lat: f64 }  model Media { @link 1 location: GeoPoint? }";

  it("ts: renders a @link field as the primary-key scalar", () => {
    const out = emit("ts", SRC);
    expect(out).toContain("location?: string;");
    expect(out).not.toContain("location?: GeoPoint");
  });

  it("zod: renders a @link field as the primary-key scalar", () => {
    const out = emit("zod", SRC);
    expect(out).toContain("location: z.string().uuid().nullish(),");
  });

  it("json-schema: renders a @link field as the id type, not a $ref", () => {
    const js = JSON.parse(emit("json-schema", SRC));
    expect(js.$defs.Media.properties.location).toMatchObject({ type: "string", format: "uuid" });
  });

  it("graphql: renders a @link field as the id scalar", () => {
    const out = emit("graphql", SRC);
    expect(out).toContain("location: UUID");
    expect(out).not.toContain("location: GeoPoint");
  });

  it("openapi: renders a @link field as the id type", () => {
    const doc = JSON.parse(emit("openapi", SRC));
    expect(doc.components.schemas.Media.properties.location).toMatchObject({ type: "string", format: "uuid" });
  });

  it("sql: renders a @link field as a foreign key to the primary key", () => {
    const out = emit("sql", SRC);
    expect(out).toContain("location UUID REFERENCES geo_point(id)");
  });

  it("uses a non-uuid primary-key type for the link", () => {
    const src = "model Tag { @primaryKey 1 code: i32 }  model Post { @link 1 tag: Tag }";
    expect(emit("ts", src)).toContain("tag: number;");
    expect(emit("sql", src)).toContain("tag INTEGER NOT NULL REFERENCES tag(code)");
  });
});

describe("zod emitter", () => {
  it("imports zod and emits an object schema with inferred type", () => {
    const out = emit("zod", "model R { 1 x: i32  2 s: string }");
    expect(out).toContain(`import { z } from "zod";`);
    expect(out).toContain("export const RSchema = z.object({");
    expect(out).toContain("x: z.number().int(),");
    expect(out).toContain("s: z.string(),");
    expect(out).toContain("export type R = z.infer<typeof RSchema>;");
  });

  it("emits enums as z.enum", () => {
    const out = emit("zod", "enum Status { 1 pending  2 shipped }");
    expect(out).toContain(`export const StatusSchema = z.enum(["pending", "shipped"]);`);
  });

  it("makes nullable fields nullish", () => {
    const out = emit("zod", "model R { 1 a: string? }");
    expect(out).toContain("a: z.string().nullish(),");
  });

  it("references named types via z.lazy", () => {
    const out = emit("zod", "enum S { 1 a  2 b }  model R { 1 s: S }");
    expect(out).toContain("s: z.lazy(() => SSchema),");
  });

  it("maps arrays and maps", () => {
    const out = emit("zod", "model R { 1 items: [i32]  2 lookup: {string: i32} }");
    expect(out).toContain("items: z.array(z.number().int()),");
    expect(out).toContain("lookup: z.record(z.string(), z.number().int()),");
  });

  it("applies string format, length and pattern constraints", () => {
    const out = emit("zod", `model R { @format("email") @minLength(3) @maxLength(50) @pattern("^a") 1 e: string }`);
    expect(out).toContain("e: z.string().email().min(3).max(50).regex(/^a/),");
  });

  it("applies numeric bounds", () => {
    const out = emit("zod", "model R { @minValue(0) @maxValue(10) 1 n: i32 }");
    expect(out).toContain("n: z.number().int().min(0).max(10),");
  });

  it("emits union aliases as z.union", () => {
    const out = emit("zod", "model A { 1 x: i32 }  model B { 1 y: i32 }  type AB = A | B");
    expect(out).toContain("export const ABSchema = z.union([z.lazy(() => ASchema), z.lazy(() => BSchema)]);");
  });

  it("emits oneof as a discriminated union", () => {
    const out = emit("zod", "model R { 1 v: oneof { 1 a: i32  2 b: string } }");
    expect(out).toContain(`z.discriminatedUnion("kind", [`);
    expect(out).toContain(`z.object({ kind: z.literal("a"), a: z.number().int() })`);
  });

  it("skips generic models", () => {
    const out = emit("zod", "model Page<T> { 1 items: [T] }");
    expect(out).not.toContain("PageSchema");
  });
});
