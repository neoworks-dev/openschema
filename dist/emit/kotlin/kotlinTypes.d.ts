import type { ValueShape } from "../codec/plan.js";
import type { FieldDescriptor } from "../descriptor/descriptorTypes.js";
/** Where a type is written: inside a oneof variant, a nested name could hide a model of the same name. */
export interface TypeScope {
    /** Prefix of schema type names, such as `dev.neoworks.schemas.contacts.`, or empty. */
    qualifier: string;
}
export declare const UNQUALIFIED: TypeScope;
/** The name a oneof field's generated type has; nested oneofs extend the name of the variant they sit in. */
export declare function oneofTypeName(modelName: string, fieldName: string): string;
export declare function oneofVariantTypeName(oneofName: string, variantName: string): string;
/** A value's type without serialization annotations, for places that are not serialized by plugin. */
export declare function plainValueType(value: ValueShape, oneofName: string, scope: TypeScope): string;
/** A value's type with the annotation that selects its serializer where the default one is wrong. */
export declare function annotatedValueType(value: ValueShape, oneofName: string): string;
/** The Kotlin expression of the serializer for one value. */
export declare function valueSerializer(value: ValueShape, oneofName: string, scope: TypeScope): string;
/** The type of a field as the property declares it. */
export declare function fieldType(field: FieldDescriptor, oneofName: string): string;
/** The type of a field as a plain property declares it, without serialization annotations. */
export declare function plainFieldType(field: FieldDescriptor, oneofName: string): string;
/** The Kotlin expression of the serializer for a whole field: the container around the element, nullable when the field is optional. */
export declare function fieldSerializer(field: FieldDescriptor, oneofName: string): string;
/** Optional fields default to null and unset lists and maps to empty ones, so a row read from older data decodes. */
export declare function fieldDefault(field: FieldDescriptor): string;
//# sourceMappingURL=kotlinTypes.d.ts.map