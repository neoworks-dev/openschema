// src/cli/ignoreHint.ts
// .openschema/ holds downloads that `openschema install` restores, so it does not
// belong in git. The CLI never edits .gitignore; it recommends the line instead,
// after every command, until git ignores the folder.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProjectRoot } from "../resolver/packages.js";

/**
 * The recommendation for the first of `startDirectories` inside a project, or
 * null when that project has no .openschema/, git ignores it, or the project
 * is not in a git repository.
 */
export function ignoreHint(startDirectories: string[]): string | null {
  for (const startDirectory of startDirectories) {
    const projectRoot = findProjectRoot(resolve(startDirectory), path => {
      if (!existsSync(path)) return null;
      return readFileSync(path, "utf8");
    });
    if (projectRoot !== null) return hintFor(projectRoot);
  }
  return null;
}

function hintFor(projectRoot: string): string | null {
  if (!existsSync(join(projectRoot, ".openschema"))) return null;
  // 0: ignored, 1: not ignored, anything else: no git or not a repository.
  const checked = spawnSync("git", ["check-ignore", "--quiet", ".openschema"], { cwd: projectRoot });
  if (checked.status !== 1) return null;
  return `hint: add .openschema/ to ${join(projectRoot, ".gitignore")}; it holds downloads that openschema install restores`;
}
