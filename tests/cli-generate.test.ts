// tests/cli-generate.test.ts
// The CLI is where the ordinal ledger's safety property actually lives: it is
// the layer that decides whether the lockfile may be written. Those decisions
// are invisible to the pure `reconcileLedger` tests, so they are driven here
// through the real binary.

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "openschema-cli-"));
  workspaces.push(workspace);
});

const V1 = `namespace t
model M {
  1 id: uuid
  2 label: string
}`;

interface RunResult {
  exitCode: number;
  stdout:   string;
  stderr:   string;
  output:   string;
}

function writeSchema(source: string): string {
  const path = join(workspace, "m.schema");
  writeFileSync(path, source, "utf8");
  return path;
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
  const child = Bun.spawnSync({
    cmd: ["bun", "run", CLI, ...args],
    // A stray CI variable in the developer's own shell would otherwise flip
    // every case in this file into read-only mode.
    env: { ...process.env, CI: "", ...env },
  });
  const stdout = child.stdout.toString();
  const stderr = child.stderr.toString();
  return { exitCode: child.exitCode ?? 1, stdout, stderr, output: stdout + stderr };
}

function lockPath(): string {
  return join(workspace, "openschema.lock");
}

function generate(args: string[] = [], env: Record<string, string> = {}): RunResult {
  return run([join(workspace, "m.schema"), "-t", "codec", "-o", join(workspace, "out"), ...args], env);
}

describe("the default command", () => {
  it("generates without a `gen` verb", () => {
    writeSchema(V1);
    const result = generate();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(workspace, "out", "schema.codec.ts"))).toBe(true);
  });

  it("still accepts the `gen` alias", () => {
    writeSchema(V1);
    const result = run(["gen", join(workspace, "m.schema"), "-t", "codec", "-o", join(workspace, "out")]);
    expect(result.exitCode).toBe(0);
  });

  it("names the available targets when --target is missing", () => {
    writeSchema(V1);
    const result = run([join(workspace, "m.schema")]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("--target is required");
    expect(result.output).toContain("codec");
  });

  it("routes a subcommand name to that subcommand, not to generate", () => {
    writeSchema(V1);
    const result = run(["parse", join(workspace, "m.schema")]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("is valid");
  });
});

describe("the lockfile maintains itself", () => {
  it("creates it on the first run and says so", () => {
    writeSchema(V1);
    const result = generate();
    expect(result.exitCode).toBe(0);
    expect(existsSync(lockPath())).toBe(true);
    expect(result.output).toContain("commit it");
  });

  it("stays quiet when nothing changed", () => {
    writeSchema(V1);
    generate();
    const before = readFileSync(lockPath(), "utf8");

    const second = generate();
    expect(second.output).not.toContain("ordinal ledger");
    expect(readFileSync(lockPath(), "utf8")).toBe(before);
  });

  it("records a new ordinal without a second command", () => {
    writeSchema(V1);
    generate();

    writeSchema(`${V1.slice(0, -1)}  3 note: string?\n}`);
    const result = generate();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).spaces["model:t.M"].ordinals["3"].state)
      .toBe("active");
  });

  it("retires an ordinal whose field was deleted", () => {
    writeSchema(V1);
    generate();

    writeSchema("namespace t\nmodel M {\n  1 id: uuid\n}");
    expect(generate().exitCode).toBe(0);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).spaces["model:t.M"].ordinals["2"].state)
      .toBe("retired");
  });
});

// Auto-maintenance must not turn into auto-forgiveness: the whole point of the
// ledger is that these two edits cannot be waved through.
describe("auto-maintenance never launders a violation", () => {
  it("rejects reusing a retired ordinal and leaves the lockfile alone", () => {
    writeSchema(V1);
    generate();
    writeSchema("namespace t\nmodel M {\n  1 id: uuid\n}");
    generate();
    const retired = readFileSync(lockPath(), "utf8");

    writeSchema("namespace t\nmodel M {\n  1 id: uuid\n  2 somethingElse: string\n}");
    const result = generate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2007");
    expect(readFileSync(lockPath(), "utf8")).toBe(retired);
  });

  it("rejects an encoding change the compatibility checker calls safe", () => {
    writeSchema("namespace t\nmodel M {\n  1 id: uuid\n  2 tags: [string]\n}");
    generate();

    writeSchema("namespace t\nmodel M {\n  1 id: uuid\n  2 tags: [string]?\n}");
    const result = generate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2010");
  });
});

describe("read-only mode", () => {
  it("refuses to update a stale ledger when CI is set", () => {
    writeSchema(V1);
    generate();
    const before = readFileSync(lockPath(), "utf8");

    writeSchema(`${V1.slice(0, -1)}  3 note: string?\n}`);
    const result = generate([], { CI: "true" });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2008");
    expect(readFileSync(lockPath(), "utf8")).toBe(before);
  });

  it("refuses to rebuild a deleted ledger when CI is set", () => {
    writeSchema(V1);
    generate();
    rmSync(lockPath());

    const result = generate([], { CI: "true" });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2011");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("applies the same rule to --frozen outside CI", () => {
    writeSchema(V1);
    generate();
    writeSchema(`${V1.slice(0, -1)}  3 note: string?\n}`);

    const result = generate(["--frozen"]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2008");
  });

  it("lets --write-lock override the CI default", () => {
    writeSchema(V1);
    generate();

    writeSchema(`${V1.slice(0, -1)}  3 note: string?\n}`);
    const result = generate(["--write-lock"], { CI: "true" });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(lockPath(), "utf8")).toContain('"3"');
  });

  // The directive travels with the schema, so disarming it is a visible diff.
  it("#requireLedger makes a missing lockfile an error, not a fresh baseline", () => {
    writeSchema(`#requireLedger\n${V1}`);

    const result = generate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("OS2011");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("#requireLedger still allows an existing lockfile to be updated", () => {
    writeSchema(V1);
    generate();

    writeSchema(`#requireLedger\n${V1.slice(0, -1)}  3 note: string?\n}`);
    expect(generate().exitCode).toBe(0);
    expect(readFileSync(lockPath(), "utf8")).toContain('"3"');
  });
});

describe("--no-lock", () => {
  it("skips the ledger entirely", () => {
    writeSchema(V1);
    const result = generate(["--no-lock"]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(lockPath())).toBe(false);
  });
});
