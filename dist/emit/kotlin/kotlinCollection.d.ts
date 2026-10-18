import type { CollectionIdentity } from "../../registry/collectionName.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
/** The plural of the last word of a camel-cased name: `memory` is `memories`, `address` is `addresses`. */
export declare function pluralize(name: string): string;
/** `@neoworks/contacts` is `ContactsCollection`. */
export declare function collectionClassName(identity: CollectionIdentity): string;
/** `Photo` is `photos`, `AlbumPhoto` is `albumPhotos`. */
export declare function resourceName(modelName: string): string;
export declare function collectionSource(identity: CollectionIdentity, descriptor: SchemaDescriptor, packageName: string): string;
//# sourceMappingURL=kotlinCollection.d.ts.map