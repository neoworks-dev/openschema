// tests/emit-surrealdb.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";

function emit(src: string, company: string | null = null, includePrivate = false): string {
  const schema = resolve(parse(src));
  const files = getEmitter("surrealdb")!.emit({ schema, company, includePrivate, options: {} });
  return files[0].contents;
}

describe("surrealdb emitter", () => {
  it("emits a SCHEMAFULL table with typed fields", () => {
    const out = emit("model User { 1 displayName: string  2 age: i32 }");
    expect(out).toContain("DEFINE TABLE user SCHEMAFULL;");
    expect(out).toContain("DEFINE FIELD displayName ON TABLE user TYPE string;");
    expect(out).toContain("DEFINE FIELD age ON TABLE user TYPE int;");
  });

  it("wraps nullable fields in option<>", () => {
    const out = emit("model R { 1 note: string? }");
    expect(out).toContain("DEFINE FIELD note ON TABLE r TYPE option<string>;");
  });

  it("maps arrays to array<> and collapses numeric scalars", () => {
    const out = emit("model R { 1 tags: [string]  2 score: f64 }");
    expect(out).toContain("TYPE array<string>;");
    expect(out).toContain("TYPE float;");
  });

  it("turns @references into a record link", () => {
    const out = emit("model Order { 1 id: uuid  @references(User.id) 2 buyer: uuid }");
    expect(out).toContain("DEFINE FIELD buyer ON TABLE order TYPE record<user>;");
  });

  it("emits a unique index for @unique and @primaryKey", () => {
    const out = emit("model User { @primaryKey 1 id: uuid  @unique 2 email: string }");
    expect(out).toContain("DEFINE FIELD id ON TABLE user TYPE uuid READONLY;");
    expect(out).toContain("DEFINE INDEX user_id_unique ON TABLE user FIELDS id UNIQUE;");
    expect(out).toContain("DEFINE INDEX user_email_unique ON TABLE user FIELDS email UNIQUE;");
  });

  it("constrains enum-typed fields with an INSIDE assertion", () => {
    const out = emit("enum Status { 1 pending  2 shipped }  model Order { 1 status: Status }");
    expect(out).toContain("DEFINE FIELD status ON TABLE order TYPE string ASSERT $value INSIDE ['pending', 'shipped'];");
  });

  it("maps validation decorators to ASSERT clauses", () => {
    const out = emit('model R { @minValue(0) @maxValue(10) 1 n: i32  @format("email") 2 e: string }');
    expect(out).toContain("ASSERT $value >= 0 AND $value <= 10");
    expect(out).toContain("ASSERT string::is::email($value)");
  });

  it("emits DEFAULT clauses", () => {
    const out = emit("model R { @default(true) 1 active: bool }");
    expect(out).toContain("DEFAULT true");
  });

  it("honours @table and @surreal.type overrides", () => {
    const out = emit('@table("people") model Person { @surreal.type("string") 1 nick: string }');
    expect(out).toContain("DEFINE TABLE people SCHEMAFULL;");
    expect(out).toContain("ON TABLE people");
  });

  it("includes namespaced overlay fields for a company", () => {
    const out = emit("model Person { 1 name: string }  overlay acme on Person { 1 spamScore: f32 }", "acme");
    expect(out).toContain("DEFINE FIELD acme_spamScore ON TABLE person TYPE float;");
  });

  it("omits private fields unless includePrivate is set", () => {
    const src = "model R { 1 name: string  2 private secret: string }";
    expect(emit(src)).not.toContain("secret");
    expect(emit(src, null, true)).toContain("DEFINE FIELD secret ON TABLE r TYPE string;");
  });

  it("embeds an inline-referenced value object as a typed nested object", () => {
    const src = "model GeoPoint { 1 lat: f64  2 lng: f64 }  model Media { 1 location: GeoPoint? }";
    const out = emit(src);
    // GeoPoint is a value object: no table of its own.
    expect(out).not.toContain("DEFINE TABLE geo_point");
    expect(out).toContain("DEFINE TABLE media SCHEMAFULL;");
    expect(out).toContain("DEFINE FIELD location ON TABLE media TYPE option<object>;");
    expect(out).toContain("DEFINE FIELD location.lat ON TABLE media TYPE float;");
    expect(out).toContain("DEFINE FIELD location.lng ON TABLE media TYPE float;");
  });

  it("embeds an array of value objects with .* element fields", () => {
    const src = "model Tag { 1 name: string }  model Post { 1 tags: [Tag] }";
    const out = emit(src);
    expect(out).not.toContain("DEFINE TABLE tag");
    expect(out).toContain("DEFINE FIELD tags ON TABLE post TYPE array<object>;");
    expect(out).toContain("DEFINE FIELD tags.* ON TABLE post TYPE object;");
    expect(out).toContain("DEFINE FIELD tags.*.name ON TABLE post TYPE string;");
  });

  it("turns a @link field into a record link and keeps the model a table", () => {
    const src = "model GeoPoint { 1 lat: f64  2 lng: f64 }  model Media { @link 1 location: GeoPoint? }";
    const out = emit(src);
    expect(out).toContain("DEFINE TABLE geo_point SCHEMAFULL;");
    expect(out).toContain("DEFINE FIELD location ON TABLE media TYPE option<record<geo_point>>;");
    expect(out).not.toContain("location.lat");
  });

  it("links an array of records with @link", () => {
    const src = "model Tag { 1 name: string }  model Post { @link 1 tags: [Tag] }";
    const out = emit(src);
    expect(out).toContain("DEFINE TABLE tag SCHEMAFULL;");
    expect(out).toContain("DEFINE FIELD tags ON TABLE post TYPE array<record<tag>>;");
  });

  it("treats a @table model as an entity even when referenced inline", () => {
    const src = '@table model GeoPoint { 1 lat: f64 }  model Media { 1 location: GeoPoint? }';
    const out = emit(src);
    expect(out).toContain("DEFINE TABLE geo_point SCHEMAFULL;");
    // legacy untyped object embed, not expanded
    expect(out).toContain("DEFINE FIELD location ON TABLE media TYPE option<object>;");
    expect(out).not.toContain("location.lat");
  });
});
