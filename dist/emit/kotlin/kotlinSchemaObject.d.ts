import type { CollectionIdentity } from "../../registry/collectionName.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
/** `@neoworks/contacts` is `ContactsSchema`. */
export declare function schemaObjectName(identity: CollectionIdentity): string;
export declare function schemaObjectSource(identity: CollectionIdentity, publishedDescriptor: string, descriptor: SchemaDescriptor, packageName: string): string;
/** A one-line Kotlin string literal; `$` is escaped because the descriptor holds patterns that end in it. */
export declare function kotlinString(text: string): string;
//# sourceMappingURL=kotlinSchemaObject.d.ts.map