// The collection target writes the module apps give to `session.collection()`:
// the registry path from openschema.yaml and the descriptor exactly as publish
// uploads it. `openschema init` writes the starting point.

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { preparePublish } from "../src/registry/preparePublish";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
const workspaces: string[] = [];
let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "openschema-collection-"));
  workspaces.push(workspace);
});

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd: string): { exitCode: number; output: string } {
  const child = Bun.spawnSync({ cmd: ["bun", "run", CLI, ...args], cwd, env: { ...process.env, CI: "" } });
  return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
}

function generatedModule(directory: string): string {
  return readFileSync(join(directory, "generated", "index.ts"), "utf8");
}

describe("init", () => {
  it("writes a manifest and a schema that generate and publish", () => {
    const directory = join(workspace, "my-notes");
    const created = run(["init", directory, "--scope", "acme"], workspace);
    expect(created.exitCode).toBe(0);
    expect(readFileSync(join(directory, "openschema.yaml"), "utf8")).toContain("scope: acme\nname: my-notes\n");

    const generated = run(["my-notes.schema", "-t", "descriptor,codec,collection", "-o", "generated"], directory);
    expect(generated.exitCode).toBe(0);
    const prepared = preparePublish(directory, "openschema 0.1.0");
    expect(prepared.problems).toEqual([]);
    expect(`@${prepared.payload?.scope}/${prepared.payload?.name}`).toBe("@acme/my-notes");
  });

  it("refuses to overwrite files unless forced", () => {
    const directory = join(workspace, "notes");
    expect(run(["init", directory, "--scope", "acme"], workspace).exitCode).toBe(0);
    writeFileSync(join(directory, "openschema.yaml"), "scope: acme\nname: kept\n");

    const refused = run(["init", directory, "--scope", "acme"], workspace);
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("already exists");
    expect(readFileSync(join(directory, "openschema.yaml"), "utf8")).toBe("scope: acme\nname: kept\n");

    expect(run(["init", directory, "--scope", "acme", "--force"], workspace).exitCode).toBe(0);
    expect(readFileSync(join(directory, "openschema.yaml"), "utf8")).toContain("name: notes");
  });

  it("refuses a scope or name the registry would refuse, writing nothing", () => {
    const directory = join(workspace, "bad");
    const refused = run(["init", directory, "--scope", "Not A Handle"], workspace);
    expect(refused.exitCode).toBe(1);
    expect(existsSync(join(directory, "openschema.yaml"))).toBe(false);
  });
});

describe("the collection target", () => {
  function scaffold(): string {
    const directory = join(workspace, "recipes");
    expect(run(["init", directory, "--scope", "acme", "--name", "recipes"], workspace).exitCode).toBe(0);
    return directory;
  }

  it("names the collection from the manifest and carries the published descriptor", () => {
    const directory = scaffold();
    expect(run(["recipes.schema", "-t", "descriptor,collection", "-o", "generated"], directory).exitCode).toBe(0);

    const module = generatedModule(directory);
    const descriptor = readFileSync(join(directory, "generated", "schema.descriptor.json"), "utf8");
    expect(module).toContain("name: '@acme/recipes'");
    expect(module).toContain(`descriptor: ${JSON.stringify(descriptor)},`);
    expect(preparePublish(directory, "openschema 0.1.0").payload?.descriptor).toBe(descriptor);
  });

  it("re-exports the codec only when the codec target runs in the same invocation", () => {
    const directory = scaffold();
    run(["recipes.schema", "-t", "collection", "-o", "generated"], directory);
    expect(generatedModule(directory)).not.toContain("export * from");

    run(["recipes.schema", "-t", "collection,codec", "-o", "generated"], directory);
    expect(generatedModule(directory)).toContain("export * from './schema.codec.ts'");
  });

  it("needs an openschema.yaml beside the schema", () => {
    const directory = scaffold();
    rmSync(join(directory, "openschema.yaml"));
    const refused = run(["recipes.schema", "-t", "collection", "-o", "generated"], directory);
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("openschema.yaml");
    expect(existsSync(join(directory, "generated", "index.ts"))).toBe(false);
  });

  it("needs a schema that defines Neoworks nodes", () => {
    const directory = scaffold();
    writeFileSync(join(directory, "recipes.schema"), "namespace acme.recipes\nmodel Plain {\n  1 id: uuid\n}\n");
    const refused = run(["recipes.schema", "-t", "collection", "-o", "generated"], directory);
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("@neoworks.node");
  });
});
