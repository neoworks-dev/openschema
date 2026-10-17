// src/registry/versionSnapshots.ts
// The schema files of every published version, kept beside the manifest in
// versions/<major.minor.patch>/. `publish` writes the version it uploaded and
// `versions pull` fetches the others from the registry, so generating the types
// of every version needs no network.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import type { ReadFileOrNull } from "../resolver/moduleGraph.js";
import type { ResolvedSchema } from "../resolver/types.js";

export const VERSIONS_DIRECTORY = "versions";

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function writeVersionSnapshot(projectDirectory: string, version: string, files: { path: string; contents: string }[]): string {
  const directory = join(projectDirectory, VERSIONS_DIRECTORY, version);
  mkdirSync(directory, { recursive: true });
  for (const file of files) writeFileSync(join(directory, file.path), file.contents, "utf8");
  return directory;
}

/** The snapshotted versions, oldest first. */
export function snapshotVersions(projectDirectory: string): string[] {
  const directory = join(projectDirectory, VERSIONS_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(entry => RELEASE.test(entry)).sort(compareVersions);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

const readFileOrNull: ReadFileOrNull = (path: string) => {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

/** Throws with the diagnostics when the snapshot does not resolve. */
export function resolveSnapshot(projectDirectory: string, version: string, entry: string): ResolvedSchema {
  const entryPath = join(projectDirectory, VERSIONS_DIRECTORY, version, entry);
  if (!existsSync(entryPath)) {
    throw new Error(`${entryPath} does not exist; a snapshot holds the published files under the manifest's entry name`);
  }
  const schema = resolveModules(loadProject(entryPath, readFileOrNull));
  const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`${entryPath}: ${errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
  }
  return schema;
}
