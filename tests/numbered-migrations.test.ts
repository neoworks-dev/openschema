// tests/numbered-migrations.test.ts
// `migrate --numbered`: file numbering, the schema snapshot, and the CLI flow
// (first migration, --check, --allow-empty, --baseline for an existing history).

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadWithSnapshot, migrationSlug, nextMigrationFileName, resolveSnapshot,
} from "../src/cli/numberedMigrations";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
const workspaces: string[] = [];
let workspace: string;

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "openschema-numbered-"));
  workspaces.push(workspace);
});

const readFileOrNull = (path: string) => {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

function writeSchema(name: string, source: string): string {
  const path = join(workspace, name);
  writeFileSync(path, source, "utf8");
  return path;
}

function run(args: string[]): { exitCode: number; output: string } {
  const child = Bun.spawnSync({ cmd: ["bun", "run", CLI, ...args], env: { ...process.env, CI: "" } });
  return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
}

describe("migration file names", () => {
  it("starts at 001 in an empty directory", () => {
    expect(nextMigrationFileName([], "init", "sql")).toBe("001_init.sql");
  });

  it("continues the highest number and keeps its padding", () => {
    expect(nextMigrationFileName(["0007_a.sql", "0012_b.sql", "notes.md"], "c", "sql")).toBe("0013_c.sql");
    expect(nextMigrationFileName(["9_a.sql"], "b", "surql")).toBe("10_b.surql");
  });

  it("turns a name into a file-name slug", () => {
    expect(migrationSlug("Add Clips & Shorts!")).toBe("add_clips_shorts");
    expect(() => migrationSlug("!!")).toThrow();
  });
});

describe("schema snapshot", () => {
  it("captures every imported file and resolves without the disk", () => {
    writeSchema("money.schema", "namespace t\nmodel Money { 1 amount: i64 }");
    const entry = writeSchema("main.schema", 'namespace t\nimport { Money } from "./money"\nmodel Order { 1 total: Money }');
    const { snapshot } = loadWithSnapshot(entry, readFileOrNull);
    expect(Object.keys(snapshot.files)).toEqual(["main.schema", "money.schema"]);
    expect(snapshot.entry).toBe("main.schema");

    writeSchema("money.schema", "namespace t\nmodel Money { 1 amount: i64  2 currency: string }");
    const old = resolveSnapshot(snapshot, entry);
    const money = [...old.records.values()].find(record => record.symbol.localName === "Money")!;
    expect(money.fields.map(field => field.name)).toEqual(["amount"]);
  });
});

describe("migrate --numbered", () => {
  it("writes the first migration from nothing, then only the changes", () => {
    const entry = writeSchema("main.schema", "model R { 1 a: i32 }");
    const directory = join(workspace, "migrations");

    expect(run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--name", "init"]).exitCode).toBe(0);
    expect(readFileSync(join(directory, "001_init.sql"), "utf8")).toContain("CREATE TABLE R (");

    writeSchema("main.schema", "model R { 1 a: i32  2 b: string? }");
    const check = run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--check"]);
    expect(check.exitCode).toBe(1);

    expect(run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--name", "add b"]).exitCode).toBe(0);
    expect(readFileSync(join(directory, "002_add_b.sql"), "utf8")).toContain("ALTER TABLE R ADD COLUMN b TEXT;");
    expect(run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--check"]).exitCode).toBe(0);
  });

  it("writes nothing for an unchanged schema unless --allow-empty", () => {
    const entry = writeSchema("main.schema", "model R { 1 a: i32 }");
    const directory = join(workspace, "migrations");
    run(["migrate", entry, "-t", "migration-sql", "--numbered", directory, "--name", "init"]);

    run(["migrate", entry, "-t", "migration-sql", "--numbered", directory, "--name", "again"]);
    expect(existsSync(join(directory, "002_again.sql"))).toBe(false);

    expect(run(["migrate", entry, "-t", "migration-sql", "--numbered", directory, "--name", "data", "--allow-empty"]).exitCode).toBe(0);
    expect(readFileSync(join(directory, "002_data.sql"), "utf8")).toContain("no schema change");
  });

  it("refuses an existing history without a snapshot until --baseline", () => {
    const entry = writeSchema("main.schema", "model R { 1 a: i32 }");
    const directory = join(workspace, "migrations");
    mkdirSync(directory);
    writeFileSync(join(directory, "037_hand_written.sql"), "-- old\n");

    const refused = run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--name", "x"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("--baseline");

    expect(run(["migrate", entry, "--numbered", directory, "--baseline"]).exitCode).toBe(0);
    expect(run(["migrate", entry, "--numbered", directory, "--baseline"]).exitCode).toBe(1);

    writeSchema("main.schema", "model R { 1 a: i32  2 b: i32? }");
    run(["migrate", entry, "-t", "migration-sqlite", "--numbered", directory, "--name", "b"]);
    expect(readdirSync(directory).sort()).toEqual(["037_hand_written.sql", "038_b.sql", "openschema.snapshot.json"]);
  });

  it("rejects the numbered flags without --numbered", () => {
    const entry = writeSchema("main.schema", "model R { 1 a: i32 }");
    expect(run(["migrate", entry, entry, "-t", "migration-sql", "--check"]).exitCode).toBe(1);
  });
});
