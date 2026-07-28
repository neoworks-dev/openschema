// src/ledger/types.ts
// The ordinal ledger: a record of every field ordinal a schema has ever used.
//
// Ordinals are the wire identity of a field. Reusing one makes previously
// encoded data decode into the wrong field, and when that data is end-to-end
// encrypted no server-side scan can ever detect it. The compatibility checker
// cannot help either — it compares two versions pairwise, so an ordinal retired
// two versions ago is invisible to it. The ledger is the durable memory that
// closes that gap.
export const LOCKFILE_VERSION = 1;
export const DEFAULT_LOCKFILE_NAME = "openschema.lock";
//# sourceMappingURL=types.js.map