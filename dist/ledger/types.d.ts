import type { EncodingSignature } from "../emit/codec/wireFormat.js";
export declare const LOCKFILE_VERSION = 1;
export declare const DEFAULT_LOCKFILE_NAME = "openschema.lock";
/** `retired` and `reserved` are both spent; only `active` may be encoded. */
export type OrdinalState = "active" | "retired" | "reserved";
export type SpaceKind = "model" | "overlay" | "enum" | "oneof";
export interface OrdinalEntry {
    state: OrdinalState;
    /** Last known field/variant name. Informational; renames are legal. */
    name: string | null;
    /** Last known type, via describeType. Informational. */
    type: string | null;
    /** How the field is laid out on the wire. Drives OS2010. */
    encoding: EncodingSignature | null;
    since: string;
    retiredAt?: string;
}
export interface LedgerSpace {
    kind: SpaceKind;
    /** Overlay spaces only. */
    base?: string;
    company?: string;
    /** Keyed by ordinal, as a decimal string. */
    ordinals: Record<string, OrdinalEntry>;
}
export interface OrdinalLedger {
    lockfileVersion: number;
    generator: string;
    createdAt: string;
    updatedAt: string;
    /** True when the ledger was seeded from an existing schema rather than grown. */
    baseline: boolean;
    digest: string;
    spaces: Record<string, LedgerSpace>;
}
//# sourceMappingURL=types.d.ts.map