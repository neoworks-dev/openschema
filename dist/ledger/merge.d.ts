import type { Diagnostic, DiagnosticSeverity } from "../resolver/types.js";
import type { ObservedSpace } from "./spaces.js";
import { type OrdinalLedger } from "./types.js";
export type LedgerMode = "check" | "update";
export interface LedgerOptions {
    mode: LedgerMode;
    /** #requireLedger or --frozen: a missing ledger becomes an error. */
    required: boolean;
    /** `gen` and `lock --check` want an error; the LSP wants a warning. */
    staleSeverity: DiagnosticSeverity;
    now: () => string;
    generator: string;
}
export interface LedgerResult {
    diagnostics: Diagnostic[];
    next: OrdinalLedger;
    /** True when `next` differs from the input — i.e. the lockfile is stale. */
    changed: boolean;
}
export declare function reconcileLedger(spaces: ObservedSpace[], current: OrdinalLedger | null, options: LedgerOptions): LedgerResult;
//# sourceMappingURL=merge.d.ts.map