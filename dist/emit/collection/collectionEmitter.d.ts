import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import type { Emitter } from "../types.js";
export declare const COLLECTION_FILE = "index.ts";
/** The context option naming the collection, `@scope/name`; the CLI fills it from the manifest. */
export declare const COLLECTION_OPTION = "collection";
/** The context option holding the schema version, `major.minor.patch`; the CLI fills it from the manifest. */
export declare const COLLECTION_VERSION_OPTION = "collectionVersion";
/** The context option naming the codec module to re-export, set when the codec target runs too. */
export declare const CODEC_MODULE_OPTION = "codecModule";
/** The context option naming the versions module to re-export, set when the versions target runs too. */
export declare const VERSIONS_MODULE_OPTION = "versionsModule";
export declare class CollectionTargetError extends Error {
}
export declare const collectionEmitter: Emitter;
/** Only tables with a single `ref<T>` field appear; the core includes single references only. */
export declare function referencesOf(descriptor: SchemaDescriptor): Map<string, Map<string, string>>;
//# sourceMappingURL=collectionEmitter.d.ts.map