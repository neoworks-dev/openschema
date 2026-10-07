// src/ledger/types.ts
// The ordinal ledger: a record of every field ordinal a schema has ever used.
//
// Ordinals are the wire identity of a field. Reusing one makes previously
// encoded data decode into the wrong field, and when that data is end-to-end
// encrypted no server-side scan can ever detect it. The compatibility checker
// cannot help either — it compares two versions pairwise, so an ordinal retired
// two versions ago is invisible to it. The ledger is the durable memory that
// closes that gap.

import type { EncodingSignature } from "../emit/codec/wireFormat.js";

export const LOCKFILE_VERSION = 1;
export const DEFAULT_LOCKFILE_NAME = "openschema.lock";

/** `retired` and `reserved` are both spent; only `active` may be encoded. */
export type OrdinalState = "active" | "retired" | "reserved";

export type SpaceKind = "model" | "overlay" | "enum" | "oneof";

export interface OrdinalEntry {
  state:      OrdinalState;
  /** Last known field/variant name. Informational; renames are legal. */
  name:       string | null;
  /** Last known type, via describeType. Informational. */
  type:       string | null;
  /** How the field is laid out on the wire. Drives OS2010. */
  encoding:   EncodingSignature | null;
  /** The @neoworks.facet the field is encrypted in; absent for the default facet. Drives OS2013. */
  facet?:     string;
  since:      string;
  retiredAt?: string;
}

export interface LedgerSpace {
  kind:     SpaceKind;
  /** Overlay spaces only. */
  base?:    string;
  company?: string;
  /** Keyed by ordinal, as a decimal string. */
  ordinals: Record<string, OrdinalEntry>;
}

export interface OrdinalLedger {
  lockfileVersion: number;
  generator:       string;
  createdAt:       string;
  updatedAt:       string;
  /** True when the ledger was seeded from an existing schema rather than grown. */
  baseline:        boolean;
  digest:          string;
  spaces:          Record<string, LedgerSpace>;
}
