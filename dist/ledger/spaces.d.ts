import type { Span } from "../parser/ast.js";
import type { ResolvedSchema } from "../resolver/types.js";
import { type EncodingSignature } from "../emit/codec/wireFormat.js";
import type { SpaceKind } from "./types.js";
export interface ObservedOrdinal {
    ordinal: number;
    name: string;
    type: string | null;
    encoding: EncodingSignature | null;
    /** The @neoworks.facet name; null for the default facet and for non-field ordinals. */
    facet: string | null;
    span: Span;
}
export interface ObservedSpace {
    id: string;
    kind: SpaceKind;
    base?: string;
    company?: string;
    declared: ObservedOrdinal[];
    /** Ordinals reserved in source, to be absorbed into the ledger. */
    reserved: number[];
    /** Space ids whose spent ordinals also apply here (a record's base chain). */
    inheritsFrom: string[];
}
export declare function modelSpaceId(qualifiedName: string): string;
export declare function overlaySpaceId(base: string, company: string): string;
export declare function enumSpaceId(qualifiedName: string): string;
export declare function oneofSpaceId(owner: string, fieldOrdinal: number): string;
export declare function collectSpaces(schema: ResolvedSchema): ObservedSpace[];
//# sourceMappingURL=spaces.d.ts.map