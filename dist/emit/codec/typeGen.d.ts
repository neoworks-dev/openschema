import type { DeclSymbol } from "../../resolver/types.js";
import { type ModelPlan } from "./plan.js";
export declare function emitEnum(symbol: DeclSymbol): string;
export declare function emitInterface(plan: ModelPlan): string;
/**
 * KNOWN_* guards against an unknown field re-entering at a tag the schema owns.
 * RETIRED_* is empty until the ordinal ledger fills it; the decoder drops those
 * tags rather than preserving them, so deleting a field does not grow every row
 * on every device forever.
 */
export declare function emitTagSets(plan: ModelPlan): string;
//# sourceMappingURL=typeGen.d.ts.map