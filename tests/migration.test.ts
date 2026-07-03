// tests/migration.test.ts
import { describe, it, expect } from "bun:test";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { buildMigrationPlan, type MigrationPlan, type MigrationOp } from "../src/engine/migration";
import { getMigrationEmitter } from "../src/emit/migration";

function plan(oldSrc: string, newSrc: string): MigrationPlan {
  return buildMigrationPlan(resolve(parse(oldSrc)), resolve(parse(newSrc)));
}

function ops(oldSrc: string, newSrc: string): MigrationOp[] {
  return plan(oldSrc, newSrc).ops;
}

function migrate(target: string, oldSrc: string, newSrc: string): string {
  const p = plan(oldSrc, newSrc);
  const files = getMigrationEmitter(target)!.emit({
    oldSchema: resolve(parse(oldSrc)),
    newSchema: resolve(parse(newSrc)),
    plan: p,
    company: null,
    includePrivate: false,
  });
  return files[0].contents;
}

describe("migration planner", () => {
  it("classifies added fields by safety", () => {
    expect(ops("model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string? }")[0])
      .toMatchObject({ kind: "AddField", safety: "safe" });
    expect(ops("model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string }")[0])
      .toMatchObject({ kind: "AddField", safety: "needs_backfill" });
    expect(ops("model R { 1 a: i32 }", 'model R { 1 a: i32  @default("x") 2 b: string }')[0])
      .toMatchObject({ kind: "AddField", safety: "safe" });
  });

  it("drops are destructive", () => {
    expect(ops("model R { 1 a: i32  2 b: string }", "model R { 1 a: i32 }")[0])
      .toMatchObject({ kind: "DropField", safety: "destructive" });
  });

  it("a same-ordinal name change is a rename, not drop+add", () => {
    const o = ops("model R { 1 a: i32 }", "model R { 1 b: i32 }");
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: "RenameField", oldName: "a" });
  });

  it("classifies type relations", () => {
    expect(ops("model R { 1 a: i32 }", "model R { 1 a: i64 }")[0])
      .toMatchObject({ kind: "ChangeFieldType", relation: "widened", safety: "safe" });
    expect(ops("model R { 1 a: i64 }", "model R { 1 a: i32 }")[0])
      .toMatchObject({ kind: "ChangeFieldType", relation: "narrowed", safety: "lossy" });
    expect(ops("model R { 1 a: string }", "model R { 1 a: i32 }")[0])
      .toMatchObject({ kind: "ChangeFieldType", relation: "incompatible", safety: "lossy" });
  });

  it("rename + retype emit both ops, rename first", () => {
    const o = ops("model R { 1 a: i32 }", "model R { 1 b: i64 }");
    expect(o.map(op => op.kind)).toEqual(["RenameField", "ChangeFieldType"]);
  });

  it("create / drop models", () => {
    expect(ops("model A { 1 x: i32 }", "model A { 1 x: i32 } model B { 1 y: i32 }")[0])
      .toMatchObject({ kind: "CreateModel" });
    expect(ops("model A { 1 x: i32 } model B { 1 y: i32 }", "model A { 1 x: i32 }")[0])
      .toMatchObject({ kind: "DropModel", safety: "destructive" });
  });

  it("@renamed model is a RenameModel, but not when @table is unchanged", () => {
    expect(ops("model A { 1 x: i32 }", '@renamed("A") model B { 1 x: i32 }')[0])
      .toMatchObject({ kind: "RenameModel" });
    const same = ops('@table("t") model A { 1 x: i32 }', '@renamed("A") @table("t") model B { 1 x: i32 }');
    expect(same.some(op => op.kind === "RenameModel")).toBe(false);
  });

  it("a required field made nullable is safe; nullable made required needs backfill", () => {
    expect(ops("model R { 1 a: string }", "model R { 1 a: string? }")[0])
      .toMatchObject({ kind: "ChangeFieldNullability", becameNullable: true, safety: "safe" });
    expect(ops("model R { 1 a: string? }", "model R { 1 a: string }")[0])
      .toMatchObject({ kind: "ChangeFieldNullability", becameNullable: false, safety: "needs_backfill" });
  });

  it("enum variant changes", () => {
    expect(ops("enum S { 1 a  2 b } model R { 1 s: S }", "enum S { 1 a  2 b  3 c } model R { 1 s: S }")
      .find(op => op.kind === "AddEnumVariant")).toMatchObject({ variant: "c" });
  });
});

