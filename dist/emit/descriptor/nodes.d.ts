import type { Decorator } from "../../parser/ast.js";
import type { ResolvedSchema } from "../../resolver/types.js";
import type { ModelDescriptor, NodeDescriptor } from "./descriptorTypes.js";
export declare const DEFAULT_FACET = "default";
export declare const DEFAULT_FACET_TAG = 1;
/** `models` must hold one descriptor per record, under the record's local name. */
export declare function describeNodes(schema: ResolvedSchema, models: Map<string, ModelDescriptor>): NodeDescriptor[];
/**
 * The facet's tag, derived from its name so the name stays the identity without
 * a registry of numbers. Tag 1 is the default facet; the overlay envelope tag
 * (MAX_ORDINAL) is never produced.
 */
export declare function facetTag(name: string): number;
/** The facet a field's @neoworks.facet names, or the default facet. */
export declare function facetNameOf(decorators: Decorator[]): string;
//# sourceMappingURL=nodes.d.ts.map