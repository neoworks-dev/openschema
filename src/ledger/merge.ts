// src/ledger/merge.ts
// Reconcile observed ordinal spaces against a stored ledger.
//
// One function serves validation, update, and CI, so the checker and the writer
// can never drift apart: `check` reports what `update` would write.

import type { Diagnostic, DiagnosticSeverity } from "../resolver/types.js";
import type { ObservedOrdinal, ObservedSpace } from "./spaces.js";
import { majorOf, majorPrecedes, nextMajorVersion } from "./major.js";
import {
  LOCKFILE_VERSION, type LedgerSpace, type OrdinalEntry, type OrdinalLedger,
} from "./types.js";

export type LedgerMode = "check" | "update";

export interface LedgerOptions {
  mode:           LedgerMode;
  /** #requireLedger or --frozen: a missing ledger becomes an error. */
  required:       boolean;
  /** `gen` and `lock --check` want an error; the LSP wants a warning. */
  staleSeverity:  DiagnosticSeverity;
  now:            () => string;
  generator:      string;
  /**
   * The schema version being generated or published, from openschema.yaml. A
   * retired ordinal may be reused, and an encoding changed, from the next major
   * on; without a version nothing is ever freed.
   */
  version?:       string | null;
}

export interface LedgerResult {
  diagnostics: Diagnostic[];
  next:        OrdinalLedger;
  /** True when `next` differs from the input — i.e. the lockfile is stale. */
  changed:     boolean;
}

export function reconcileLedger(
  spaces: ObservedSpace[],
  current: OrdinalLedger | null,
  options: LedgerOptions,
): LedgerResult {
  const diagnostics: Diagnostic[] = [];
  const timestamp = options.now();

  if (current === null) {
    const missing = describeMissingLedger(options);
    if (missing !== null) diagnostics.push(missing);
  }

  // Spaces absent from this run are copied through untouched. Without this, a
  // lockfile shared by two entry files would have every space belonging to the
  // other entry retired on each run, and every one of its live fields would then
  // report OS2007.
  const nextSpaces: Record<string, LedgerSpace> = cloneSpaces(current);
  let changed = current === null;

  // Built from `current` before any reconciliation, so it reflects what was
  // spent BEFORE this run's own retirements.
  const major = currentMajor(options);
  const context: RunContext = {
    spent: buildSpentIndex(spaces, current, major),
    major,
    nextMajor: nextMajorOf(options),
    timestamp,
  };

  for (const space of spaces) {
    // nextSpaces holds a deep clone; reconcileSpace mutates entries in place,
    // and must never reach the caller's ledger.
    const result = reconcileSpace(space, nextSpaces[space.id], context, diagnostics);
    nextSpaces[space.id] = result.space;
    if (result.changed) changed = true;
  }

  if (changed && options.mode === "check" && current !== null) {
    diagnostics.push({
      code: "OS2008", severity: options.staleSeverity, span: null,
      message:
        "The ordinal ledger is out of date. Regenerate locally — the lockfile is " +
        "maintained for you — and commit the result.",
    });
  }

  return {
    diagnostics,
    next: buildLedger(nextSpaces, current, timestamp, options),
    changed,
  };
}

/**
 * A missing ledger is only worth reporting when this run will not create one.
 * In update mode the baseline *is* the fix, so there is nothing to say — unless
 * the caller demanded a ledger already exist, in which case silently minting an
 * empty one would be the very disarm the requirement guards against.
 */
function describeMissingLedger(options: LedgerOptions): Diagnostic | null {
  if (options.required) {
    return {
      code: "OS2011", severity: "error", span: null,
      message:
        "No ordinal ledger found. Run `openschema lock <schema>` and commit the lockfile — " +
        "until it exists, a reused ordinal cannot be detected.",
    };
  }
  if (options.mode === "update") return null;
  return {
    code: "OS2011", severity: "warning", span: null,
    message: "No ordinal ledger found — ordinal-reuse protection is disabled.",
  };
}

/** What a run knows besides the space itself. */
interface RunContext {
  spent:     SpentIndex;
  /** The major of the version being generated, null when it has no version. */
  major:     string | null;
  /** The lowest version on the next major, null when `major` is. */
  nextMajor: string | null;
  timestamp: string;
}

function currentMajor(options: LedgerOptions): string | null {
  if (options.version === undefined || options.version === null) return null;
  return majorOf(options.version);
}

function nextMajorOf(options: LedgerOptions): string | null {
  if (options.version === undefined || options.version === null) return null;
  return nextMajorVersion(options.version);
}

// ── Per-space reconciliation ──────────────────────────────────────────────────

