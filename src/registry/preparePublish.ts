// src/registry/preparePublish.ts
// Everything publish checks before uploading, with no network: the manifest, the
// schema it names, the ordinal ledger and, for Neoworks collections, the
// descriptor. A published version is immutable, so nothing is uploaded unless
// every check passes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import type { ReadFileOrNull } from "../resolver/moduleGraph.js";
import type { ResolvedSchema } from "../resolver/types.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, loadLedger } from "../ledger/io.js";
import { hasDecorator } from "../emit/typeMapping.js";
import { descriptorEmitter } from "../emit/descriptor/descriptorEmitter.js";
import { DescriptorError } from "../emit/descriptor/errors.js";
import { CodecUnsupportedError } from "../emit/codec/errors.js";
import { MANIFEST_FILE, parseManifest, type Manifest } from "./manifest.js";
import type { PublishPayload } from "./client.js";

export type PreparedPublish =
  | { payload: PublishPayload; problems: [] }
  | { payload: null; problems: string[] };

class PublishRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

export function preparePublish(directory: string, generator: string): PreparedPublish {
  try {
    return { payload: buildPayload(directory, generator), problems: [] };
  } catch (error) {
    if (error instanceof PublishRefused) return { payload: null, problems: error.problems };
    throw error;
  }
}

function buildPayload(directory: string, generator: string): PublishPayload {
  const manifest = readManifest(directory);
  const entryPath = join(directory, manifest.entry);
  const schema = resolveEntry(entryPath);
  checkLedger(entryPath, schema, generator);

  const payload: PublishPayload = {
    scope: manifest.scope,
    name: manifest.name,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description,
    license: manifest.license,
    repository: manifest.repository,
    targets: [],
    files: collectSchemaFiles(directory),
  };
  const descriptor = describeNodes(schema);
  if (descriptor !== null) payload.descriptor = descriptor;
  return payload;
}

function readManifest(directory: string): Manifest {
  const path = join(directory, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new PublishRefused([`no ${MANIFEST_FILE} in ${directory}; publishing needs a manifest`]);
  }
  const parsed = parseManifest(readFileSync(path, "utf8"));
  if (parsed.manifest === null) throw new PublishRefused(parsed.problems);
  if (!existsSync(join(directory, parsed.manifest.entry))) {
    throw new PublishRefused([`${MANIFEST_FILE}: entry ${parsed.manifest.entry} does not exist`]);
  }
  return parsed.manifest;
}

const readFileOrNull: ReadFileOrNull = (path: string) => {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

function resolveEntry(entryPath: string): ResolvedSchema {
  let schema: ResolvedSchema;
  try {
    schema = resolveModules(loadProject(entryPath, readFileOrNull));
  } catch (error) {
    throw new PublishRefused([`${entryPath}: ${(error as Error).message}`]);
  }
  const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
  }
  return schema;
}

/** The lockfile must exist and already record this schema: publishing never writes it. */
function checkLedger(entryPath: string, schema: ResolvedSchema, generator: string): void {
  const lockPath = defaultLockPath(entryPath);
  const loaded = loadLedger(lockPath);
  if (loaded.integrityError !== null) throw new PublishRefused([`OS2009 ${loaded.integrityError}`]);

  const result = reconcileLedger(collectSpaces(schema), loaded.ledger, {
    mode: "check",
    required: true,
    staleSeverity: "error",
    now: () => new Date().toISOString(),
    generator,
  });
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
  }
}

/** The descriptor, exactly as the descriptor target writes it, when the schema defines Neoworks nodes. */
function describeNodes(schema: ResolvedSchema): string | null {
  const definesNodes = [...schema.records.values()].some(record => hasDecorator(record.decorators, "neoworks.node"));
  if (!definesNodes) return null;
  try {
    const [file] = descriptorEmitter.emit({ schema, company: null, includePrivate: false, options: {} });
    return file.contents;
  } catch (error) {
    throw new PublishRefused([describeEmitError(error)]);
  }
}

function describeEmitError(error: unknown): string {
  if (error instanceof DescriptorError || error instanceof CodecUnsupportedError) {
    return `${error.code} ${error.message}`;
  }
  return `descriptor: ${(error as Error).message}`;
}

function collectSchemaFiles(directory: string): { path: string; contents: string }[] {
  return readdirSync(directory)
    .filter(entry => entry.endsWith(".schema"))
    .sort()
    .map(entry => ({ path: entry, contents: readFileSync(join(directory, entry), "utf8") }));
}
