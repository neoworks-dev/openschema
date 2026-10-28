// src/registry/dependencySelection.ts
// Picks one exact version of every schema a project depends on, directly or
// through other dependencies. Downloads share one folder per package, so the
// whole tree agrees on a single version of each: the highest that every
// requirement on it allows, or the locked one while it still fits.
import { compareVersions, parseVersion, parseVersionRange, rangeIncludes } from "./versionRange.js";
/** No version of a package meets every requirement on it. */
export class DependencyConflictError extends Error {
    constructor(packageName, requirements) {
        super(`no version of ${packageName} meets ${requirements.map(describeRequirement).join(" and ")}`);
        this.packageName = packageName;
        this.requirements = requirements;
        this.name = "DependencyConflictError";
    }
}
function describeRequirement(requirement) {
    if (requirement.requiredBy === null)
        return `${requirement.range} from the project`;
    return `${requirement.range} from ${requirement.requiredBy}`;
}
// A contrived tree can make the selection flip between two answers; the bound
// turns that into an error instead of a hang.
const MAX_ROUNDS = 100;
/**
 * The exact version of each package, keyed by `@scope/name`. `locked` holds the
 * versions from the lockfile, kept while every requirement still allows them.
 */
export async function selectVersions(projectRequirements, source, locked = {}) {
    const registry = new CachedSource(source);
    let selected = {};
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const next = await pickVersions(await collectRequirements(projectRequirements, selected, registry), registry, locked);
        if (sameSelection(selected, next))
            return next;
        selected = next;
    }
    throw new Error(`dependency selection did not settle after ${MAX_ROUNDS} rounds`);
}
/** Every requirement the project and the currently selected versions set, grouped by package. */
async function collectRequirements(projectRequirements, selected, registry) {
    const requirements = new Map();
    addRequirements(requirements, projectRequirements, null);
    for (const [packageName, version] of Object.entries(selected)) {
        addRequirements(requirements, await registry.dependenciesOf(packageName, version), `${packageName}@${version}`);
    }
    return requirements;
}
function addRequirements(into, ranges, requiredBy) {
    for (const [packageName, range] of Object.entries(ranges)) {
        const existing = into.get(packageName);
        if (existing === undefined) {
            into.set(packageName, [{ range, requiredBy }]);
            continue;
        }
        existing.push({ range, requiredBy });
    }
}
async function pickVersions(requirements, registry, locked) {
    const picked = {};
    for (const [packageName, onPackage] of requirements) {
        picked[packageName] = pickVersion(packageName, onPackage, await registry.versions(packageName), locked[packageName]);
    }
    return picked;
}
function pickVersion(packageName, requirements, published, lockedVersion) {
    const allowed = published.filter(version => meetsAll(version, requirements));
    if (allowed.length === 0)
        throw new DependencyConflictError(packageName, requirements);
    if (lockedVersion !== undefined && allowed.includes(lockedVersion))
        return lockedVersion;
    return allowed.reduce(higherVersion);
}
function meetsAll(versionText, requirements) {
    const version = parseVersion(versionText);
    if (version === null)
        return false;
    return requirements.every(requirement => rangeIncludes(rangeOf(requirement), version));
}
function rangeOf(requirement) {
    const range = parseVersionRange(requirement.range);
    if (range === null)
        throw new Error(`'${requirement.range}' is not a version range`);
    return range;
}
function higherVersion(left, right) {
    if (compareVersions(parseVersion(left), parseVersion(right)) >= 0)
        return left;
    return right;
}
function sameSelection(left, right) {
    const leftNames = Object.keys(left);
    if (leftNames.length !== Object.keys(right).length)
        return false;
    return leftNames.every(packageName => left[packageName] === right[packageName]);
}
/** Asks the registry about each package and version once. */
class CachedSource {
    constructor(source) {
        this.source = source;
        this.versionLists = new Map();
        this.dependencyLists = new Map();
    }
    versions(packageName) {
        if (!this.versionLists.has(packageName))
            this.versionLists.set(packageName, this.source.versions(packageName));
        return this.versionLists.get(packageName);
    }
    dependenciesOf(packageName, version) {
        const key = `${packageName}@${version}`;
        if (!this.dependencyLists.has(key))
            this.dependencyLists.set(key, this.source.dependenciesOf(packageName, version));
        return this.dependencyLists.get(key);
    }
}
//# sourceMappingURL=dependencySelection.js.map