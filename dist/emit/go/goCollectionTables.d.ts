import type { CollectionIdentity } from "../../registry/collectionName.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { GoImports } from "./goCollectionTypes.js";
/** Names the generated file declares besides the schema's types. */
export declare const FILE_LEVEL_NAMES: readonly string[];
/** `Photo` is `Photos`, `AlbumPhoto` is `AlbumPhotos`; the SDK's resource name with a capital. */
export declare function tableFieldName(modelName: string): string;
export declare function tableFieldNames(descriptor: SchemaDescriptor): string[];
export declare function constantsSource(identity: CollectionIdentity, scopes: string[]): string;
export declare function schemaSource(publishedDescriptor: string): string;
export declare function tablesSource(descriptor: SchemaDescriptor, imports: GoImports): string;
//# sourceMappingURL=goCollectionTables.d.ts.map