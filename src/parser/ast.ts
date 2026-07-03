// src/ast.ts
// All AST node types produced by the parser.
// Every node carries a Span for error reporting and tooling.

// ── Source span ───────────────────────────────────────────────────────────────

export interface Span {
  line: number;
  col:  number;
}

// ── Scalar kind ───────────────────────────────────────────────────────────────

export type ScalarKind =
  | "bool"
  | "i8"  | "i16"  | "i32"  | "i64"
  | "u8"  | "u16"  | "u32"  | "u64"
  | "f32" | "f64"
  | "string" | "bytes" | "uuid" | "json"
  | "date"   | "time"  | "timestamp" | "duration";

// ── Compatibility mode ────────────────────────────────────────────────────────

export type CompatMode = "backward" | "forward" | "full" | "none";

// ─────────────────────────────────────────────────────────────────────────────
// Decorators & directives
// ─────────────────────────────────────────────────────────────────────────────

/** @sql.type("JSONB"), @minValue(0), @check(total >= 0), @deprecated */
export interface Decorator {
  path: string[];        // ["sql", "type"] or ["format"]
  name: string;          // joined convenience form: "sql.type"
  args: DecoratorArg[];
  span: Span;
}

export interface DecoratorArg {
  name:  string | null;  // null for a positional argument
  value: DecoratorValue;
  span:  Span;
}

export type DecoratorValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "bool";   value: boolean }
  | { kind: "ident";  value: string }   // bare identifier, e.g. @compatibility(backward)
  | { kind: "expr";   expr:  Expr };     // @default(gen_uuid()), @check(total >= 0)

