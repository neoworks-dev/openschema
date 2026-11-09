import type { CollectionIdentity } from "../../registry/collectionName.js";
import { pluralize } from "../collection/pluralize.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
export { pluralize };
/** `@neoworks/contacts` is `ContactsCollection`. */
export declare function collectionClassName(identity: CollectionIdentity): string;
/** `Photo` is `photos`, `AlbumPhoto` is `albumPhotos`. */
export declare function resourceName(modelName: string): string;
export declare function collectionSource(identity: CollectionIdentity, descriptor: SchemaDescriptor, packageName: string): string;
//# sourceMappingURL=kotlinCollection.d.ts.map