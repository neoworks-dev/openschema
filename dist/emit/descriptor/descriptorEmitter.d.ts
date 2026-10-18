import type { ResolvedSchema } from "../../resolver/types.js";
import type { EmitContext, Emitter } from "../types.js";
import { type SchemaDescriptor } from "./descriptorTypes.js";
export declare const descriptorEmitter: Emitter;
/** Whether the schema defines Neoworks tables, which is what makes it a collection with a descriptor. */
export declare function definesNeoworksTables(schema: ResolvedSchema): boolean;
/** The descriptor text exactly as `openschema publish` uploads it: no company overlay, no private fields. */
export declare function publishedDescriptor(schema: ResolvedSchema): string;
export declare function buildDescriptor(context: EmitContext): SchemaDescriptor;
//# sourceMappingURL=descriptorEmitter.d.ts.map