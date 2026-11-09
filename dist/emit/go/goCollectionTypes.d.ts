import type { ScalarKind } from "../../parser/ast.js";
import type { Container, ValueShape } from "../codec/plan.js";
import type { FieldDescriptor } from "../descriptor/descriptorTypes.js";
export declare const COLLECTIONS_IMPORT = "github.com/neoworks-dev/sdk-go/collections";
export declare const VAULT_IMPORT = "github.com/neoworks-dev/sdk-go/vault";
/** The Go imports a generated file needs; each type mapping that uses a package adds it. */
export declare class GoImports {
    private readonly paths;
    add(path: string): void;
    sorted(): string[];
}
export declare const JSON_IMPORT = "encoding/json";
/** The Go type of a value that is not a list or a map element or a oneof variant: `native` selects the plain type. */
export declare function valueType(value: ValueShape, oneofName: string, imports: GoImports, native: boolean): string;
/** The type a number handle compares: the plain Go type of the scalar. */
export declare function nativeScalarType(scalar: ScalarKind, imports: GoImports): string;
/** JSON object keys: encoding/json writes integer keys as decimal text and cannot take bool keys, whose text is `true` or `false`. */
export declare function mapKeyType(key: ScalarKind, imports: GoImports): string;
/** A list or a map the schema marks optional: unset it is JSON null. */
export declare function isNullableCollection(container: Container): boolean;
/** The type of a field's value without the pointer that marks an optional single value. */
export declare function fieldValueType(field: FieldDescriptor, oneofName: string, imports: GoImports): string;
/** The type of the struct field. */
export declare function fieldType(field: FieldDescriptor, oneofName: string, imports: GoImports): string;
/** The struct tag of the field: its JSON name and how the encoding treats it when unset or large. */
export declare function fieldTag(field: FieldDescriptor): string;
/** Struct fields are exported, so a schema name that does not start with a letter has no Go name. */
export declare function goFieldName(modelName: string, fieldName: string): string;
/** `Event` with a `reminder` field is `EventReminder`. */
export declare function oneofTypeName(modelName: string, fieldName: string): string;
export declare function oneofVariantTypeName(oneofName: string, variantName: string): string;
//# sourceMappingURL=goCollectionTypes.d.ts.map