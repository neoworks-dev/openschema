// tests/sql-identifiers.test.ts
// Names reach SQL exactly as written; keywords (and, for PostgreSQL, names with
// upper-case letters) are quoted wherever a table or column name is rendered.

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildMigrationPlan } from "../src/engine/migration";
import { getMigrationEmitter } from "../src/emit/migration";

function generate(target: string, src: string): string {
  return getEmitter(target)!.emit({ schema: resolve(parse(src)), company: null, includePrivate: false, options: {} })[0].contents;
}

function migration(target: string, oldSrc: string, newSrc: string): string {
  const oldSchema = resolve(parse(oldSrc));
  const newSchema = resolve(parse(newSrc));
  const plan = buildMigrationPlan(oldSchema, newSchema);
  return getMigrationEmitter(target)!.emit({ oldSchema, newSchema, plan, company: null, includePrivate: false })[0].contents;
}

const KEYWORDS_V1 = `
  enum Kind { 1 a  2 b }
  model Group { @primaryKey 1 id: string  2 name: string }
  @index(fields: ["group", "order"])
  model GroupItem {
    @primaryKey 1 id: string
    @link 2 group: Group
    3 order: i32
    4 select: Kind
    5 tags: [string]
  }
`;

const KEYWORDS_V2 = `
  enum Kind { 1 a  2 b  3 c }
  model Group { @primaryKey 1 id: string  2 name: string }
  @index(fields: ["group", "order"])
  model GroupItem {
    @primaryKey 1 id: string
    @link 2 group: Group
    3 order: i64?
    4 select: Kind
    5 tags: [string]
  }
`;

describe("SQL identifiers", () => {
  it("quotes keywords in SQLite and keeps every other name bare", () => {
    const out = generate("sqlite", KEYWORDS_V1);
    expect(out).toContain('CREATE TABLE "Group" (');
    expect(out).toContain("CREATE TABLE GroupItem (");
    expect(out).toContain('"group" TEXT NOT NULL REFERENCES "Group"(id)');
    expect(out).toContain(`"select" TEXT NOT NULL CHECK ("select" IN ('a', 'b'))`);
    expect(out).toContain("tags TEXT NOT NULL CHECK (json_valid(tags))");
    expect(out).toContain('CREATE INDEX GroupItem_group_order_idx ON GroupItem ("group", "order");');
  });

  it("produces DDL and a rebuild SQLite runs", () => {
    const db = new Database(":memory:");
    db.exec(generate("sqlite", KEYWORDS_V1));
    db.exec(`INSERT INTO "Group" VALUES ('g', 'G'); INSERT INTO GroupItem VALUES ('i', 'g', 1, 'a', '[]')`);
    const out = migration("migration-sqlite", KEYWORDS_V1, KEYWORDS_V2);
    expect(out).toContain("CREATE TABLE GroupItem__new");
    db.exec(out);
    expect(db.query(`SELECT "group", "order", "select" FROM GroupItem`).all()).toEqual([{ group: "g", order: 1, select: "a" }]);
    db.exec(`INSERT INTO GroupItem VALUES ('j', 'g', NULL, 'c', '[]')`);
  });

  it("quotes keywords and upper-case names in PostgreSQL", () => {
    const out = generate("sql", KEYWORDS_V1);
    expect(out).toContain('CREATE TYPE "Kind" AS ENUM');
    expect(out).toContain('CREATE TABLE "GroupItem" (');
    expect(out).toContain('"group" TEXT NOT NULL REFERENCES "Group"(id)');
    expect(out).toContain('"select" "Kind" NOT NULL');
    expect(out).toContain('CREATE INDEX "GroupItem_group_order_idx" ON "GroupItem" ("group", "order");');
  });

  it("quotes names in PostgreSQL migrations", () => {
    const out = migration("migration-sql", KEYWORDS_V1, KEYWORDS_V2);
    expect(out).toContain(`ALTER TYPE "Kind" ADD VALUE IF NOT EXISTS 'c';`);
    expect(out).toContain('ALTER TABLE "GroupItem" ALTER COLUMN "order" TYPE BIGINT;');
    expect(out).toContain('ALTER TABLE "GroupItem" ALTER COLUMN "order" DROP NOT NULL;');
  });
});
