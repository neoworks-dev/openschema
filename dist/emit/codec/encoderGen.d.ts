import type { ScalarKind } from "../../parser/ast.js";
import { type ModelPlan } from "./plan.js";
import { WireType } from "./wireFormat.js";
export declare function emitEncoder(plan: ModelPlan): string;
export declare function scalarWire(scalar: ScalarKind): WireType;
export declare function wireConstant(wire: WireType): string;
export declare function propertyAccess(name: string): string;
export declare function indent(text: string, spaces: number): string;
//# sourceMappingURL=encoderGen.d.ts.map