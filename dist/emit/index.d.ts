import type { Emitter } from "./types.js";
export type { Emitter, EmitContext, OutputFile } from "./types.js";
export type { InternalSchema, InternalTable, InternalField, InternalIndex } from "./internal/internalEmitter.js";
export declare function getEmitter(target: string): Emitter | null;
export declare function listTargets(): string[];
//# sourceMappingURL=index.d.ts.map