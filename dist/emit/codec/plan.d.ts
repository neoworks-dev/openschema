import type { ScalarKind, Span } from "../../parser/ast.js";
import type { ResolvedField, ResolvedModel, ResolvedSchema } from "../../resolver/types.js";
import { WireType } from "./wireFormat.js";
export declare const UNKNOWN_PROPERTY = "$unknown";
export type ValueShape = {
    kind: "scalar";
    scalar: ScalarKind;
} | {
    kind: "enum";
    name: string;
} | {
    kind: "message";
    name: string;
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