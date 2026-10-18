import type { ScalarKind, Span } from "../../parser/ast.js";
import type { ResolvedField, ResolvedModel, ResolvedSchema } from "../../resolver/types.js";
import { WireType } from "./wireFormat.js";
export declare const UNKNOWN_PROPERTY = "$unknown";
/** The message a `File` value is encoded as; see filePlan.ts. */
export declare const FILE_MESSAGE_NAME = "File";
/**
 * A `ref<Model>` value is the message `Ref { 1 id: uuid, 2 key: bytes? }`. The
 * key is the target record's key, which only the Neoworks core writes and reads;
 * in generated code a reference is its id alone.
 */
export declare const REF_MESSAGE_NAME = "Ref";
export type ValueShape = {
    kind: "scalar";
    scalar: ScalarKind;
} | {
    kind: "ref";
    model: string;
} | {
    kind: "enum";
    name: string;
} | {
    kind: "message";
    name: string;
} | {
    kind: "file";
} | {
    kind: "decimal";
    precision: number;
    scale: number;
} | {
    kind: "oneof";
    variants: OneofVariantPlan[];
};
export interface OneofVariantPlan {
    ordinal: number;
    name: string;
    value: ValueShape;
}
export type Container = {
    kind: "singular";
    nullable: boolean;
} | {
    kind: "repeatedPacked";
} | {
    kind: "repeatedLen";
} | {
    kind: "wrapperRepeated";
    packed: boolean;
} | {
    kind: "map";
    key: ScalarKind;
} | {
    kind: "wrapperMap";
    key: ScalarKind;
};
export interface FieldPlan {
    ordinal: number;
    name: string;
    /** `.name`, or `["odd name"]` for backtick-escaped identifiers. */
    accessor: string;
    container: Container;
    value: ValueShape;
    tsType: string;
    /** True when decode must reject an absent field. */
    required: boolean;
    span: Span;
}
export interface ModelPlan {
    name: string;
    fields: FieldPlan[];
}
export declare function planModel(model: ResolvedModel, fields: ResolvedField[], schema: ResolvedSchema): ModelPlan;
/**
 * Absence is `undefined`, spelled as an optional property — the wire format has
 * no null, only present and absent. Non-nullable repeated and map fields stay
 * required because the decoder always assigns them an empty collection.
 */
export declare function isOptional(container: Container): boolean;
export declare function renderTsType(container: Container, value: ValueShape): string;
export declare function valueTsType(value: ValueShape): string;
/** The wire type a singular value of this shape occupies. */
export declare function wireTypeOf(value: ValueShape): WireType;
//# sourceMappingURL=plan.d.ts.map