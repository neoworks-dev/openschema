import type { ResolvedSchema } from "../../resolver/types.js";
import type { ValueShape } from "../codec/plan.js";
import type { ModelDescriptor, SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { GoImports } from "./goCollectionTypes.js";
type OneofShape = Extract<ValueShape, {
    kind: "oneof";
}>;
interface OneofDeclaration {
    name: string;
    shape: OneofShape;
}
/** Doc comments from the schema, by local name; the descriptor does not carry them. */
export interface SchemaDocs {
    models: Map<string, {
        doc: string | null;
        fields: Map<string, string | null>;
    }>;
    enums: Map<string, string | null>;
}
export declare function docsOf(schema: ResolvedSchema): SchemaDocs;
export declare function modelsSource(descriptor: SchemaDescriptor, docs: SchemaDocs, imports: GoImports): string[];
/** The oneof of every field of a model, with those nested in a variant after the one that holds them. */
export declare function oneofsOf(model: ModelDescriptor): OneofDeclaration[];
/** Every type name the models source declares, for collision checks. */
export declare function declaredTypeNames(descriptor: SchemaDescriptor): string[];
export {};
//# sourceMappingURL=goCollectionModels.d.ts.map