function reconcileSpace(
  space: ObservedSpace,
  stored: LedgerSpace | undefined,
  context: RunContext,
  diagnostics: Diagnostic[],
): { space: LedgerSpace; changed: boolean } {
  const ordinals: Record<string, OrdinalEntry> = stored?.ordinals ?? {};
  let changed = stored === undefined;

  if (recordMissingMajors(ordinals, context.major)) changed = true;
  const declaredOrdinals = new Set<number>();

  for (const declared of space.declared) {
    declaredOrdinals.add(declared.ordinal);
    if (reportReuse(space, declared, context, diagnostics)) continue;
    if (reconcileDeclared(space, declared, ordinals, context, diagnostics)) changed = true;
  }

  if (retireMissing(ordinals, declaredOrdinals, context)) changed = true;
  if (absorbReserved(ordinals, space.reserved, context.timestamp)) changed = true;

  return {
    space: {
      kind: space.kind,
      ...(space.base === undefined ? {} : { base: space.base }),
      ...(space.company === undefined ? {} : { company: space.company }),
      ordinals,
    },
    changed,
  };
}

/** Records a declared ordinal in the space; returns whether the ledger changed. */
function reconcileDeclared(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  ordinals: Record<string, OrdinalEntry>,
  context: RunContext,
  diagnostics: Diagnostic[],
): boolean {
  const key = String(declared.ordinal);
  const existing = ordinals[key];
  if (existing === undefined || isFreed(existing, context.major)) {
    ordinals[key] = newEntry(declared, context);
    return true;
  }
  if (reportEncodingChange(space, declared, existing, context, diagnostics)) return false;
  if (reportFacetChange(space, declared, existing, diagnostics)) return false;
  const adopted = adoptEncoding(existing, declared, context);
  return updateEntry(existing, declared) || adopted;
}

/** OS2007: the ordinal is retired or reserved here, or in a base record's space. */
function reportReuse(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  context: RunContext,
  diagnostics: Diagnostic[],
): boolean {
  const state = context.spent.stateOf(space, declared.ordinal);
  if (state === null) return false;

  diagnostics.push({
    code: "OS2007", severity: "error", span: declared.span,
    message:
      `Ordinal ${declared.ordinal} is ${state} in '${space.id}' and cannot be reused by ` +
      `'${declared.name}'. Existing encoded data still carries this tag.` +
      describeNextMajor(state, context),
  });
  return true;
}

/** A retired ordinal is free again on the next major; a reserved one never is. */
function describeNextMajor(state: "retired" | "reserved", context: RunContext): string {
  if (state === "reserved" || context.nextMajor === null) return "";
  return ` A release from ${context.nextMajor} on frees it.`;
}

/**
 * OS2010: the layout at a live ordinal changed. Catches the case the
 * compatibility checker calls safe — `[T]` becoming `[T]?` keeps wire type LEN
 * but moves from repeated-at-tag-N to a LEN wrapper at tag N. A later major may
 * change it, since rows of the earlier major decode with their own schema.
 */
function reportEncodingChange(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  existing: OrdinalEntry,
  context: RunContext,
  diagnostics: Diagnostic[],
): boolean {
  if (existing.encoding === null || declared.encoding === null) return false;
  if (existing.encoding === declared.encoding) return false;
  if (precedesCurrentMajor(existing, context.major)) return false;

  diagnostics.push({
    code: "OS2010", severity: "error", span: declared.span,
    message:
      `Ordinal ${declared.ordinal} ('${declared.name}') in '${space.id}' changed encoding from ` +
      `${existing.encoding} to ${declared.encoding}. Existing encoded data will not decode.`,
  });
  return true;
}

function newEntry(declared: ObservedOrdinal, context: RunContext): OrdinalEntry {
  const entry: OrdinalEntry = {
    state: "active",
    name: declared.name,
    type: declared.type,
    encoding: declared.encoding,
    since: context.timestamp,
  };
  if (declared.facet !== null) entry.facet = declared.facet;
  if (context.major !== null) entry.major = context.major;
  return entry;
}

/** The entry took its state in an earlier major than the one being generated. */
function precedesCurrentMajor(entry: OrdinalEntry, major: string | null): boolean {
  if (major === null || entry.major === undefined) return false;
  return majorPrecedes(entry.major, major);
}

/** A retired ordinal whose retirement lies in an earlier major is free to reuse. */
function isFreed(entry: OrdinalEntry, major: string | null): boolean {
  return entry.state === "retired" && precedesCurrentMajor(entry, major);
}

/** The first change of encoding in a later major is recorded as that major's. */
function adoptEncoding(entry: OrdinalEntry, declared: ObservedOrdinal, context: RunContext): boolean {
  if (entry.encoding === null || declared.encoding === null) return false;
  if (entry.encoding === declared.encoding || context.major === null) return false;
  entry.encoding = declared.encoding;
  entry.major = context.major;
  return true;
}

/**
 * Entries recorded without a major are taken to have their state in the major
 * being generated, so they free up from the next major on and never earlier.
 */
function recordMissingMajors(ordinals: Record<string, OrdinalEntry>, major: string | null): boolean {
  if (major === null) return false;
  let changed = false;
  for (const entry of Object.values(ordinals)) {
    if (entry.state === "reserved" || entry.major !== undefined) continue;
    entry.major = major;
    changed = true;
  }
  return changed;
}

