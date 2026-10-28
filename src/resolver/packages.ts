// src/resolver/packages.ts
// Package imports such as `@neoworks/shared` resolve to a schema downloaded into
// the project's .openschema/dependencies folder, next to its openschema.yaml.
// Each download keeps its manifest, which names the entry file.

import { dirname, isAbsolute, join, relative, sep } from "path";
import { MANIFEST_FILE, PACKAGE_SPECIFIER, parseManifest } from "../registry/manifest.js";
import type { ReadFileOrNull } from "./moduleGraph.js";

export const DEPENDENCIES_DIRECTORY = join(".openschema", "dependencies");

export interface PackageLocator {
  /** The entry file of a downloaded package, or null when it is not downloaded. */
  locate(specifier: string): string | null;
  /** The `@scope/name` a file was downloaded as, or null for the project's own files. */
  packageOf(path: string): string | null;
}

const OUTSIDE_A_PROJECT: PackageLocator = { locate: () => null, packageOf: () => null };

export function isPackageSpecifier(specifier: string): boolean {
  return PACKAGE_SPECIFIER.test(specifier);
}

export function packageLocator(entryId: string, readFileOrNull: ReadFileOrNull): PackageLocator {
  const projectRoot = findProjectRoot(dirname(entryId), readFileOrNull);
  if (projectRoot === null) return OUTSIDE_A_PROJECT;
  const dependenciesRoot = join(projectRoot, DEPENDENCIES_DIRECTORY);
  return {
    locate: specifier => packageEntry(join(dependenciesRoot, specifier), readFileOrNull),
    packageOf: path => packageContaining(dependenciesRoot, path),
  };
}

function packageContaining(dependenciesRoot: string, path: string): string | null {
  const inside = relative(dependenciesRoot, path);
  if (inside.startsWith("..") || isAbsolute(inside)) return null;
  const [scope, name] = inside.split(sep);
  return `${scope}/${name}`;
}

/** The nearest directory at or above `startDirectory` that holds an openschema.yaml. */
function findProjectRoot(startDirectory: string, readFileOrNull: ReadFileOrNull): string | null {
  let directory = startDirectory;
  while (readFileOrNull(join(directory, MANIFEST_FILE)) === null) {
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return directory;
}

function packageEntry(packageDirectory: string, readFileOrNull: ReadFileOrNull): string | null {
  const manifestText = readFileOrNull(join(packageDirectory, MANIFEST_FILE));
  if (manifestText === null) return null;
  const parsed = parseManifest(manifestText);
  if (parsed.manifest === null) return null;
  const entryPath = join(packageDirectory, parsed.manifest.entry);
  if (readFileOrNull(entryPath) === null) return null;
  return entryPath;
}
