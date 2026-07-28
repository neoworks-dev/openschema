import { type LedgerSpace, type OrdinalLedger } from "./types.js";
/**
 * The lockfile sits beside the entry schema. There is deliberately no
 * upward-directory search: a security control that resolves by walking parent
 * directories is hard to reason about, and a directory of schemas is already the
 * unit this CLI publishes.
 */
export declare function defaultLockPath(entryPath: string): string;
export interface LoadedLedger {
    ledger: OrdinalLedger | null;
    /** Set when the file exists but cannot be trusted. */
    integrityError: string | null;
}
export declare function loadLedger(path: string): LoadedLedger;
/**
 * Serialize with sorted keys and numerically-sorted ordinals, so an unchanged
 * ledger re-serializes byte-identically and git diffs stay minimal.
 */
export declare function serializeLedger(ledger: OrdinalLedger): string;
/**
 * sha256 over the canonical form of `spaces`.
 *
 * This catches ACCIDENTAL corruption — a botched merge-conflict resolution, an
 * editor mangling the file. It is not a security control: anyone can re-run
 * `openschema lock` and get a fresh digest. Real append-only enforcement is
 * `lock --check --base` against the git merge base.
 */
export declare function computeDigest(spaces: Record<string, LedgerSpace>): string;
export interface SupersetResult {
    ok: boolean;
    missing: string[];
}
/**
 * Assert that `candidate` still contains everything `base` recorded. Run against
 * the lockfile from the git merge base, this is what actually enforces
 * append-only — the digest cannot, since it is recomputed on every write.
 */
export declare function isSuperset(candidate: OrdinalLedger, base: OrdinalLedger): SupersetResult;
//# sourceMappingURL=io.d.ts.map