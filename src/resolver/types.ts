// src/resolver/types.ts
// Types produced by the semantic resolver and consumed by emitters.

import type {
  Program, ModelDecl, EnumDecl, TypeAlias, FieldDecl, TypeExpr,
  Decorator, Span, OperationDecl, ReservedDecl,
} from "../parser/ast.js";

export type SymbolKind = "model" | "enum" | "type_alias";

/** A parsed source unit in the module graph. */
export interface Module {
  moduleId:   string;                 // canonical id (absolute path, or "<entry>")
  sourcePath: string | null;
  program:    Program;
  importMap:  Map<string, string>;    // import `from` specifier → target moduleId
}

/** A named top-level declaration, resolved to its fully-qualified name. */
export interface DeclSymbol {
  kind:          SymbolKind;
  localName:     string;          // "Person"
  qualifiedName: string;          // "schema.org.Person"
  moduleId:      string;          // the module that declared it
  decl:          ModelDecl | EnumDecl | TypeAlias;
  span:          Span;
}

/** A record field after extends-flattening, ready for emit. */
export interface ResolvedField {
  ordinal:    number;             // required after resolution
  name:       string;
  type:       TypeExpr;
  isPrivate:  boolean;
  doc:        string | null;
  decorators: Decorator[];
  origin:     "own" | "inherited";
  declaredIn: string;             // qualifiedName of the declaring record
  span:       Span;
}

/** A record after extends-flattening. Emitters render this. */
export interface ResolvedModel {
  symbol:     DeclSymbol;
  baseChain:  DeclSymbol[];       // nearest base first, root last; [] when no extends
  fields:     ResolvedField[];    // inherited + own, ascending by ordinal
  isGeneric:  boolean;            // has type parameters — not directly emittable
  decorators: Decorator[];
}

/** A company's private overlay on a base record. Independent ordinal space. */
export interface ResolvedOverlay {
  company:    string;
  baseName:   string;             // qualifiedName of the base record
  fields:     ResolvedField[];    // overlay-local ordinals, ascending
  reserved:   ReservedDecl[];     // reservations in this overlay's own space
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code:     string;               // "OS1003"
  severity: DiagnosticSeverity;
  message:  string;
  span:     Span | null;
}

export interface ResolvedSchema {
  namespace:   string[];
  /** `#requireLedger` on the namespace: a missing ordinal ledger is an error. */
  requiresLedger: boolean;
  symbols:     Map<string, DeclSymbol>;          // key = qualifiedName
  records:     Map<string, ResolvedModel>;      // key = qualifiedName
  enums:       Map<string, DeclSymbol>;
  aliases:     Map<string, DeclSymbol>;
  // base qualifiedName → (company → overlay)
  overlays:    Map<string, Map<string, ResolvedOverlay>>;
  // top-level operations plus operations flattened out of interfaces
  operations:  OperationDecl[];
  diagnostics: Diagnostic[];
  hasErrors:   boolean;
}
