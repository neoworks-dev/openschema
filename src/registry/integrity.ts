// src/registry/integrity.ts
// The integrity openschema.lock pins for a downloaded version, matching what the
// registry serves at /versions/{version}/integrity (RegistryIntegrity in apps/api).

import { createHash } from "node:crypto";

/**
 * "sha256-" and the hex SHA-256 over the files in the registry's order, each
 * written as the byte length of its path, ':', the path, the byte length of its
 * contents, ':', and the contents.
 */
export function schemaIntegrity(files: { path: string; contents: string }[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${Buffer.byteLength(file.path, "utf8")}:${file.path}`, "utf8");
    hash.update(`${Buffer.byteLength(file.contents, "utf8")}:${file.contents}`, "utf8");
  }
  return `sha256-${hash.digest("hex")}`;
}
