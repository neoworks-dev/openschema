// tests/ignore-hint.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ignoreHint } from "../src/cli/ignoreHint";

let directory = "";
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** A project in `directory`/schema, optionally inside a git repository and with downloads. */
function project(options: { git: boolean; downloads: boolean; gitignore?: string }): string {
  directory = mkdtempSync(join(tmpdir(), "openschema-ignore-hint-"));
  const projectDirectory = join(directory, "schema");
  mkdirSync(projectDirectory);
  writeFileSync(join(projectDirectory, "openschema.yaml"), "scope: acme\n");
  if (options.git) spawnSync("git", ["init", "--quiet"], { cwd: directory });
  if (options.downloads) mkdirSync(join(projectDirectory, ".openschema/dependencies"), { recursive: true });
  if (options.gitignore !== undefined) writeFileSync(join(directory, ".gitignore"), options.gitignore);
  return projectDirectory;
}

describe("ignoreHint", () => {
  it("recommends ignoring downloads git would track", () => {
    const projectDirectory = project({ git: true, downloads: true });
    expect(ignoreHint([projectDirectory])).toContain("add .openschema/ to");
  });

  it("finds the project from a directory inside it", () => {
    const projectDirectory = project({ git: true, downloads: true });
    mkdirSync(join(projectDirectory, "nested"));
    expect(ignoreHint([join(projectDirectory, "nested")])).toContain("add .openschema/ to");
  });

  it("says nothing once any .gitignore covers the folder", () => {
    expect(ignoreHint([project({ git: true, downloads: true, gitignore: ".openschema/\n" })])).toBeNull();
  });

  it("says nothing without downloads, outside git, or outside a project", () => {
    expect(ignoreHint([project({ git: true, downloads: false })])).toBeNull();
    expect(ignoreHint([project({ git: false, downloads: true })])).toBeNull();
    expect(ignoreHint([tmpdir()])).toBeNull();
  });
});
