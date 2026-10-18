import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
export declare const MODELS_IMPORTS: string[];
export declare function modelsSource(descriptor: SchemaDescriptor, packageName: string): string;
/** Every type name the models source declares, for collision checks. */
export declare function declaredTypeNames(descriptor: SchemaDescriptor): string[];
//# sourceMappingURL=kotlinModels.d.ts.map