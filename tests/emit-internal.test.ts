// tests/emit-internal.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import type { EmitContext } from "../src/emit/types";
import type { InternalSchema, InternalTable } from "../src/emit/internal/internalEmitter";

function internal(src: string, ctx?: Partial<EmitContext>): InternalSchema {
  const schema = resolve(parse(src));
  const emitter = getEmitter("internal")!;
  const files = emitter.emit({
    schema,
    company: ctx?.company ?? null,
    includePrivate: ctx?.includePrivate ?? false,
    options: {},
  });
  return JSON.parse(files[0].contents) as InternalSchema;
}

function table(out: InternalSchema, name: string): InternalTable {
  const found = out.tables.find(t => t.name === name);
  if (found === undefined) throw new Error(`no table '${name}' in ${out.tables.map(t => t.name).join(", ")}`);
  return found;
}

describe("internal emitter", () => {
  it("emits one data table per model with snake_case names", () => {
    const out = internal("model UserAccount { 1 displayName: string }");
    const t = table(out, "user_account");
    expect(t.schemafull).toBe(true);
    expect(t.kind).toBe("data");
    expect(t.fields).toContainEqual({ name: "display_name", type: "string" });
  });

  it("uses @table to override the table name", () => {
    const out = internal('@table("orders") model Order { 1 id: uuid  2 note: string }');
    expect(table(out, "orders").fields).toContainEqual({ name: "note", type: "string" });
  });

  it("maps scalars to the internal vocabulary", () => {
    const out = internal("model R { 1 a: i32  2 b: i64  3 c: bool  4 d: f64  5 e: timestamp  6 f: decimal(10,2) }");
    const t = table(out, "r");
    expect(t.fields).toContainEqual({ name: "a", type: "int" });
    expect(t.fields).toContainEqual({ name: "b", type: "int" });
    expect(t.fields).toContainEqual({ name: "c", type: "bool" });
    expect(t.fields).toContainEqual({ name: "d", type: "float" });
    expect(t.fields).toContainEqual({ name: "e", type: "datetime" });
    expect(t.fields).toContainEqual({ name: "f", type: "decimal" });
  });

  it("wraps nullable fields in option<> and arrays in array<>", () => {
    const out = internal("model R { 1 a: string?  2 b: [string]  3 c: [string]? }");
    const t = table(out, "r");
    expect(t.fields).toContainEqual({ name: "a", type: "option<string>" });
    expect(t.fields).toContainEqual({ name: "b", type: "array<string>" });
    expect(t.fields).toContainEqual({ name: "c", type: "option<array<string>>" });
  });

  it("maps a model reference to the target's primary-key scalar", () => {
    const out = internal('@table("orders") model Order { @primaryKey 1 id: uuid  2 note: string }  model Cart { 1 order: Order }');
    expect(table(out, "cart").fields).toContainEqual({ name: "order", type: "uuid" });
  });

  it("maps an enum-typed field to string", () => {
    const out = internal("enum Status { 1 a  2 b }  model R { 1 s: Status }");
    expect(table(out, "r").fields).toContainEqual({ name: "s", type: "string" });
  });

  it("maps map types to object", () => {
    const out = internal("model R { 1 meta: {string: string} }");
    expect(table(out, "r").fields).toContainEqual({ name: "meta", type: "object" });
  });

  it("omits @primaryKey fields (SurrealDB implicit id) but keeps @unique as an index", () => {
    const out = internal("model R { @primaryKey 1 id: uuid  @unique 2 email: string }");
    const t = table(out, "r");
    expect(t.fields.find(f => f.name === "id")).toBeUndefined();
    expect(t.fields).toContainEqual({ name: "email", type: "string" });
    expect(t.indexes).toContainEqual({ name: "idx_r_email", fields: ["email"], unique: true });
  });

  it("excludes private fields by default and includes them when requested", () => {
    const hidden = internal("model R { 1 a: string  100 private secret: string? }");
    expect(table(hidden, "r").fields.find(f => f.name === "secret")).toBeUndefined();

    const shown = internal("model R { 1 a: string  100 private secret: string? }", { includePrivate: true });
    expect(table(shown, "r").fields).toContainEqual({ name: "secret", type: "option<string>" });
  });

  it("skips generic records", () => {
    const out = internal("model Page<T> { 1 items: [T] }  model R { 1 x: i32 }");
    expect(out.tables.find(t => t.name === "page")).toBeUndefined();
    expect(table(out, "r")).toBeDefined();
  });

  it("produces a top-level { tables: [...] } document", () => {
    const out = internal("model R { 1 x: i32 }");
    expect(Array.isArray(out.tables)).toBe(true);
  });

  describe("@neoworks.* dataplane decorators", () => {
    it("defaults kind to data and omits visibility/history/subjectPath", () => {
      const t = table(internal("model R { 1 x: i32 }"), "r");
      expect(t.kind).toBe("data");
      expect(t.visibility).toBeUndefined();
      expect(t.history).toBeUndefined();
      expect(t.subjectPath).toBeUndefined();
    });

    it("reads @neoworks.kind and @neoworks.visibility", () => {
      const t = table(internal('@neoworks.kind("org") @neoworks.visibility("public") model Schema { 1 name: string }'), "schema");
      expect(t.kind).toBe("org");
      expect(t.visibility).toBe("public");
    });

    it("reads @neoworks.history", () => {
      const t = table(internal("@neoworks.history model Doc { 1 body: string }"), "doc");
      expect(t.history).toBe(true);
    });

    it("reads @neoworks.subjectPath for relation tables", () => {
      const t = table(internal('@neoworks.kind("relation") @neoworks.subjectPath("in.subject_user_id") model Edge { 1 weight: i32 }'), "edge");
      expect(t.kind).toBe("relation");
      expect(t.subjectPath).toBe("in.subject_user_id");
    });

    it("emits a fulltext index for @neoworks.fulltext, with optional analyzer", () => {
      const t = table(internal('model Post { 1 title: string  @neoworks.fulltext 2 body: string  @neoworks.fulltext(analyzer: "text_de") 3 summary: string }'), "post");
      expect(t.indexes).toContainEqual({ name: "idx_post_body_search", fields: ["body"], fulltext: true });
      expect(t.indexes).toContainEqual({ name: "idx_post_summary_search", fields: ["summary"], fulltext: true, analyzer: "text_de" });
    });

    it("@neoworks.schemaless makes the table schemaless", () => {
      expect(table(internal("@neoworks.schemaless model Blob { 1 data: json }"), "blob").schemafull).toBe(false);
    });

    it("emits composite @neoworks.unique and @neoworks.index from model decorators", () => {
      const t = table(internal('@neoworks.unique("scope", "name") @neoworks.index("latestVersion") model Schema { 1 scope: string  2 name: string  3 latestVersion: string }'), "schema");
      expect(t.indexes).toContainEqual({ name: "idx_schema_scope_name", fields: ["scope", "name"], unique: true });
      expect(t.indexes).toContainEqual({ name: "idx_schema_latest_version", fields: ["latest_version"] });
    });

    it("supports multiple index decorators on one model", () => {
      const t = table(internal('@neoworks.index("schemaId") @neoworks.unique("schemaId", "version") model V { 1 schemaId: string  2 version: string }'), "v");
      expect(t.indexes).toContainEqual({ name: "idx_v_schema_id", fields: ["schema_id"] });
      expect(t.indexes).toContainEqual({ name: "idx_v_schema_id_version", fields: ["schema_id", "version"], unique: true });
    });
  });
});
