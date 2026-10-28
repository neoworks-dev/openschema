// src/resolver/packages.ts
// Package imports such as `@neoworks/shared` resolve to a schema downloaded into
// the project's .openschema/dependencies folder, next to its openschema.yaml.
// Each download keeps its manifest, which names the entry file.

import { dirname, join } from "path";
import { MANIFEST_FILE, PACKAGE_SPECIFIER, parseManifest } from "../registry/manifest.js";
import type { ReadFileOrNull } from "./moduleGraph.js";

export const DEPENDENCIES_DIRECTORY = join(".openschema", "dependencies");

/** The entry file of a downloaded package, or null when it is not downloaded. */
export type LocatePackage = (specifier: string) => string | null;

export function isPackageSpecifier(specifier: string): boolean {
  return PACKAGE_SPECIFIER.test(specifier);
}

export function packageLocator(entryId: string, readFileOrNull: ReadFileOrNull): LocatePackage {
  const projectRoot = findProjectRoot(dirname(entryId), readFileOrNull);
  if (projectRoot === null) return () => null;
  const dependenciesRoot = join(projectRoot, DEPENDENCIES_DIRECTORY);
  return specifier => packageEntry(join(dependenciesRoot, specifier), readFileOrNull);
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
