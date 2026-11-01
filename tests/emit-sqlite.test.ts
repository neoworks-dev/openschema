// tests/emit-sqlite.test.ts
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter } from "../src/emit";

function sqlite(src: string): string {
  const files = getEmitter("sqlite")!.emit({
    schema: resolve(parse(src)),
    company: null,
    includePrivate: false,
    options: {},
  });
  return files[0].contents;
}

describe("sqlite emitter", () => {
  it("maps scalars onto SQLite storage classes", () => {
    const out = sqlite("model R { 1 a: i32  2 b: i64  3 c: bool  4 d: f64  5 e: uuid  6 f: timestamp  7 g: bytes  8 h: u64 }");
    expect(out).toContain("a INTEGER NOT NULL");
    expect(out).toContain("b INTEGER NOT NULL");
    expect(out).toContain("c INTEGER NOT NULL");
    expect(out).toContain("d REAL NOT NULL");
    expect(out).toContain("e TEXT NOT NULL");
    expect(out).toContain("f TEXT NOT NULL");
    expect(out).toContain("g BLOB NOT NULL");
    expect(out).toContain("h TEXT NOT NULL");
  });

  it("keeps decimals exact as TEXT", () => {
    expect(sqlite("model R { 1 price: decimal(10, 2) }")).toContain("price TEXT NOT NULL");
  });

  it("stores JSON-shaped values as TEXT with json_valid", () => {
    const out = sqlite("model Inner { 1 x: i32 } model R { 1 tags: [string]  2 meta: json?  3 inner: Inner }");
    expect(out).toContain("tags TEXT NOT NULL CHECK (json_valid(tags))");
    expect(out).toContain("meta TEXT CHECK (json_valid(meta))");
    expect(out).toContain("\"inner\" TEXT NOT NULL CHECK (json_valid(\"inner\"))");
  });

  it("turns enums into an IN-list CHECK, with no CREATE TYPE", () => {
    const out = sqlite("enum Status { 1 draft  2 live } model R { 1 status: Status }");
    expect(out).toContain("status TEXT NOT NULL CHECK (status IN ('draft', 'live'))");
    expect(out).not.toContain("CREATE TYPE");
  });

  it("parenthesises expression defaults and maps now()", () => {
    const out = sqlite('model R { @default(now()) 1 at: timestamp  @default(0) 2 n: i32  @default("it\'s") 3 s: string }');
    expect(out).toContain("at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    expect(out).toContain("n INTEGER NOT NULL DEFAULT 0");
    expect(out).toContain("s TEXT NOT NULL DEFAULT 'it''s'");
  });

  it("renders keys, references and @sqlite.strict", () => {
    const out = sqlite(`
      model Studio { @primaryKey 1 id: uuid }
      @sqlite.strict
      model Video { @primaryKey 1 id: uuid  2 studio: ref<Studio>?  @unique 3 slug: string }
    `);
    expect(out).toContain("id TEXT NOT NULL PRIMARY KEY");
    expect(out).toContain("studio TEXT REFERENCES Studio(id)");
    expect(out).toContain("slug TEXT NOT NULL UNIQUE");
    expect(out).toContain(") STRICT;");
  });

  it("produces DDL SQLite accepts", () => {
    const db = new Database(":memory:");
    db.exec(sqlite(`
      enum Status { 1 draft  2 live }
      model Studio { @primaryKey 1 id: uuid  2 name: string }
      @sqlite.strict
      model Video {
        @primaryKey 1 id: uuid
        2 status: Status
        3 tags: [string]
        4 studio: ref<Studio>?
        @default(now()) 5 createdAt: timestamp
      }
    `));
    db.exec("INSERT INTO Video (id, status, tags) VALUES ('v', 'live', '[]')");
    expect(() => db.exec("INSERT INTO Video (id, status, tags) VALUES ('w', 'gone', '[]')")).toThrow();
    expect(() => db.exec("INSERT INTO Video (id, status, tags) VALUES ('x', 'live', 'not json')")).toThrow();
  });
});