describe("migration-sql emitter", () => {
  it("ADD / DROP / RENAME COLUMN", () => {
    expect(migrate("migration-sql", "model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string? }"))
      .toContain("ALTER TABLE r ADD COLUMN b TEXT");
    expect(migrate("migration-sql", "model R { 1 a: i32  2 b: string }", "model R { 1 a: i32 }"))
      .toContain("ALTER TABLE r DROP COLUMN b;");
    expect(migrate("migration-sql", "model R { 1 a: i32 }", "model R { 1 b: i32 }"))
      .toContain("ALTER TABLE r RENAME COLUMN a TO b;");
  });

  it("widening has no USING; narrowing has USING + LOSSY marker", () => {
    const widen = migrate("migration-sql", "model R { 1 a: i32 }", "model R { 1 a: i64 }");
    expect(widen).toContain("ALTER TABLE r ALTER COLUMN a TYPE BIGINT;");
    expect(widen).not.toContain("USING");
    const narrow = migrate("migration-sql", "model R { 1 a: i64 }", "model R { 1 a: i32 }");
    expect(narrow).toContain("USING a::INTEGER");
    expect(narrow).toContain("-- LOSSY");
  });

  it("CreateModel matches the gen --target sql CREATE TABLE", () => {
    const mig = migrate("migration-sql", "model A { 1 x: i32 }", "model A { 1 x: i32 } model B { 1 y: uuid }");
    expect(mig).toContain("CREATE TABLE b (\n  y UUID NOT NULL\n);");
  });

  it("required column without default emits a backfill TODO", () => {
    const mig = migrate("migration-sql", "model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string }");
    expect(mig).toContain("-- TODO backfill");
    expect(mig).toContain("ALTER TABLE r ADD COLUMN b TEXT;"); // nullable-add form, no NOT NULL
  });

  it("suppresses a no-op type change that collapses to the same column", () => {
    const mig = migrate("migration-sql", "model R { 1 a: [i32] }", "model R { 1 a: [i64] }");
    expect(mig).toContain("-- no-op");
    expect(mig).not.toContain("ALTER COLUMN a TYPE");
  });
});

describe("migration-surreal emitter", () => {
  it("DEFINE / REMOVE FIELD", () => {
    expect(migrate("migration-surreal", "model R { 1 a: i32 }", "model R { 1 a: i32  2 b: string? }"))
      .toContain("DEFINE FIELD b ON TABLE r TYPE option<string>;");
    expect(migrate("migration-surreal", "model R { 1 a: i32  2 b: string }", "model R { 1 a: i32 }"))
      .toContain("REMOVE FIELD b ON TABLE r;");
  });

  it("rename is a MANUAL block", () => {
    const mig = migrate("migration-surreal", "model R { 1 a: i32 }", "model R { 1 b: i32 }");
    expect(mig).toContain("-- MANUAL");
    expect(mig).toContain("DEFINE FIELD b ON TABLE r");
  });

  it("enum variant add re-defines dependent fields with updated ASSERT", () => {
    const mig = migrate(
      "migration-surreal",
      "enum S { 1 a  2 b } model R { 1 s: S }",
      "enum S { 1 a  2 b  3 c } model R { 1 s: S }",
    );
    expect(mig).toContain("$value INSIDE ['a', 'b', 'c']");
  });
});

describe("native enum migrations (SQL)", () => {
  const base = "enum Status { 1 a  2 b } model R { 1 s: Status }";

  it("new enum → CREATE TYPE", () => {
    const mig = migrate("migration-sql", "model R { 1 x: i32 }", base + " ");
    expect(mig).toContain("CREATE TYPE status AS ENUM ('a', 'b');");
  });

  it("added variant → ALTER TYPE ADD VALUE", () => {
    const mig = migrate("migration-sql", base, "enum Status { 1 a  2 b  3 c } model R { 1 s: Status }");
    expect(mig).toContain("ALTER TYPE status ADD VALUE IF NOT EXISTS 'c';");
  });

  it("renamed variant (same ordinal) → ALTER TYPE RENAME VALUE", () => {
    const mig = migrate("migration-sql", base, "enum Status { 1 a  2 bee } model R { 1 s: Status }");
    expect(mig).toContain("ALTER TYPE status RENAME VALUE 'b' TO 'bee';");
  });

  it("removed variant → MANUAL recreate block (PostgreSQL limitation)", () => {
    const mig = migrate("migration-sql", base, "enum Status { 1 a } model R { 1 s: Status }");
    expect(mig).toContain("PostgreSQL cannot drop enum value 'b'");
  });

  it("@renamed enum → ALTER TYPE RENAME TO", () => {
    const mig = migrate(
      "migration-sql",
      "enum Status { 1 a } model R { 1 s: Status }",
      '@renamed("Status") enum State { 1 a } model R { 1 s: State }',
    );
    expect(mig).toContain("ALTER TYPE status RENAME TO state;");
  });

  it("removed enum → DROP TYPE", () => {
    const mig = migrate("migration-sql", base, "model R { 1 x: i32 }");
    expect(mig).toContain("DROP TYPE status;");
  });
});
