// src/registry/collectionName.ts
// The registry path of the schema a directory publishes, `@scope/name`, and the
// version it publishes, read from the openschema.yaml beside the schema.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE, parseManifest } from "./manifest.js";

export interface CollectionIdentity {
  name:    string;
  version: string;
}

/** Throws with the reason when the directory has no valid manifest. */
export function readCollectionIdentity(directory: string): CollectionIdentity {
  const path = join(directory, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new Error(`the collection target takes the registry path from ${path}, which does not exist; run \`openschema init\``);
  }
  const parsed = parseManifest(readFileSync(path, "utf8"));
  if (parsed.manifest === null) {
    throw new Error(parsed.problems.join("\n"));
  }
  return { name: `@${parsed.manifest.scope}/${parsed.manifest.name}`, version: parsed.manifest.version };
}

/** The version in the directory's manifest; null when there is none or it has problems. */
export function readManifestVersion(directory: string): string | null {
  const path = join(directory, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  const parsed = parseManifest(readFileSync(path, "utf8"));
  if (parsed.manifest === null) return null;
  return parsed.manifest.version;
}
