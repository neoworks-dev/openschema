// tests/emit-sql.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import type { EmitContext } from "../src/emit/types";

function sql(src: string, ctx?: Partial<EmitContext>): string {
  const schema = resolve(parse(src));
  const emitter = getEmitter("sql")!;
  const files = emitter.emit({
    schema,
    company: ctx?.company ?? null,
    includePrivate: ctx?.includePrivate ?? false,
    options: {},
  });
  return files[0].contents;
}

describe("sql emitter", () => {
  it("creates a table per model with snake_case names", () => {
    const out = sql("model UserAccount { 1 displayName: string }");
    expect(out).toContain("CREATE TABLE user_account (");
    expect(out).toContain("display_name TEXT NOT NULL");
  });

  it("uses @table to override the table name", () => {
    const out = sql('@table("orders") model Order { 1 id: uuid }');
    expect(out).toContain("CREATE TABLE orders (");
  });

  it("maps scalar and decimal types", () => {
    const out = sql("model R { 1 a: i32  2 b: i64  3 c: bool  4 d: decimal(10, 2)  5 e: timestamp }");
    expect(out).toContain("a INTEGER");
    expect(out).toContain("b BIGINT");
    expect(out).toContain("c BOOLEAN");
    expect(out).toContain("d NUMERIC(10, 2)");
    expect(out).toContain("e TIMESTAMPTZ");
  });

  it("omits NOT NULL for nullable fields", () => {
    const out = sql("model R { 1 a: string  2 b: string? }");
    expect(out).toContain("a TEXT NOT NULL");
    expect(out).toMatch(/b TEXT(?! NOT NULL)/);
  });

  it("honours @primaryKey, @unique, @default, @check", () => {
    const out = sql('model R { @primaryKey @default(gen_uuid()) 1 id: uuid  @unique 2 email: string  @check(age >= 0) 3 age: i32 }');
    expect(out).toContain("id UUID NOT NULL PRIMARY KEY DEFAULT gen_uuid()");
    expect(out).toContain("email TEXT NOT NULL UNIQUE");
    expect(out).toContain("CHECK (age >= 0)");
  });

  it("lets @sql.type override the column type", () => {
    const out = sql('model R { @sql.type("JSONB") 1 blob: string }');
    expect(out).toContain("blob JSONB");
  });

  it("declares a native enum type and types the column by it", () => {
    const out = sql("enum Status { 1 a  2 b }  model R { 1 s: Status }");
    expect(out).toContain("CREATE TYPE status AS ENUM ('a', 'b');");
    expect(out).toContain("s status NOT NULL");
  });

  it("maps arrays and maps to JSONB", () => {
    const out = sql("model R { 1 tags: [string]  2 meta: {string: string} }");
    expect(out).toContain("tags JSONB");
    expect(out).toContain("meta JSONB");
  });

  it("excludes private fields by default", () => {
    const out = sql("model R { 1 a: string  100 private secret: string? }");
    expect(out).not.toContain("secret");
  });

  it("includes private fields when requested", () => {
    const out = sql("model R { 1 a: string  100 private secret: string? }", { includePrivate: true });
    expect(out).toContain("secret TEXT");
  });

  it("emits namespaced overlay columns for the selected company", () => {
    const src = "model Person { 1 name: string }  overlay acme on Person { 1 spamScore: f32 }";
    const out = sql(src, { company: "acme" });
    expect(out).toContain("acme_spam_score REAL NOT NULL");
  });

  it("omits overlay columns when no company is selected", () => {
    const src = "model Person { 1 name: string }  overlay acme on Person { 1 spamScore: f32 }";
    const out = sql(src);
    expect(out).not.toContain("spam_score");
  });

  it("skips generic records", () => {
    const out = sql("model Page<T> { 1 items: [T] }  model R { 1 x: i32 }");
    expect(out).not.toContain("page");
    expect(out).toContain("CREATE TABLE r (");
  });
});