/**
 * OS2013: the field moved to another @neoworks.facet, or its facet was renamed.
 * Existing nodes keep the field encrypted under the old facet's key and tag.
 */
function reportFacetChange(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  existing: OrdinalEntry,
  diagnostics: Diagnostic[],
): boolean {
  const recorded = describeFacet(existing.facet);
  const current = describeFacet(declared.facet);
  if (recorded === current) return false;

  diagnostics.push({
    code: "OS2013", severity: "error", span: declared.span,
    message:
      `Ordinal ${declared.ordinal} ('${declared.name}') in '${space.id}' moved from facet ` +
      `${recorded} to ${current}. Existing data stays encrypted in ${recorded}; facets cannot be ` +
      `renamed and fields cannot change facet.`,
  });
  return true;
}

function describeFacet(facet: string | null | undefined): string {
  if (facet === null || facet === undefined) return "default";
  return `'${facet}'`;
}

/** Renames and compatible type edits update the record silently. */
function updateEntry(entry: OrdinalEntry, declared: ObservedOrdinal): boolean {
  if (entry.name === declared.name && entry.type === declared.type && entry.state === "active") {
    return false;
  }
  entry.name = declared.name;
  entry.type = declared.type;
  entry.state = "active";
  delete entry.retiredAt;
  return true;
}

function retireMissing(
  ordinals: Record<string, OrdinalEntry>,
  declared: Set<number>,
  context: RunContext,
): boolean {
  let changed = false;
  for (const [key, entry] of Object.entries(ordinals)) {
    if (entry.state !== "active") continue;
    if (declared.has(Number(key))) continue;
    entry.state = "retired";
    entry.retiredAt = context.timestamp;
    setMajor(entry, context.major);
    changed = true;
  }
  return changed;
}

/** An entry retired without a version must not keep the major it was introduced in. */
function setMajor(entry: OrdinalEntry, major: string | null): void {
  if (major === null) {
    delete entry.major;
    return;
  }
  entry.major = major;
}

/**
 * A source `reserved` line is absorbed into the ledger, so the ordinal stays
 * spent even if someone later deletes the line.
 */
function absorbReserved(
  ordinals: Record<string, OrdinalEntry>,
  reserved: number[],
  timestamp: string,
): boolean {
  let changed = false;
  for (const ordinal of reserved) {
    if (ordinals[String(ordinal)] !== undefined) continue;
    ordinals[String(ordinal)] = {
      state: "reserved", name: null, type: null, encoding: null, since: timestamp,
    };
    changed = true;
  }
  return changed;
}

// ── Spent-ordinal index ───────────────────────────────────────────────────────

interface SpentIndex {
  stateOf(space: ObservedSpace, ordinal: number): "retired" | "reserved" | null;
}

/**
 * What is already spent, per space. A record also inherits its base chain's
 * spent ordinals: the flattened record is what gets encoded, so a base's retired
 * tag must not be re-claimed by a derived record.
 */
function buildSpentIndex(spaces: ObservedSpace[], current: OrdinalLedger | null, major: string | null): SpentIndex {
  const bySpace = new Map<string, Map<number, "retired" | "reserved">>();

  for (const [id, space] of Object.entries(current?.spaces ?? {})) {
    const spent = new Map<number, "retired" | "reserved">();
    for (const [key, entry] of Object.entries(space.ordinals)) {
      if (entry.state === "active" || isFreed(entry, major)) continue;
      spent.set(Number(key), entry.state);
    }
    bySpace.set(id, spent);
  }

  // Source reservations count immediately, before they are written to the ledger.
  for (const space of spaces) {
    const spent = bySpace.get(space.id) ?? new Map<number, "retired" | "reserved">();
    for (const ordinal of space.reserved) {
      if (spent.has(ordinal)) continue;
      spent.set(ordinal, "reserved");
    }
    bySpace.set(space.id, spent);
  }

  return {
    stateOf(space: ObservedSpace, ordinal: number) {
      for (const id of [space.id, ...space.inheritsFrom]) {
        const state = bySpace.get(id)?.get(ordinal);
        if (state !== undefined) return state;
      }
      return null;
    },
  };
}

// ── Assembly ──────────────────────────────────────────────────────────────────

function cloneSpaces(current: OrdinalLedger | null): Record<string, LedgerSpace> {
  if (current === null) return {};
  return JSON.parse(JSON.stringify(current.spaces)) as Record<string, LedgerSpace>;
}

function buildLedger(
  spaces: Record<string, LedgerSpace>,
  current: OrdinalLedger | null,
  timestamp: string,
  options: LedgerOptions,
): OrdinalLedger {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generator: options.generator,
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    baseline: current === null,
    digest: "",   // filled in by serializeLedger
    spaces,
  };
}
