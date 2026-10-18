import type { Span } from "../../parser/ast.js";
export type DescriptorErrorCode = "OSD001" | "OSD002" | "OSD004" | "OSD005" | "OSD006" | "OSD009" | "OSD010" | "OSD011" | "OSD012" | "OSD013";
export declare class DescriptorError extends Error {
    readonly code: DescriptorErrorCode;
    readonly model: string;
    readonly field: string | null;
    readonly reason: string;
    readonly span: Span | null;
    constructor(code: DescriptorErrorCode, model: string, field: string | null, reason: string, span: Span | null);
}
//# sourceMappingURL=errors.d.ts.map