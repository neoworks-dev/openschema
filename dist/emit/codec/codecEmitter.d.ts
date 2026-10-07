import type { EmitContext, Emitter } from "../types.js";
import type { ResolvedSchema } from "../../resolver/types.js";
export declare const codecEmitter: Emitter;
/**
 * Overlay ordinals live in their own space and start at 1, so a base field and
 * an overlay field routinely claim the same tag. Encoding both into one message
 * would be ambiguous.
 */
export declare function rejectOverlayCompany(context: EmitContext): void;
/**
 * Named types resolve by local name across every emitter, so two models called
 * `Name` in different namespaces would silently share generated functions — and
 * therefore cross-wire their encoders.
 */
export declare function rejectDuplicateLocalNames(schema: ResolvedSchema): void;
//# sourceMappingURL=codecEmitter.d.ts.map