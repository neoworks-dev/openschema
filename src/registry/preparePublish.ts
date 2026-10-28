// src/registry/preparePublish.ts
// Everything publish checks before uploading, with no network: the manifest, the
// schema it names, the ordinal ledger and, for Neoworks collections, the
// descriptor. A published version is immutable, so nothing is uploaded unless
// every check passes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import type { ReadFileOrNull } from "../resolver/moduleGraph.js";
import type { Module, ResolvedSchema } from "../resolver/types.js";
import type { ImportDecl } from "../parser/ast.js";
import { DEPENDENCIES_DIRECTORY, isPackageSpecifier } from "../resolver/packages.js";
import type { LockedDependency, OrdinalLedger } from "../ledger/types.js";
import { parseVersion, parseVersionRange, rangeIncludes } from "./versionRange.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, loadLedger } from "../ledger/io.js";
import { definesNeoworksTables, publishedDescriptor } from "../emit/descriptor/descriptorEmitter.js";
import { DescriptorError } from "../emit/descriptor/errors.js";
import { CodecUnsupportedError } from "../emit/codec/errors.js";
import { MANIFEST_FILE, parseManifest, type Manifest } from "./manifest.js";
import type { PublishPayload, PublishedDependency } from "./client.js";

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
  const modules = loadEntry(entryPath);
  const requirements = { ...manifest.dependencies };
  checkImportsAreListed(modules, requirements);
  const schema = resolveEntry(modules);
  const ledger = checkLedger(entryPath, schema, generator, manifest.version);
  checkDependenciesArePinned(directory, requirements, ledger);

  const payload: PublishPayload = {
    scope: manifest.scope,
    name: manifest.name,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description,
    license: manifest.license,
    repository: manifest.repository,
    targets: [],
    entry: manifest.entry,
    files: collectSchemaFiles(directory),
    dependencies: publishedDependencies(manifest),
  };
  const descriptor = describeTables(schema);
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

function loadEntry(entryPath: string): Module[] {
  try {
    return loadProject(entryPath, readFileOrNull);
  } catch (error) {
    throw new PublishRefused([`${entryPath}: ${(error as Error).message}`]);
  }
}

function resolveEntry(modules: Module[]): ResolvedSchema {
  const schema = resolveModules(modules);
  const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
  }
  return schema;
}

/** The lockfile must exist and already record this schema: publishing never writes it. */
function checkLedger(entryPath: string, schema: ResolvedSchema, generator: string, version: string): OrdinalLedger {
  const loaded = loadLedger(defaultLockPath(entryPath));
  if (loaded.integrityError !== null) throw new PublishRefused([`OS2009 ${loaded.integrityError}`]);

  const result = reconcileLedger(collectSpaces(schema), loaded.ledger, {
    mode: "check",
    required: true,
    staleSeverity: "error",
    now: () => new Date().toISOString(),
    generator,
    version,
  });
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length > 0 || loaded.ledger === null) {
    throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
  }
  return loaded.ledger;
}

// ── Dependencies ─────────────────────────────────────────────────────────────
// Whoever depends on this version resolves its imports from its manifest, so
// every package the project's own files import must be listed there, and what
// was checked here must be what the lock pins.

function checkImportsAreListed(modules: Module[], requirements: Record<string, string>): void {
  const problems = modules
    .filter(module => module.packageName === null)
    .flatMap(module => unlistedImports(module, requirements));
  if (problems.length > 0) throw new PublishRefused(problems);
}

function unlistedImports(module: Module, requirements: Record<string, string>): string[] {
  return module.program.declarations
    .filter(declaration => declaration.kind === "import" && isPackageSpecifier(declaration.from))
    .map(declaration => (declaration as ImportDecl).from)
    .filter(specifier => !(specifier in requirements))
    .map(specifier =>
      `${module.sourcePath} imports ${specifier}, which ${MANIFEST_FILE} does not list; run openschema add ${specifier}`);
}

function checkDependenciesArePinned(directory: string, requirements: Record<string, string>, ledger: OrdinalLedger): void {
  const problems = Object.entries(requirements)
    .map(([packageName, requirement]) => pinningProblem(directory, packageName, requirement, ledger.dependencies[packageName]))
    .filter((problem): problem is string => problem !== null);
  if (problems.length > 0) throw new PublishRefused(problems);
}

function pinningProblem(directory: string, packageName: string, requirement: string, locked: LockedDependency | undefined): string | null {
  if (locked === undefined) return `${packageName} is not pinned in openschema.lock; run openschema install`;
  if (!rangeIncludes(parseVersionRange(requirement)!, parseVersion(locked.version)!)) {
    return `openschema.lock pins ${packageName}@${locked.version}, outside ${requirement}; run openschema install`;
  }
  const downloaded = downloadedVersion(join(directory, DEPENDENCIES_DIRECTORY, packageName));
  if (downloaded !== locked.version) {
    return `the downloaded ${packageName} is not the ${locked.version} openschema.lock pins; run openschema install`;
  }
  return null;
}

function downloadedVersion(packageDirectory: string): string | null {
  const manifestText = readFileOrNull(join(packageDirectory, MANIFEST_FILE));
  if (manifestText === null) return null;
  const parsed = parseManifest(manifestText);
  if (parsed.manifest === null) return null;
  return parsed.manifest.version;
}

/** The descriptor, exactly as the descriptor target writes it, when the schema defines Neoworks tables. */
function describeTables(schema: ResolvedSchema): string | null {
  if (!definesNeoworksTables(schema)) return null;
  try {
    return publishedDescriptor(schema);
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

function publishedDependencies(manifest: Manifest): PublishedDependency[] {
  if (manifest.dependencies === undefined) return [];
  return Object.entries(manifest.dependencies).map(([specifier, requirement]) => {
    const [scope, name] = specifier.slice(1).split("/");
    return { scope, name, requirement };
  });
}

function collectSchemaFiles(directory: string): { path: string; contents: string }[] {
  return readdirSync(directory)
    .filter(entry => entry.endsWith(".schema"))
    .sort()
    .map(entry => ({ path: entry, contents: readFileSync(join(directory, entry), "utf8") }));
}
