// src/engine/types.ts
// All types produced and consumed by the diff engine.

import type { CompatMode } from "../parser/ast.js";

// ── Severity ──────────────────────────────────────────────────────────────────
//
//  "reader" and "writer" are from the perspective of application code, not
//  schema versions:
//
//    breaking_reader  — existing code that SELECTs / reads from this schema
//                       will break (column gone, type narrowed, etc.)
//
//    breaking_writer  — existing code that INSERTs / writes to this schema
//                       will break (required column added, unique constraint
//                       added that existing data may violate, etc.)
//
//    breaking_both    — breaks both readers and writers
//
//    warning          — technically safe but worth human review
//                       (e.g. index dropped, rename detected)
//
//    safe             — no impact on any existing code or data

export type Severity =
  | "safe"
  | "warning"
  | "breaking_reader"
  | "breaking_writer"
  | "breaking_both";

// ── Change kinds ──────────────────────────────────────────────────────────────

export type ChangeKind =
  // Schema-level
  | "declaration_added"
  | "declaration_removed"
  | "declaration_renamed"
  // Record / field
  | "field_added_nullable"
  | "field_added_required_with_default"
  | "field_added_required_no_default"
  | "field_removed"
  | "field_renamed"
  | "field_type_same"
  | "field_type_widened"
  | "field_type_narrowed"
  | "field_type_incompatible"
  | "field_made_nullable"
  | "field_made_required"
  | "field_added_required"
  // Enum
  | "variant_added"
  | "variant_removed"
  | "variant_renamed"
  | "variant_renumbered"
  // Type alias
  | "type_alias_changed";

// ── Change ────────────────────────────────────────────────────────────────────

export interface Change {
  /** Dotted path to the changed element, e.g. "Order.total" or "OrderStatus.cancelled" */
  path:      string;
  /** Short rule code — allows targeted suppression, e.g. "R003" */
  ruleId:    string;
  /** Machine-readable change kind */
  kind:      ChangeKind;
  /** Impact severity */
  severity:  Severity;
  /** Human-readable explanation of why this is or isn't breaking */
  rationale: string;
  /** Short description of the old state (omitted for additions) */
  before?:   string;
  /** Short description of the new state (omitted for removals) */
  after?:    string;
}

// ── Diff result ───────────────────────────────────────────────────────────────

export interface DiffResult {
  /** Every change detected, in declaration order */
  changes:  Change[];
  /** Subset that are breaking under at least one compat mode */
  breaking: Change[];
  /** Subset that are warnings */
  warnings: Change[];
  /**
   * Returns true if all changes are compatible with the given mode.
   *
   * backward — new schema can read data written by old schema.
   *            Violations: breaking_reader, breaking_both.
   *
   * forward  — old schema can read data written by new schema.
   *            Violations: breaking_writer, breaking_both.
   *
   * full     — both backward and forward must hold.
   *            Violations: any breaking_* severity.
   *
   * none     — no enforcement; always returns true.
   */
  isCompatible(mode: CompatMode): boolean;
  /** The subset of changes that violate the given mode */
  violations(mode: CompatMode): Change[];
}