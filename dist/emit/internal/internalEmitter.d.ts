import type { Emitter } from "../types.js";
export interface InternalField {
    name: string;
    type: string;
}
export interface InternalIndex {
    name: string;
    fields: string[];
    unique?: boolean;
    fulltext?: boolean;
    analyzer?: string;
}
export interface InternalTable {
    name: string;
    schemafull: boolean;
    kind: string;
    visibility?: string;
    history?: boolean;
    subjectPath?: string;
    fields: InternalField[];
    indexes: InternalIndex[];
}
export interface InternalSchema {
    tables: InternalTable[];
}
export declare const internalEmitter: Emitter;
//# sourceMappingURL=internalEmitter.d.ts.map