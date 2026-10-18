import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
export declare function whereClassName(modelName: string): string;
export declare function orderByClassName(modelName: string): string;
export declare function includeClassName(modelName: string): string;
export declare function sortFieldsClassName(modelName: string): string;
/** The names of the query classes a schema declares, for collision checks. */
export declare function queryClassNames(descriptor: SchemaDescriptor): string[];
export declare function queriesSource(descriptor: SchemaDescriptor, packageName: string): string;
//# sourceMappingURL=kotlinQueries.d.ts.map