// tests/migration-sqlite.test.ts
// The SQLite migration target, checked against a real SQLite database: each
// case creates the old schema, inserts rows, runs the migration and reads back.

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { buildMigrationPlan } from "../src/engine/migration";
import { getMigrationEmitter } from "../src/emit/migration";

function migration(oldSrc: string, newSrc: string): string {
  const oldSchema = resolve(parse(oldSrc));
  const newSchema = resolve(parse(newSrc));
  const files = getMigrationEmitter("migration-sqlite")!.emit({
    oldSchema,
    newSchema,
    plan: buildMigrationPlan(oldSchema, newSchema),
    company: null,
    includePrivate: false,
  });
  return files[0].contents;
}

function createdDatabase(src: string): Database {
  const db = new Database(":memory:");
  const files = getEmitter("sqlite")!.emit({ schema: resolve(parse(src)), company: null, includePrivate: false, options: {} });
  db.exec(files[0].contents);
  return db;
}

describe("sqlite migrations", () => {
  it("adds a nullable column in place", () => {
    const out = migration("model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string? }");
    expect(out).toContain("ALTER TABLE R ADD COLUMN b TEXT;");
    expect(out).not.toContain("PRAGMA");
  });

  it("renames tables and columns in place", () => {
    const out = migration("model R { 1 a: i32 }", '@renamed("R") model S { 1 b: i32 }');
    expect(out).toContain("ALTER TABLE R RENAME TO S;");
    expect(out).toContain("ALTER TABLE S RENAME COLUMN a TO b;");
  });

  it("treats a change that keeps the column as a no-op", () => {
    const out = migration("model R { 1 a: i32 }", "model R { 1 a: i64 }");
    expect(out).toContain("-- no-op");
    expect(out).not.toContain("CREATE TABLE");
  });

  it("rebuilds once for several changes to one table and keeps the rows", () => {
    const oldSrc = "model R { @primaryKey 1 id: string  2 a: string  3 gone: string?  4 n: i32? }";
    const newSrc = "model R { @primaryKey 1 id: string  2 renamed: string?  4 n: i32  5 extra: bool? }";
    const out = migration(oldSrc, newSrc);
    expect(out.match(/CREATE TABLE R__new/g)).toHaveLength(1);
    expect(out).toContain("-- DESTRUCTIVE: column \"gone\"");

    const db = createdDatabase(oldSrc);
    db.exec("INSERT INTO R (id, a, gone, n) VALUES ('1', 'x', 'y', 7)");
    db.exec(out);
    expect(db.query("SELECT id, renamed, n, extra FROM R").all()).toEqual([{ id: "1", renamed: "x", n: 7, extra: null }]);
  });

  it("casts on a lossy type change", () => {
    const oldSrc = "model R { 1 a: string }";
    const out = migration(oldSrc, "model R { 1 a: i32 }");
    expect(out).toContain("CAST(a AS INTEGER)");
    expect(out).toContain("-- LOSSY");

    const db = createdDatabase(oldSrc);
    db.exec("INSERT INTO R (a) VALUES ('42')");
    db.exec(out);
    expect(db.query("SELECT a FROM R").get()).toEqual({ a: 42 });
  });

  it("leaves a placeholder for a required column without a default", () => {
    const out = migration("model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string }");
    expect(out).toContain("NULL /* TODO backfill */");
    expect(out).toContain("-- TODO backfill");
  });

  it("rebuilds the tables using an enum when its values change, mapping renamed values", () => {
    const oldSrc = "enum S { 1 draft  2 live } model R { 1 s: S }";
    const out = migration(oldSrc, "enum S { 1 draft  2 published  3 hidden } model R { 1 s: S }");
    expect(out).toContain("CASE s WHEN 'live' THEN 'published' ELSE s END");

    const db = createdDatabase(oldSrc);
    db.exec("INSERT INTO R (s) VALUES ('live'), ('draft')");
    db.exec(out);
    expect(db.query("SELECT s FROM R ORDER BY s").all()).toEqual([{ s: "draft" }, { s: "published" }]);
    db.exec("INSERT INTO R (s) VALUES ('hidden')");
  });

  it("keeps rows referencing a rebuilt table", () => {
    const oldSrc = "model P { @primaryKey 1 id: string  2 a: string } model C { @primaryKey 1 id: string  @link 2 parent: P }";
    const out = migration(oldSrc, "model P { @primaryKey 1 id: string  2 a: string? } model C { @primaryKey 1 id: string  @link 2 parent: P }");

    const db = createdDatabase(oldSrc);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("INSERT INTO P VALUES ('p', 'x'); INSERT INTO C VALUES ('c', 'p')");
    db.exec(out);
    expect(db.query("SELECT parent FROM C").all()).toEqual([{ parent: "p" }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
