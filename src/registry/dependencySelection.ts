// src/registry/dependencySelection.ts
// Picks one exact version of every schema a project depends on, directly or
// through other dependencies. Downloads share one folder per package, so the
// whole tree agrees on a single version of each: the highest that every
// requirement on it allows, or the locked one while it still fits.

import { compareVersions, parseVersion, parseVersionRange, rangeIncludes, type Version } from "./versionRange.js";

/** What selection needs from the registry. */
export interface DependencySource {
  /** Every published version of `@scope/name`. */
  versions(packageName: string): Promise<string[]>;
  /** The requirements a published version lists, keyed by `@scope/name`. */
  dependenciesOf(packageName: string, version: string): Promise<Record<string, string>>;
}

interface Requirement {
  range: string;
  /** `@scope/name@version` of the dependency that sets it; null for the project. */
  requiredBy: string | null;
}

/** No version of a package meets every requirement on it. */
export class DependencyConflictError extends Error {
  constructor(readonly packageName: string, readonly requirements: Requirement[]) {
    super(`no version of ${packageName} meets ${requirements.map(describeRequirement).join(" and ")}`);
    this.name = "DependencyConflictError";
  }
}

function describeRequirement(requirement: Requirement): string {
  if (requirement.requiredBy === null) return `${requirement.range} from the project`;
  return `${requirement.range} from ${requirement.requiredBy}`;
}

// A contrived tree can make the selection flip between two answers; the bound
// turns that into an error instead of a hang.
const MAX_ROUNDS = 100;

/**
 * The exact version of each package, keyed by `@scope/name`. `locked` holds the
 * versions from the lockfile, kept while every requirement still allows them.
 */
export async function selectVersions(
  projectRequirements: Record<string, string>,
  source: DependencySource,
  locked: Record<string, string> = {},
): Promise<Record<string, string>> {
  const registry = new CachedSource(source);
  let selected: Record<string, string> = {};
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = await pickVersions(await collectRequirements(projectRequirements, selected, registry), registry, locked);
    if (sameSelection(selected, next)) return next;
    selected = next;
  }
  throw new Error(`dependency selection did not settle after ${MAX_ROUNDS} rounds`);
}

/** Every requirement the project and the currently selected versions set, grouped by package. */
async function collectRequirements(
  projectRequirements: Record<string, string>,
  selected: Record<string, string>,
  registry: CachedSource,
): Promise<Map<string, Requirement[]>> {
  const requirements = new Map<string, Requirement[]>();
  addRequirements(requirements, projectRequirements, null);
  for (const [packageName, version] of Object.entries(selected)) {
    addRequirements(requirements, await registry.dependenciesOf(packageName, version), `${packageName}@${version}`);
  }
  return requirements;
}

function addRequirements(into: Map<string, Requirement[]>, ranges: Record<string, string>, requiredBy: string | null): void {
  for (const [packageName, range] of Object.entries(ranges)) {
    const existing = into.get(packageName);
    if (existing === undefined) {
      into.set(packageName, [{ range, requiredBy }]);
      continue;
    }
    existing.push({ range, requiredBy });
  }
}

async function pickVersions(
  requirements: Map<string, Requirement[]>,
  registry: CachedSource,
  locked: Record<string, string>,
): Promise<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const [packageName, onPackage] of requirements) {
    picked[packageName] = pickVersion(packageName, onPackage, await registry.versions(packageName), locked[packageName]);
  }
  return picked;
}

function pickVersion(packageName: string, requirements: Requirement[], published: string[], lockedVersion: string | undefined): string {
  const allowed = published.filter(version => meetsAll(version, requirements));
  if (allowed.length === 0) throw new DependencyConflictError(packageName, requirements);
  if (lockedVersion !== undefined && allowed.includes(lockedVersion)) return lockedVersion;
  return allowed.reduce(higherVersion);
}

function meetsAll(versionText: string, requirements: Requirement[]): boolean {
  const version = parseVersion(versionText);
  if (version === null) return false;
  return requirements.every(requirement => rangeIncludes(rangeOf(requirement), version));
}

function rangeOf(requirement: Requirement) {
  const range = parseVersionRange(requirement.range);
  if (range === null) throw new Error(`'${requirement.range}' is not a version range`);
  return range;
}

function higherVersion(left: string, right: string): string {
  if (compareVersions(parseVersion(left) as Version, parseVersion(right) as Version) >= 0) return left;
  return right;
}

function sameSelection(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftNames = Object.keys(left);
  if (leftNames.length !== Object.keys(right).length) return false;
  return leftNames.every(packageName => left[packageName] === right[packageName]);
}

/** Asks the registry about each package and version once. */
class CachedSource {
  private readonly versionLists = new Map<string, Promise<string[]>>();
  private readonly dependencyLists = new Map<string, Promise<Record<string, string>>>();

  constructor(private readonly source: DependencySource) {}

  versions(packageName: string): Promise<string[]> {
    if (!this.versionLists.has(packageName)) this.versionLists.set(packageName, this.source.versions(packageName));
    return this.versionLists.get(packageName)!;
  }

  dependenciesOf(packageName: string, version: string): Promise<Record<string, string>> {
    const key = `${packageName}@${version}`;
    if (!this.dependencyLists.has(key)) this.dependencyLists.set(key, this.source.dependenciesOf(packageName, version));
    return this.dependencyLists.get(key)!;
  }
}
