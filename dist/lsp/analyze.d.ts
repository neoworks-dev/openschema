import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import type { Program } from "../parser/ast.js";
import type { ResolvedSchema } from "../resolver/types.js";
export interface AnalyzeResult {
    diagnostics: LspDiagnostic[];
    schema: ResolvedSchema | null;
    program: Program | null;
}
/** Reads any sibling module: prefer a live editor buffer, fall back to disk. */
export type DocumentTextProvider = (path: string) => string | null;
export declare function analyze(uri: string, text: string, liveText: DocumentTextProvider): AnalyzeResult;
//# sourceMappingURL=analyze.d.ts.map