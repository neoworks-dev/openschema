import type { Span } from "../../parser/ast.js";
export type CodecErrorCode = "OSC001" | "OSC002" | "OSC003" | "OSC004" | "OSC005" | "OSC006" | "OSC007" | "OSC008";
export declare class CodecUnsupportedError extends Error {
    readonly code: CodecErrorCode;
    readonly model: string;
    readonly field: string | null;
    readonly reason: string;
    readonly span: Span | null;
    constructor(code: CodecErrorCode, model: string, field: string | null, reason: string, span: Span | null);
}
//# sourceMappingURL=errors.d.ts.map