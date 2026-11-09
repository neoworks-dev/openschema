import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { GoImports } from "./goCollectionTypes.js";
export declare function handleTypeName(modelName: string): string;
export declare function handleConstructorName(modelName: string): string;
export declare function fieldsValueName(modelName: string): string;
/** The names the handles source declares, for collision checks. */
export declare function handleNames(descriptor: SchemaDescriptor): string[];
export declare function handlesSource(descriptor: SchemaDescriptor, imports: GoImports): string[];
//# sourceMappingURL=goCollectionHandles.d.ts.map