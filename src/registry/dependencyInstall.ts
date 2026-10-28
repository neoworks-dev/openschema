// src/registry/dependencyInstall.ts
// Downloads the versions selectVersions picks into .openschema/dependencies,
// each beside an openschema.yaml naming its entry, and returns what
// openschema.lock pins. Packages no longer in the tree are removed.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { DEPENDENCIES_DIRECTORY } from "../resolver/packages.js";
import type { LockedDependency } from "../ledger/types.js";
import { fetchSchemaDetail, fetchVersionDetail, type VersionDetail } from "./client.js";
import { selectVersions, type DependencySource } from "./dependencySelection.js";
import { schemaIntegrity } from "./integrity.js";
import { MANIFEST_FILE } from "./manifest.js";

/** The pinned version and integrity of every package in the tree, keyed by `@scope/name`. */
export async function installDependencies(
  projectDirectory: string,
  requirements: Record<string, string>,
  locked: Record<string, LockedDependency>,
  registry: string,
): Promise<Record<string, LockedDependency>> {
  const versions = await selectVersions(requirements, registrySource(registry), lockedVersions(locked));
  const dependenciesRoot = join(projectDirectory, DEPENDENCIES_DIRECTORY);
  const pinned: Record<string, LockedDependency> = {};
  for (const packageName of Object.keys(versions).sort()) {
    pinned[packageName] = await downloadPackage(registry, dependenciesRoot, packageName, versions[packageName], locked[packageName]);
  }
  removeOtherPackages(dependenciesRoot, versions);
  return pinned;
}

function registrySource(registry: string): DependencySource {
  return {
    versions: async packageName => {
      const [scope, name] = splitPackageName(packageName);
      return (await fetchSchemaDetail(registry, scope, name)).versions;
    },
    dependenciesOf: async (packageName, version) => {
      const [scope, name] = splitPackageName(packageName);
      return requirementsOf(await fetchVersionDetail(registry, scope, name, version, false));
    },
  };
}

function requirementsOf(detail: VersionDetail): Record<string, string> {
  return Object.fromEntries(detail.dependencies.map(dependency =>
    [`@${dependency.scope}/${dependency.name}`, dependency.requirement]));
}

function lockedVersions(locked: Record<string, LockedDependency>): Record<string, string> {
  return Object.fromEntries(Object.entries(locked).map(([packageName, entry]) => [packageName, entry.version]));
}

function splitPackageName(packageName: string): [string, string] {
  const [scope, name] = packageName.slice(1).split("/");
  return [scope, name];
}

async function downloadPackage(
  registry: string,
  dependenciesRoot: string,
  packageName: string,
  version: string,
  lockedEntry: LockedDependency | undefined,
): Promise<LockedDependency> {
  const [scope, name] = splitPackageName(packageName);
  const detail = await fetchVersionDetail(registry, scope, name, version, true);
  const integrity = schemaIntegrity(detail.files);
  if (lockedEntry !== undefined && lockedEntry.version === version && lockedEntry.integrity !== integrity) {
    throw new Error(`${packageName}@${version} does not match the integrity openschema.lock pins for it`);
  }
  rejectUnusableVersion(packageName, version, detail);

  const about = await fetchSchemaDetail(registry, scope, name);
  const manifest: Record<string, unknown> = {
    scope, name, version, title: about.title, description: about.description, entry: detail.entry,
  };
  if (detail.dependencies.length > 0) manifest.dependencies = requirementsOf(detail);
  writePackage(join(dependenciesRoot, packageName), detail, stringifyYaml(manifest));
  return { version, integrity };
}

/** Refuses a version without an entry, and file names that would write outside the package's folder. */
function rejectUnusableVersion(packageName: string, version: string, detail: VersionDetail): void {
  if (detail.entry === "") {
    throw new Error(`${packageName}@${version} was published before versions named their entry file; it needs a newer version`);
  }
  for (const file of detail.files) {
    if (!/^[^/\\]+\.schema$/.test(file.path) || file.path.startsWith(".")) {
      throw new Error(`${packageName}@${version} has a file the CLI will not write: ${file.path}`);
    }
  }
}

function writePackage(directory: string, detail: VersionDetail, manifestText: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const file of detail.files) writeFileSync(join(directory, file.path), file.contents, "utf8");
  writeFileSync(join(directory, MANIFEST_FILE), manifestText, "utf8");
}

function removeOtherPackages(dependenciesRoot: string, keep: Record<string, string>): void {
  if (!existsSync(dependenciesRoot)) return;
  for (const scopeDirectory of directoriesIn(dependenciesRoot)) {
    removeOtherPackagesInScope(join(dependenciesRoot, scopeDirectory), scopeDirectory, keep);
  }
}

function removeOtherPackagesInScope(scopePath: string, scopeDirectory: string, keep: Record<string, string>): void {
  for (const nameDirectory of directoriesIn(scopePath)) {
    if (`${scopeDirectory}/${nameDirectory}` in keep) continue;
    rmSync(join(scopePath, nameDirectory), { recursive: true, force: true });
  }
}

function directoriesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
}
