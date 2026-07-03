import type { ResolvedSchema } from "../resolver/types.js";
export interface OutputFile {
    path: string;
    contents: string;
}
export interface EmitContext {
    schema: ResolvedSchema;
    company: string | null;
    includePrivate: boolean;
    options: Record<string, string>;
}
export interface Emitter {
    target: string;
    fileExtension: string;
    emit(context: EmitContext): OutputFile[];
}
//# sourceMappingURL=types.d.ts.map