/** #suppress "R003" "intentional field removal" — a compiler instruction. */
export interface Directive {
  name: string;          // "suppress"
  args: string[];        // ["R003", "intentional field removal"]
  span: Span;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type expressions
// ─────────────────────────────────────────────────────────────────────────────

export type TypeExpr =
  | ScalarTypeExpr
  | DecimalTypeExpr
  | NamedTypeExpr
  | ArrayTypeExpr
  | MapTypeExpr
  | NullableTypeExpr
  | UnionTypeExpr
	| OneofTypeExpr;

/** Primitive scalar — bool, i32, string, uuid, etc. */
export interface ScalarTypeExpr {
  kind:   "scalar";
  scalar: ScalarKind;
  span:   Span;
}

/** decimal(precision, scale) */
export interface DecimalTypeExpr {
  kind:      "decimal";
  precision: number;
  scale:     number;
  span:      Span;
}

/** A named or imported type, possibly qualified and generic: Foo | myorg.Foo | Page<Order> */
export interface NamedTypeExpr {
  kind:     "named";
  path:     string[];     // ["myorg", "Foo"] or ["Foo"]
  typeArgs: TypeExpr[];   // [] when not generic; [Order] for Page<Order>
  span:     Span;
}

/** A generic type parameter on a record or alias: T, or T extends Base. */
export interface TypeParam {
  name:       string;
  constraint: TypeExpr | null;
  span:       Span;
}

/** [T] — homogeneous ordered collection. Optional length bounds come from the
 * `[T; N]` (fixed) or `[T; min..max]` (range) syntax, or from
 * @minItems/@maxItems/@length on the field (stamped onto the outer array). */
export interface ArrayTypeExpr {
  kind:     "array";
  element:  TypeExpr;
  minItems?: number;
  maxItems?: number;
  span:     Span;
}

/** {K: V} — key/value map */
export interface MapTypeExpr {
  kind:  "map";
  key:   TypeExpr;
  value: TypeExpr;
  span:  Span;
}

/** T? — the type or null/absent */
export interface NullableTypeExpr {
  kind:  "nullable";
  inner: TypeExpr;
  span:  Span;
}

/** A | B | C — untagged union (JSON Schema anyOf, Avro union) */
export interface UnionTypeExpr {
  kind:     "union";
  variants: TypeExpr[];
  span:     Span;
}

/** oneof { 1 foo: A, 2 bar: B } — tagged union (Protobuf oneof) */
export interface OneofTypeExpr {
  kind:     "oneof";
  variants: OneofVariant[];
  span:     Span;
}

export interface OneofVariant {
  ordinal: number;
  name:    string;
  type:    TypeExpr;
  span:    Span;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expressions  (used in default values and check constraints)
// ─────────────────────────────────────────────────────────────────────────────

export type Expr =
  | LiteralExpr
  | IdentExpr
  | CallExpr
  | BinaryExpr
  | UnaryExpr;

export interface LiteralExpr {
  kind:  "literal";
  value: string | number;
  span:  Span;
}

export interface IdentExpr {
  kind: "ident";
  name: string;
  span: Span;
}

/** Function call: gen_uuid() or now() */
export interface CallExpr {
  kind:   "call";
  callee: string;
  args:   Expr[];
  span:   Span;
}

export interface BinaryExpr {
  kind:  "binary";
  op:    string;
  left:  Expr;
  right: Expr;
  span:  Span;
}

export interface UnaryExpr {
  kind:    "unary";
  op:      string;
  operand: Expr;
  span:    Span;
}

// ─────────────────────────────────────────────────────────────────────────────
// Record members
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldDecl {
  ordinal:     number | null; // still optional pending that decision
  private:     boolean;
  name:        string;
  type:        TypeExpr;
  doc:         string | null;
  decorators:  Decorator[];
  directives:  Directive[];
  span:        Span;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level declarations
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelDecl {
  kind:       "model";
  name:       string;
  typeParams: TypeParam[];       // [] when not generic
  extends:    string[] | null;   // qualified name of base schema, or null
  members:    FieldDecl[];
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

export interface EnumVariant {
  ordinal:    number;
  name:       string;
  decorators: Decorator[];
  span:       Span;
}

export interface EnumDecl {
  kind:       "enum";
  name:       string;
  variants:   EnumVariant[];
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

export interface TypeAlias {
  kind:       "type_alias";
  name:       string;
  typeParams: TypeParam[];       // [] when not generic
  type:       TypeExpr;
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

export interface ImportDecl {
  kind:  "import";
  names: string[];
  from:  string;
  span:  Span;
}

export interface NamespaceDecl {
  kind: "namespace";
  path: string[];
  span: Span;
}

// ── Operations & interfaces (optional service layer, e.g. GraphQL) ────────────

export interface ParamDecl {
  name: string;
  type: TypeExpr;     // a nullable param type marks an optional argument
  doc:  string | null;
  span: Span;
}

/** op getOrder(id: uuid): Order   with @query / @mutation / @get decorators */
export interface OperationDecl {
  kind:       "operation";
  name:       string;
  params:     ParamDecl[];
  returnType: TypeExpr;
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

/** interface Orders { op list(): [Order] } — groups related operations. */
export interface InterfaceDecl {
  kind:       "interface";
  name:       string;
  operations: OperationDecl[];
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

/**
 * overlay acme on schema.org.Person { 1 spamScore: f32 }
 *
 * A company-scoped set of private fields layered onto a base record. The
 * field ordinals are scoped to the (company, base record) pair — they start
 * at 1 and are independent of the base record's ordinals and of every other
 * company's overlay, so two companies never collide.
 */
export interface OverlayDecl {
  kind:       "overlay";
  company:    string;
  base:       string[];     // qualified path of the base record
  fields:     FieldDecl[];
  decorators: Decorator[];
  directives: Directive[];
  doc:        string | null;
  span:       Span;
}

export type Declaration =
  | NamespaceDecl
  | ImportDecl
  | TypeAlias
  | ModelDecl
  | EnumDecl
  | OperationDecl
  | InterfaceDecl
  | OverlayDecl;

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export interface Program {
  declarations: Declaration[];
}