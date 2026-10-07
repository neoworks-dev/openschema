// src/ledger/merge.ts
// Reconcile observed ordinal spaces against a stored ledger.
//
// One function serves validation, update, and CI, so the checker and the writer
// can never drift apart: `check` reports what `update` would write.

import type { Diagnostic, DiagnosticSeverity } from "../resolver/types.js";
import type { ObservedOrdinal, ObservedSpace } from "./spaces.js";
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
  const spent = buildSpentIndex(spaces, current);

  for (const space of spaces) {
    // nextSpaces holds a deep clone; reconcileSpace mutates entries in place,
    // and must never reach the caller's ledger.
    const result = reconcileSpace(space, nextSpaces[space.id], spent, timestamp, diagnostics);
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

// ── Per-space reconciliation ──────────────────────────────────────────────────

function reconcileSpace(
  space: ObservedSpace,
  stored: LedgerSpace | undefined,
  spent: SpentIndex,
  timestamp: string,
  diagnostics: Diagnostic[],
): { space: LedgerSpace; changed: boolean } {
  const ordinals: Record<string, OrdinalEntry> = stored?.ordinals ?? {};
  let changed = stored === undefined;

  const declaredOrdinals = new Set<number>();

  for (const declared of space.declared) {
    declaredOrdinals.add(declared.ordinal);
    if (reportReuse(space, declared, spent, diagnostics)) continue;

    const existing = ordinals[String(declared.ordinal)];
    if (existing === undefined) {
      ordinals[String(declared.ordinal)] = newEntry(declared, timestamp);
      changed = true;
      continue;
    }
    if (reportEncodingChange(space, declared, existing, diagnostics)) continue;
    if (reportFacetChange(space, declared, existing, diagnostics)) continue;
    if (updateEntry(existing, declared)) changed = true;
  }

  if (retireMissing(ordinals, declaredOrdinals, timestamp)) changed = true;
  if (absorbReserved(ordinals, space.reserved, timestamp)) changed = true;

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

/** OS2007: the ordinal is retired or reserved here, or in a base record's space. */
function reportReuse(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  spent: SpentIndex,
  diagnostics: Diagnostic[],
): boolean {
  const state = spent.stateOf(space, declared.ordinal);
  if (state === null) return false;

  diagnostics.push({
    code: "OS2007", severity: "error", span: declared.span,
    message:
      `Ordinal ${declared.ordinal} is ${state} in '${space.id}' and cannot be reused by ` +
      `'${declared.name}'. Existing encoded data still carries this tag.`,
  });
  return true;
}

/**
 * OS2010: the layout at a live ordinal changed. Catches the case the
 * compatibility checker calls safe — `[T]` becoming `[T]?` keeps wire type LEN
 * but moves from repeated-at-tag-N to a LEN wrapper at tag N.
 */
function reportEncodingChange(
  space: ObservedSpace,
  declared: ObservedOrdinal,
  existing: OrdinalEntry,
  diagnostics: Diagnostic[],
): boolean {
  if (existing.encoding === null || declared.encoding === null) return false;
  if (existing.encoding === declared.encoding) return false;

  diagnostics.push({
    code: "OS2010", severity: "error", span: declared.span,
    message:
      `Ordinal ${declared.ordinal} ('${declared.name}') in '${space.id}' changed encoding from ` +
      `${existing.encoding} to ${declared.encoding}. Existing encoded data will not decode.`,
  });
  return true;
}

function newEntry(declared: ObservedOrdinal, timestamp: string): OrdinalEntry {
  const entry: OrdinalEntry = {
    state: "active",
    name: declared.name,
    type: declared.type,
    encoding: declared.encoding,
    since: timestamp,
  };
  if (declared.facet !== null) entry.facet = declared.facet;
  return entry;
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
  timestamp: string,
): boolean {
  let changed = false;
  for (const [key, entry] of Object.entries(ordinals)) {
    if (entry.state !== "active") continue;
    if (declared.has(Number(key))) continue;
    entry.state = "retired";
    entry.retiredAt = timestamp;
    changed = true;
  }
  return changed;
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
function buildSpentIndex(spaces: ObservedSpace[], current: OrdinalLedger | null): SpentIndex {
  const bySpace = new Map<string, Map<number, "retired" | "reserved">>();

  for (const [id, space] of Object.entries(current?.spaces ?? {})) {
    const spent = new Map<number, "retired" | "reserved">();
    for (const [key, entry] of Object.entries(space.ordinals)) {
      if (entry.state === "active") continue;
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
