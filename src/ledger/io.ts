// src/ledger/io.ts
// Reading, writing, and integrity-checking the lockfile. The only part of the
// ledger that touches the filesystem.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_LOCKFILE_NAME, LOCKFILE_VERSION, type LedgerSpace, type OrdinalLedger } from "./types.js";

/**
 * The lockfile sits beside the entry schema. There is deliberately no
 * upward-directory search: a security control that resolves by walking parent
 * directories is hard to reason about, and a directory of schemas is already the
 * unit this CLI publishes.
 */
export function defaultLockPath(entryPath: string): string {
  return join(dirname(entryPath), DEFAULT_LOCKFILE_NAME);
}

export interface LoadedLedger {
  ledger:         OrdinalLedger | null;
  /** Set when the file exists but cannot be trusted. */
  integrityError: string | null;
}

export function loadLedger(path: string): LoadedLedger {
  if (!existsSync(path)) return { ledger: null, integrityError: null };

  let parsed: OrdinalLedger;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as OrdinalLedger;
  } catch (error) {
    return { ledger: null, integrityError: `${path} is not valid JSON: ${(error as Error).message}` };
  }

  const structural = structuralProblem(parsed);
  if (structural !== null) return { ledger: null, integrityError: `${path}: ${structural}` };

  const expected = computeDigest(parsed.spaces);
  if (parsed.digest !== expected) {
    return {
      ledger: null,
      integrityError:
        `${path}: digest mismatch (recorded ${parsed.digest || "none"}, computed ${expected}). ` +
        `The lockfile was edited by hand or a merge conflict was resolved incorrectly.`,
    };
  }

  return { ledger: parsed, integrityError: null };
}

function structuralProblem(ledger: OrdinalLedger): string | null {
  if (typeof ledger !== "object" || ledger === null) return "not an object";
  if (ledger.lockfileVersion !== LOCKFILE_VERSION) {
    return `unsupported lockfileVersion ${ledger.lockfileVersion}, expected ${LOCKFILE_VERSION}`;
  }
  if (typeof ledger.spaces !== "object" || ledger.spaces === null) return "missing 'spaces'";
  return null;
}

/**
 * Serialize with sorted keys and numerically-sorted ordinals, so an unchanged
 * ledger re-serializes byte-identically and git diffs stay minimal.
 */
export function serializeLedger(ledger: OrdinalLedger): string {
  const spaces = sortSpaces(ledger.spaces);
  const withDigest: OrdinalLedger = { ...ledger, spaces, digest: computeDigest(spaces) };

  const ordered = {
    lockfileVersion: withDigest.lockfileVersion,
    generator:       withDigest.generator,
    createdAt:       withDigest.createdAt,
    updatedAt:       withDigest.updatedAt,
    baseline:        withDigest.baseline,
    digest:          withDigest.digest,
    spaces:          withDigest.spaces,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * sha256 over the canonical form of `spaces`.
 *
 * This catches ACCIDENTAL corruption — a botched merge-conflict resolution, an
 * editor mangling the file. It is not a security control: anyone can re-run
 * `openschema lock` and get a fresh digest. Real append-only enforcement is
 * `lock --check --base` against the git merge base.
 */
export function computeDigest(spaces: Record<string, LedgerSpace>): string {
  const canonical = JSON.stringify(sortSpaces(spaces));
  return `sha256-${createHash("sha256").update(canonical).digest("hex")}`;
}

function sortSpaces(spaces: Record<string, LedgerSpace>): Record<string, LedgerSpace> {
  const sorted: Record<string, LedgerSpace> = {};
  for (const id of Object.keys(spaces).sort()) {
    const space = spaces[id];
    sorted[id] = {
      kind: space.kind,
      ...(space.base === undefined ? {} : { base: space.base }),
      ...(space.company === undefined ? {} : { company: space.company }),
      ordinals: sortOrdinals(space.ordinals),
    };
  }
  return sorted;
}

function sortOrdinals(ordinals: LedgerSpace["ordinals"]): LedgerSpace["ordinals"] {
  const sorted: LedgerSpace["ordinals"] = {};
  for (const key of Object.keys(ordinals).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = ordinals[key];
  }
  return sorted;
}

// ── Append-only gate ──────────────────────────────────────────────────────────

export interface SupersetResult {
  ok:      boolean;
  missing: string[];
}

/**
 * Assert that `candidate` still contains everything `base` recorded. Run against
 * the lockfile from the git merge base, this is what actually enforces
 * append-only — the digest cannot, since it is recomputed on every write.
 */
export function isSuperset(candidate: OrdinalLedger, base: OrdinalLedger): SupersetResult {
  const missing: string[] = [];

  for (const [id, baseSpace] of Object.entries(base.spaces)) {
    const candidateSpace = candidate.spaces[id];
    if (candidateSpace === undefined) {
      missing.push(id);
      continue;
    }
    for (const ordinal of Object.keys(baseSpace.ordinals)) {
      if (candidateSpace.ordinals[ordinal] === undefined) missing.push(`${id}:${ordinal}`);
    }
  }

  return { ok: missing.length === 0, missing };
}
