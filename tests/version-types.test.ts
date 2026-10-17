// The versions target types every published version of a collection, so an app
// writes the steps that migrate a row from one version to the next with both
// sides typed.

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { emitVersionTypes, versionedName } from "../src/emit/versions/versionTypes";
import { compareVersions, snapshotVersions, writeVersionSnapshot } from "../src/registry/versionSnapshots";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
const workspaces: string[] = [];
let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "openschema-versions-"));
  workspaces.push(workspace);
});

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd: string): { exitCode: number; output: string } {
  const child = Bun.spawnSync({ cmd: ["bun", "run", CLI, ...args], cwd, env: { ...process.env, CI: "" } });
  return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
}

const CONTACT_0_4_0 = `namespace t
enum Kind { 1 person  2 company }
model Address { 1 city: string }
model Contact {
  1 name: string
  2 kind: Kind
  3 address: Address?
  4 tags: [string]
}`;

const CONTACT_1_0_0 = `namespace t
model Contact {
  1 firstName: string
  2 lastName: string
  3 since: semver?
}`;

describe("version types", () => {
  it("names a model or enum after its version", () => {
    expect(versionedName("Contact", "0.4.0")).toBe("Contact_0_4_0");
  });

  it("types every version, references pointing at the same version", () => {
    const module = emitVersionTypes([
      { version: "0.4.0", schema: resolve(parse(CONTACT_0_4_0)) },
      { version: "1.0.0", schema: resolve(parse(CONTACT_1_0_0)) },
    ], undefined);

    expect(module).toContain("export enum Kind_0_4_0 {\n  person = 1,\n  company = 2,\n}");
    expect(module).toContain("export interface Contact_0_4_0 {\n  name: string;\n  kind: Kind_0_4_0;\n  address?: Address_0_4_0;\n  tags: string[];\n}");
    expect(module).toContain("export interface Contact_1_0_0 {\n  firstName: string;\n  lastName: string;\n  since?: { major: number; minor: number; patch: number };\n}");
    expect(module).not.toContain("$unknown");
  });

  it("imports File from the codec module, and needs one when a version uses File", () => {
    const withFile = [{ version: "1.0.0", schema: resolve(parse("namespace t\nmodel Photo { 1 image: File }")) }];
    expect(emitVersionTypes(withFile, "schema.codec.ts")).toContain("import type { File } from './schema.codec.ts'");
    expect(() => emitVersionTypes(withFile, undefined)).toThrow("codec target");
  });

  it("orders versions numerically", () => {
    expect(["1.10.0", "1.2.3", "0.9.0"].sort(compareVersions)).toEqual(["0.9.0", "1.2.3", "1.10.0"]);
  });
});

describe("the versions target", () => {
  function scaffold(): string {
    const directory = join(workspace, "notes");
    expect(run(["init", directory, "--scope", "acme", "--name", "notes"], workspace).exitCode).toBe(0);
    return directory;
  }

  it("types the snapshotted versions and the manifest's version, and the collection re-exports them", () => {
    const directory = scaffold();
    const current = readFileSync(join(directory, "notes.schema"), "utf8");
    writeVersionSnapshot(directory, "0.0.9", [{ path: "notes.schema", contents: current.replace("model Note {", "model Note {\n  99 legacy: string?") }]);
    expect(snapshotVersions(directory)).toEqual(["0.0.9"]);

    const generated = run(["notes.schema", "-t", "collection,versions,codec,descriptor", "-o", "generated"], directory);
    expect(generated.exitCode).toBe(0);
    const versions = readFileSync(join(directory, "generated", "schema.versions.ts"), "utf8");
    expect(versions).toContain("export interface Note_0_0_9 {");
    expect(versions).toContain("legacy?: string;");
    expect(versions).toContain("export interface Note_0_1_0 {");
    expect(versions.indexOf("Note_0_0_9")).toBeLessThan(versions.indexOf("Note_0_1_0"));
    const collection = readFileSync(join(directory, "generated", "index.ts"), "utf8");
    expect(collection).toContain("export * from './schema.versions.ts'");
  });

  it("refuses a snapshot without the manifest's entry file", () => {
    const directory = scaffold();
    mkdirSync(join(directory, "versions", "0.0.1"), { recursive: true });
    writeFileSync(join(directory, "versions", "0.0.1", "other.schema"), "namespace t\nmodel M { 1 a: i32 }");
    const generated = run(["notes.schema", "-t", "codec,versions", "-o", "generated"], directory);
    expect(generated.exitCode).toBe(1);
    expect(generated.output).toContain("notes.schema does not exist");
  });
});
