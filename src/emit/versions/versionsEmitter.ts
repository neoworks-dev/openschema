// src/emit/versions/versionsEmitter.ts
// The `versions` target: the types of every version of a collection, from the
// snapshots in versions/ beside the manifest and the schema being generated as
// the manifest's version. The CLI fills the options from the manifest.

import type { EmitContext, Emitter, OutputFile } from "../types.js";
import { compareVersions, resolveSnapshot, snapshotVersions } from "../../registry/versionSnapshots.js";
import { emitVersionTypes, VersionTypesError, type VersionedSchema } from "./versionTypes.js";

export const VERSIONS_FILE = "schema.versions.ts";

/** The directory of openschema.yaml, which holds versions/. */
export const PROJECT_DIRECTORY_OPTION = "projectDirectory";
/** The entry file name, the same in every snapshot. */
export const ENTRY_OPTION = "entry";
/** The schema being generated is this version, `major.minor.patch`. */
export const CURRENT_VERSION_OPTION = "currentVersion";
/** The codec module of the same run, which the File type is imported from. */
export const VERSIONS_CODEC_MODULE_OPTION = "codecModule";

export const versionsEmitter: Emitter = {
  target: "versions",
  fileExtension: "ts",

  emit(context: EmitContext): OutputFile[] {
    const projectDirectory = requiredOption(context, PROJECT_DIRECTORY_OPTION);
    const entry = requiredOption(context, ENTRY_OPTION);
    const current = requiredOption(context, CURRENT_VERSION_OPTION);
    const versions: VersionedSchema[] = snapshotVersions(projectDirectory)
      .filter(version => version !== current)
      .map(version => ({ version, schema: resolveSnapshot(projectDirectory, version, entry) }));
    versions.push({ version: current, schema: context.schema });
    versions.sort((left, right) => compareVersions(left.version, right.version));
    const contents = emitVersionTypes(versions, context.options[VERSIONS_CODEC_MODULE_OPTION]);
    return [{ path: VERSIONS_FILE, contents }];
  },
};

function requiredOption(context: EmitContext, name: string): string {
  const value = context.options[name];
  if (value === undefined) {
    throw new VersionTypesError("the versions target reads the manifest beside the schema; run it through the CLI with an openschema.yaml");
  }
  return value;
}
