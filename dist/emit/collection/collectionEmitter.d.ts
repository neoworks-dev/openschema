import type { Emitter } from "../types.js";
export declare const COLLECTION_FILE = "index.ts";
/** The context option naming the collection, `@scope/name`; the CLI fills it from the manifest. */
export declare const COLLECTION_OPTION = "collection";
/** The context option naming the codec module to re-export, set when the codec target runs too. */
export declare const CODEC_MODULE_OPTION = "codecModule";
export declare class CollectionTargetError extends Error {
}
export declare const collectionEmitter: Emitter;
//# sourceMappingURL=collectionEmitter.d.ts.map