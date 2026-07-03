import type { Program, ModelDecl, EnumDecl, TypeAlias, TypeExpr, Decorator, Span, OperationDecl } from "../parser/ast.js";
export type SymbolKind = "model" | "enum" | "type_alias";
/** A parsed source unit in the module graph. */
export interface Module {
    moduleId: string;
    sourcePath: string | null;
    program: Program;
    importMap: Map<string, string>;
}
/** A named top-level declaration, resolved to its fully-qualified name. */
export interface DeclSymbol {
    kind: SymbolKind;
    localName: string;
    qualifiedName: string;
    moduleId: string;
    decl: ModelDecl | EnumDecl | TypeAlias;
    span: Span;
}
/** A record field after extends-flattening, ready for emit. */
export interface ResolvedField {
    ordinal: number;
    name: string;
    type: TypeExpr;
    isPrivate: boolean;
    doc: string | null;
    decorators: Decorator[];
    origin: "own" | "inherited";
    declaredIn: string;
    span: Span;
}
/** A record after extends-flattening. Emitters render this. */
export interface ResolvedModel {
    symbol: DeclSymbol;
    baseChain: DeclSymbol[];
    fields: ResolvedField[];
    isGeneric: boolean;
    decorators: Decorator[];
}
/** A company's private overlay on a base record. Independent ordinal space. */
export interface ResolvedOverlay {
    company: string;
    baseName: string;
    fields: ResolvedField[];
}
export type DiagnosticSeverity = "error" | "warning";
export interface Diagnostic {
    code: string;
    severity: DiagnosticSeverity;
    message: string;
    span: Span | null;
}
export interface ResolvedSchema {
    namespace: string[];
    symbols: Map<string, DeclSymbol>;
    records: Map<string, ResolvedModel>;
    enums: Map<string, DeclSymbol>;
    aliases: Map<string, DeclSymbol>;
    overlays: Map<string, Map<string, ResolvedOverlay>>;
    operations: OperationDecl[];
    diagnostics: Diagnostic[];
    hasErrors: boolean;
}
//# sourceMappingURL=types.d.ts.map