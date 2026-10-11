// src/registry/collectionName.ts
// The registry path of the schema a directory publishes, `@scope/name`, read from
// the openschema.yaml beside the schema.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE, parseManifest } from "./manifest.js";

/** Throws with the reason when the directory has no valid manifest. */
export function readCollectionName(directory: string): string {
  const path = join(directory, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new Error(`the collection target takes the registry path from ${path}, which does not exist; run \`openschema init\``);
  }
  const parsed = parseManifest(readFileSync(path, "utf8"));
  if (parsed.manifest === null) {
    throw new Error(parsed.problems.join("\n"));
  }
  return `@${parsed.manifest.scope}/${parsed.manifest.name}`;
}
