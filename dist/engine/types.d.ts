import type { CompatMode } from "../parser/ast.js";
export type Severity = "safe" | "warning" | "breaking_reader" | "breaking_writer" | "breaking_both";
export type ChangeKind = "declaration_added" | "declaration_removed" | "declaration_renamed" | "field_added_nullable" | "field_added_required_with_default" | "field_added_required_no_default" | "field_removed" | "field_renamed" | "field_type_same" | "field_type_widened" | "field_type_narrowed" | "field_type_incompatible" | "field_made_nullable" | "field_made_required" | "field_added_required" | "variant_added" | "variant_removed" | "variant_renamed" | "variant_renumbered" | "type_alias_changed";
export interface Change {
    /** Dotted path to the changed element, e.g. "Order.total" or "OrderStatus.cancelled" */
    path: string;
    /** Short rule code — allows targeted suppression, e.g. "R003" */
    ruleId: string;
    /** Machine-readable change kind */
    kind: ChangeKind;
    /** Impact severity */
    severity: Severity;
    /** Human-readable explanation of why this is or isn't breaking */
    rationale: string;
    /** Short description of the old state (omitted for additions) */
    before?: string;
    /** Short description of the new state (omitted for removals) */
    after?: string;
}
export interface DiffResult {
    /** Every change detected, in declaration order */
    changes: Change[];
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
//# sourceMappingURL=types.d.ts.map