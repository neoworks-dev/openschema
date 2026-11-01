// tests/sql-value-index.test.ts
// @value models (embedded, never a table) and model-level @index across the
// database targets and their migrations.

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildMigrationPlan } from "../src/engine/migration";
import { getMigrationEmitter } from "../src/emit/migration";

function generate(target: string, src: string): string {
  const files = getEmitter(target)!.emit({ schema: resolve(parse(src)), company: null, includePrivate: false, options: {} });
  return files[0].contents;
}

function migration(target: string, oldSrc: string, newSrc: string): string {
  const oldSchema = resolve(parse(oldSrc));
  const newSchema = resolve(parse(newSrc));
  const plan = buildMigrationPlan(oldSchema, newSchema);
  return getMigrationEmitter(target)!.emit({ oldSchema, newSchema, plan, company: null, includePrivate: false })[0].contents;
}

const WITH_VALUE = `
  @value
  model Money { 1 amount: i64  2 currency: string }
  model Order { 1 id: uuid  2 total: Money }
`;

describe("@value models", () => {
  it("get no table in sql, sqlite or surrealdb", () => {
    for (const target of ["sql", "sqlite", "surrealdb"]) {
      const out = generate(target, WITH_VALUE);
      expect(out).not.toMatch(/TABLE "?Money\b/);
      expect(out).toMatch(/TABLE "?Order\b/);
    }
  });

  it("are stored inline as JSON", () => {
    expect(generate("sql", WITH_VALUE)).toContain("total JSONB NOT NULL");
    expect(generate("sqlite", WITH_VALUE)).toContain("total TEXT NOT NULL CHECK (json_valid(total))");
  });

  it("never become a migration table", () => {
    const out = migration("migration-sql", "model Order { 1 id: uuid }", WITH_VALUE);
    expect(out).not.toContain("Money");
    expect(out).toContain("ADD COLUMN total JSONB");
  });
});

const INDEXED = `
  @index(fields: ["studio", "date"])
  @index(fields: ["slug"], unique: true)
  @index(fields: ["title"], name: "video_title_search")
  model video { 1 id: uuid  2 studio: string  3 date: string  4 slug: string  5 title: string }
`;

describe("@index", () => {
  it("renders after the table in sql and sqlite", () => {
    for (const target of ["sql", "sqlite"]) {
      const out = generate(target, INDEXED);
      expect(out).toContain("CREATE INDEX video_studio_date_idx ON video (studio, date);");
      expect(out).toContain("CREATE UNIQUE INDEX video_slug_idx ON video (slug);");
      expect(out).toContain("CREATE INDEX video_title_search ON video (title);");
      expect(out.indexOf("CREATE TABLE")).toBeLessThan(out.indexOf("CREATE INDEX"));
    }
  });

  it("derives its name from the exact table and column names, quoted as each dialect needs", () => {
    const src = '@index(fields: ["createdAt"]) model R { @sql.column("created") 1 createdAt: string  2 b: string }';
    expect(generate("sql", src)).toContain("CREATE INDEX \"R_created_idx\" ON \"R\" (created);");
    expect(generate("sqlite", src)).toContain("CREATE INDEX R_created_idx ON R (created);");
  });

  it("renders as DEFINE INDEX in surrealdb", () => {
    expect(generate("surrealdb", INDEXED)).toContain("DEFINE INDEX video_slug_idx ON TABLE video FIELDS slug UNIQUE;");
  });

  it("rejects an unknown field", () => {
    expect(() => generate("sql", '@index(fields: ["nope"]) model R { 1 a: string }')).toThrow(/nope/);
  });

  it("is created with a new table", () => {
    const out = migration("migration-sql", "model A { 1 a: string }", `model A { 1 a: string } ${INDEXED}`);
    expect(out).toContain("CREATE TABLE video");
    expect(out).toContain("CREATE UNIQUE INDEX video_slug_idx ON video (slug);");
  });

  it("is added, dropped and recreated when the declarations change", () => {
    const oldSrc = '@index(fields: ["a"]) @index(fields: ["b"]) model r { 1 a: string  2 b: string  3 c: string }';
    const newSrc = '@index(fields: ["a"], unique: true) @index(fields: ["c"]) model r { 1 a: string  2 b: string  3 c: string }';
    for (const target of ["migration-sql", "migration-sqlite"]) {
      const out = migration(target, oldSrc, newSrc);
      expect(out).toContain("DROP INDEX r_a_idx;");
      expect(out).toContain("DROP INDEX r_b_idx;");
      expect(out).toContain("CREATE UNIQUE INDEX r_a_idx ON r (a);");
      expect(out).toContain("CREATE INDEX r_c_idx ON r (c);");
      expect(out.indexOf("DROP INDEX r_a_idx")).toBeLessThan(out.indexOf("CREATE UNIQUE INDEX r_a_idx"));
    }
    expect(migration("migration-sql", oldSrc, oldSrc)).not.toContain("INDEX");
  });

  it("survives a SQLite table rebuild", () => {
    const oldSrc = '@index(fields: ["a"]) model R { 1 a: string  2 b: string }';
    const newSrc = '@index(fields: ["a"]) model R { 1 a: string  2 b: string? }';
    const db = new Database(":memory:");
    db.exec(generate("sqlite", oldSrc));
    db.exec(migration("migration-sqlite", oldSrc, newSrc));
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'R'").all();
    expect(indexes).toEqual([{ name: "R_a_idx" }]);
  });
});
