// src/parser.ts
// Recursive-descent parser that converts a token stream into an AST.

import { Token, TokenKind } from "../lexer/tokens.js";
import * as AST from "./ast.js";

// Doc comment + directives + decorators collected before a declaration or field.
interface LeadingMetadata {
  doc:        string | null;
  decorators: AST.Decorator[];
  directives: AST.Directive[];
}

// ── Error type ────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly token: Token
  ) {
    super(
      `Parse error at ${token.line}:${token.col}: ${message} ` +
      `(got ${token.kind} ${JSON.stringify(token.value)})`
    );
    this.name = "ParseError";
  }
}

// ── Scalar-type keyword → ScalarKind map ─────────────────────────────────────

const SCALAR_KINDS = new Map<TokenKind, AST.ScalarKind>([
  [TokenKind.Bool,      "bool"],
  [TokenKind.I8,        "i8"],
  [TokenKind.I16,       "i16"],
  [TokenKind.I32,       "i32"],
  [TokenKind.I64,       "i64"],
  [TokenKind.U8,        "u8"],
  [TokenKind.U16,       "u16"],
  [TokenKind.U32,       "u32"],
  [TokenKind.U64,       "u64"],
  [TokenKind.F32,       "f32"],
  [TokenKind.F64,       "f64"],
  [TokenKind.KwString,  "string"],
  [TokenKind.Bytes,     "bytes"],
  [TokenKind.Json,      "json"],
  [TokenKind.Uuid,      "uuid"],
  [TokenKind.Date,      "date"],
  [TokenKind.Time,      "time"],
  [TokenKind.Timestamp, "timestamp"],
  [TokenKind.Duration,  "duration"],
]);

// ── Parser ────────────────────────────────────────────────────────────────────

export class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  // ── Entry point ─────────────────────────────────────────────────────────────

  parse(): AST.Program {
    const declarations: AST.Declaration[] = [];
    while (!this.at(TokenKind.EOF)) {
      // Skip doc comments — they stay in this.tokens for lastDocComment()
      // to look back at, but are not declarations themselves.
      while (this.at(TokenKind.DocComment)) this.advance();
      if (this.at(TokenKind.EOF)) break;
      declarations.push(this.parseDeclaration());
    }
    return { declarations };
  }

  // ── Top-level declarations ───────────────────────────────────────────────────

  private parseDeclaration(): AST.Declaration {
    const meta = this.parseLeadingMetadata();
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.Namespace: this.rejectMetadata(meta, tok); return this.parseNamespace();
      case TokenKind.Import:    this.rejectMetadata(meta, tok); return this.parseImport();
      case TokenKind.Type:      return this.parseTypeAlias(meta);
      case TokenKind.Model:    return this.parseModel(meta);
      case TokenKind.Enum:      return this.parseEnum(meta);
      case TokenKind.Op:        return this.parseOperation(meta);
      case TokenKind.Interface: return this.parseInterface(meta);
      case TokenKind.Overlay:   return this.parseOverlay(meta);
      default:
        throw new ParseError(
          "Expected a top-level declaration: namespace | import | type | record | enum | op | interface | overlay",
          tok
        );
    }
  }

  // ── Leading metadata: doc comment, directives, decorators ────────────────────

  private parseLeadingMetadata(): LeadingMetadata {
    const doc = this.lastDocComment();
    const decorators: AST.Decorator[] = [];
    const directives: AST.Directive[] = [];
    while (this.at(TokenKind.At) || this.at(TokenKind.Hash)) {
      if (this.at(TokenKind.At)) {
        decorators.push(this.parseDecorator());
        continue;
      }
      directives.push(this.parseDirective());
    }
    return { doc, decorators, directives };
  }

  private rejectMetadata(meta: LeadingMetadata, tok: Token): void {
    if (meta.decorators.length === 0 && meta.directives.length === 0) return;
    throw new ParseError(
      `Decorators and directives are not allowed on '${tok.value}'`,
      tok
    );
  }

  // @sql.type("JSONB")  @minValue(0)  @compatibility(backward)  @deprecated
  private parseDecorator(): AST.Decorator {
    const span = this.span();
    this.expect(TokenKind.At);
    const path = [this.expectNameSegment("decorator name")];
    while (this.at(TokenKind.Dot)) {
      this.advance();
      path.push(this.expectNameSegment("decorator name segment"));
    }
    const name = path.join(".");
    if (!this.at(TokenKind.LParen)) {
      return { path, name, args: [], span };
    }
    this.advance(); // (
    const args: AST.DecoratorArg[] = [];
    while (!this.at(TokenKind.RParen) && !this.at(TokenKind.EOF)) {
      args.push(this.parseDecoratorArg());
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RParen);
    return { path, name, args, span };
  }

  private parseDecoratorArg(): AST.DecoratorArg {
    const span = this.span();
    // Named argument: an identifier immediately followed by a colon.
    if (this.at(TokenKind.Ident) && this.peekAt(1).kind === TokenKind.Colon) {
      const argName = this.advance().value;
      this.advance(); // :
      const value = this.parseDecoratorValue();
      return { name: argName, value, span };
    }
    const value = this.parseDecoratorValue();
    return { name: null, value, span };
  }

  private parseDecoratorValue(): AST.DecoratorValue {
    // Qualified identifier value, e.g. @references(User.id).
    if (this.at(TokenKind.Ident) && this.peekAt(1).kind === TokenKind.Dot) {
      const path = this.parseQualifiedIdent();
      return { kind: "ident", value: path.join(".") };
    }
    const expr = this.parseExpr();
    return this.normalizeDecoratorValue(expr);
  }

  // Collapse simple expressions into plain literal decorator values; keep
  // genuine expressions (calls, comparisons) as { kind: "expr" }.
  private normalizeDecoratorValue(expr: AST.Expr): AST.DecoratorValue {
    if (expr.kind === "literal" && typeof expr.value === "number") {
      return { kind: "number", value: expr.value };
    }
    if (expr.kind === "literal" && typeof expr.value === "string") {
      return { kind: "string", value: expr.value };
    }
    if (
      expr.kind === "unary" && expr.op === "-" &&
      expr.operand.kind === "literal" && typeof expr.operand.value === "number"
    ) {
      return { kind: "number", value: -expr.operand.value };
    }
    if (expr.kind === "ident") {
      if (expr.name === "true")  return { kind: "bool", value: true };
      if (expr.name === "false") return { kind: "bool", value: false };
      return { kind: "ident", value: expr.name };
    }
    return { kind: "expr", expr };
  }

  // #suppress "R003" "intentional field removal"
  private parseDirective(): AST.Directive {
    const span = this.span();
    this.expect(TokenKind.Hash);
    const name = this.expectIdent("directive name");
    const args: string[] = [];
    while (this.at(TokenKind.StringLit)) {
      args.push(this.expectString());
    }
    return { name, args, span };
  }

  // namespace myorg.ecommerce
  private parseNamespace(): AST.NamespaceDecl {
    const span = this.span();
    this.expect(TokenKind.Namespace);
    const path = this.parseQualifiedIdent();
    return { kind: "namespace", path, span };
  }

  // import { Foo, Bar } from "@myorg/common/v1"
  private parseImport(): AST.ImportDecl {
    const span = this.span();
    this.expect(TokenKind.Import);
    this.expect(TokenKind.LBrace);
    const names: string[] = [];
    while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
      names.push(this.expectIdent("import name"));
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);
    this.expect(TokenKind.From);
    const from = this.expectString();
    return { kind: "import", names, from, span };
  }

  // type Identifier = uuid | string   |   type Box<T> = T
  private parseTypeAlias(meta: LeadingMetadata): AST.TypeAlias {
    const span = this.span();
    this.expect(TokenKind.Type);
    const name = this.expectIdent("type alias name");
    const typeParams = this.parseTypeParams();
    this.expect(TokenKind.Equals);
    const type = this.parseTypeExpr();
    return {
      kind: "type_alias", name, typeParams, type,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
  }

  // @compatibility(backward) @table("orders") record Order { … }
  private parseModel(meta: LeadingMetadata): AST.ModelDecl {
    const span = this.span();
    this.expect(TokenKind.Model);
    const name = this.expectIdent("record name");
    const typeParams = this.parseTypeParams();

    const base = this.at(TokenKind.Extends)
      ? (this.advance(), this.parseQualifiedIdent())
      : null;

    this.expect(TokenKind.LBrace);
    const members: AST.FieldDecl[] = [];
    while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
      while (this.at(TokenKind.DocComment)) this.advance();
      if (this.at(TokenKind.RBrace)) break;
      members.push(this.parseField());
    }
    this.expect(TokenKind.RBrace);

    return {
      kind: "model", name, typeParams, extends: base, members,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
	}

  // <T, U extends Base> — generic type parameters on a record or alias.
  private parseTypeParams(): AST.TypeParam[] {
    if (!this.at(TokenKind.Lt)) return [];
    this.advance(); // <
    const params: AST.TypeParam[] = [];
    while (!this.at(TokenKind.Gt) && !this.at(TokenKind.EOF)) {
      const pspan = this.span();
      const pname = this.expectIdent("type parameter name");
      let constraint: AST.TypeExpr | null = null;
      if (this.at(TokenKind.Extends)) {
        this.advance();
        constraint = this.parseTypeExpr();
      }
      params.push({ name: pname, constraint, span: pspan });
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.Gt);
    return params;
  }

  // <Order, string> — generic type arguments at a named-type use site.
  private parseTypeArgs(): AST.TypeExpr[] {
    if (!this.at(TokenKind.Lt)) return [];
    this.advance(); // <
    const args: AST.TypeExpr[] = [];
    while (!this.at(TokenKind.Gt) && !this.at(TokenKind.EOF)) {
      args.push(this.parseTypeExpr());
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.Gt);
    return args;
  }
  
	// Collect all consecutive DocComment tokens immediately preceding the
	// current position and join them into a single string.
	private lastDocComment(): string | null {
	  let i = this.pos - 1;
	  const lines: string[] = [];
	
	  while (i >= 0 && this.tokens[i].kind === TokenKind.DocComment) {
	    lines.unshift(this.tokens[i].value);
	    i--;
	  }
	
	  return lines.length > 0 ? lines.join("\n") : null;
	}
  
	private parseField(): AST.FieldDecl {
	  const span = this.span();
	  const meta = this.parseLeadingMetadata();

	  const ordinal = this.at(TokenKind.IntLit)
	    ? parseInt(this.advance().value, 10)
	    : null;

	  const isPrivate = this.at(TokenKind.Private)
	    ? (this.advance(), true)
	    : false;

	  const name = this.expectIdent("field name");
	  this.expect(TokenKind.Colon);
	  const type = this.parseTypeExpr();

	  return {
	    ordinal, private: isPrivate, name, type,
	    doc: meta.doc, decorators: meta.decorators, directives: meta.directives, span,
	  };
	}

  // enum OrderStatus { 1 pending  2 confirmed  3 shipped }
  private parseEnum(meta: LeadingMetadata): AST.EnumDecl {
    const span = this.span();
    this.expect(TokenKind.Enum);
    const name = this.expectIdent("enum name");
    this.expect(TokenKind.LBrace);
    const variants: AST.EnumVariant[] = [];
    while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
      while (this.at(TokenKind.DocComment)) this.advance();
      if (this.at(TokenKind.RBrace)) break;
      const vspan      = this.span();
      const decorators = this.parseDecorators();
      const ordinal    = this.expectInt("enum variant ordinal");
      const vname      = this.expectIdent("enum variant name");
      variants.push({ ordinal, name: vname, decorators, span: vspan });
    }
    this.expect(TokenKind.RBrace);
    return {
      kind: "enum", name, variants,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
  }

  private parseDecorators(): AST.Decorator[] {
    const decorators: AST.Decorator[] = [];
    while (this.at(TokenKind.At)) {
      decorators.push(this.parseDecorator());
    }
    return decorators;
  }

  // op getOrder(id: uuid): Order
  private parseOperation(meta: LeadingMetadata): AST.OperationDecl {
    const span = this.span();
    this.expect(TokenKind.Op);
    const name = this.expectIdent("operation name");
    this.expect(TokenKind.LParen);
    const params: AST.ParamDecl[] = [];
    while (!this.at(TokenKind.RParen) && !this.at(TokenKind.EOF)) {
      params.push(this.parseParam());
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RParen);
    this.expect(TokenKind.Colon);
    const returnType = this.parseTypeExpr();
    return {
      kind: "operation", name, params, returnType,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
  }

  private parseParam(): AST.ParamDecl {
    const span = this.span();
    const doc  = this.lastDocComment();
    const name = this.expectIdent("parameter name");
    this.expect(TokenKind.Colon);
    const type = this.parseTypeExpr();
    return { name, type, doc, span };
  }

  // overlay acme on schema.org.Person { 1 spamScore: f32 }
  private parseOverlay(meta: LeadingMetadata): AST.OverlayDecl {
    const span = this.span();
    this.expect(TokenKind.Overlay);
    const company = this.expectIdent("overlay company name");
    this.expectContextual("on");
    const base = this.parseQualifiedIdent();
    this.expect(TokenKind.LBrace);
    const fields: AST.FieldDecl[] = [];
    while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
      while (this.at(TokenKind.DocComment)) this.advance();
      if (this.at(TokenKind.RBrace)) break;
      fields.push(this.parseField());
    }
    this.expect(TokenKind.RBrace);
    return {
      kind: "overlay", company, base, fields,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
  }

  // Consume an identifier that must equal `word` (a contextual keyword like `on`).
  private expectContextual(word: string): void {
    const tok = this.peek();
    if (tok.kind === TokenKind.Ident && tok.value === word) {
      this.advance();
      return;
    }
    throw new ParseError(`Expected '${word}'`, tok);
  }

  // interface Orders { op list(): [Order]  op get(id: uuid): Order }
  private parseInterface(meta: LeadingMetadata): AST.InterfaceDecl {
    const span = this.span();
    this.expect(TokenKind.Interface);
    const name = this.expectIdent("interface name");
    this.expect(TokenKind.LBrace);
    const operations: AST.OperationDecl[] = [];
    while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
      while (this.at(TokenKind.DocComment)) this.advance();
      if (this.at(TokenKind.RBrace)) break;
      const opMeta = this.parseLeadingMetadata();
      operations.push(this.parseOperation(opMeta));
    }
    this.expect(TokenKind.RBrace);
    return {
      kind: "interface", name, operations,
      decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
    };
  }

  // A decorator name segment may reuse a reserved keyword (e.g. @sql.type),
  // so accept any identifier-like word, not just Ident tokens.
  private expectNameSegment(role: string): string {
    const tok = this.peek();
    if (tok.kind === TokenKind.Ident || /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok.value)) {
      return this.advance().value;
    }
    throw new ParseError(`Expected ${role}`, tok);
  }

  // ── Type expressions ─────────────────────────────────────────────────────────
  //
  //  Precedence (low → high):
  //    union:    A | B | C
  //    nullable: T?
  //    primary:  scalar | named | [T] | {K:V} | oneof{…} | (T)

  private parseTypeExpr(): AST.TypeExpr {
    return this.parseUnionType();
  }

  private parseUnionType(): AST.TypeExpr {
    const span  = this.span();
    const first = this.parseNullableType();
    if (!this.at(TokenKind.Pipe)) return first;

    const variants: AST.TypeExpr[] = [first];
    while (this.at(TokenKind.Pipe)) {
      this.advance();
      variants.push(this.parseNullableType());
    }
    return { kind: "union", variants, span };
  }

  private parseNullableType(): AST.TypeExpr {
    const span  = this.span();
    const inner = this.parsePrimaryType();
    if (this.at(TokenKind.Question)) {
      this.advance();
      return { kind: "nullable", inner, span };
    }
    return inner;
  }

  private parsePrimaryType(): AST.TypeExpr {
    return this.parsePrimaryTypeInner(this.span());
  }

  private parsePrimaryTypeInner(span: AST.Span): AST.TypeExpr {
    const tok = this.peek();
  
    const scalarKind = SCALAR_KINDS.get(tok.kind);
    if (scalarKind !== undefined) {
      this.advance();
      return { kind: "scalar", scalar: scalarKind, span };
    }
  
    if (tok.kind === TokenKind.Decimal) {
      this.advance();
      this.expect(TokenKind.LParen);
      const precision = this.expectInt("decimal precision");
      this.expect(TokenKind.Comma);
      const scale = this.expectInt("decimal scale");
      this.expect(TokenKind.RParen);
      return { kind: "decimal", precision, scale, span };
    }
  
    if (tok.kind === TokenKind.LBracket) {
      this.advance();
      const element = this.parseTypeExpr();
      const array: AST.ArrayTypeExpr = { kind: "array", element, span };
      if (this.at(TokenKind.Semicolon)) {
        this.advance();
        const bounds = this.parseArrayBounds();
        if (bounds.minItems !== undefined) array.minItems = bounds.minItems;
        if (bounds.maxItems !== undefined) array.maxItems = bounds.maxItems;
      }
      this.expect(TokenKind.RBracket);
      return array;
    }
  
    if (tok.kind === TokenKind.LBrace) {
      this.advance();
      const key = this.parseTypeExpr();
      this.expect(TokenKind.Colon);
      const value = this.parseTypeExpr();
      this.expect(TokenKind.RBrace);
      return { kind: "map", key, value, span };
    }
  
    if (tok.kind === TokenKind.Oneof) {
      this.advance();
      this.expect(TokenKind.LBrace);
      const variants: AST.OneofVariant[] = [];
      while (!this.at(TokenKind.RBrace) && !this.at(TokenKind.EOF)) {
        const vspan   = this.span();
        const ordinal = this.expectInt("oneof variant ordinal");
        const name    = this.expectIdent("oneof variant name");
        this.expect(TokenKind.Colon);
        const type    = this.parseTypeExpr();
        variants.push({ ordinal, name, type, span: vspan });
      }
      this.expect(TokenKind.RBrace);
      return { kind: "oneof", variants, span };
    }
  
    if (tok.kind === TokenKind.LParen) {
      this.advance();
      const inner = this.parseTypeExpr();
      this.expect(TokenKind.RParen);
      return inner;
    }
  
    if (tok.kind === TokenKind.Ident) {
      const path = this.parseQualifiedIdent();
      const typeArgs = this.parseTypeArgs();
      return { kind: "named", path, typeArgs, span };
    }

    throw new ParseError("Expected a type expression", tok);
  }
  
  // ── Expressions ──────────────────────────────────────────────────────────────
  //
  //  Standard operator-precedence grammar:
  //    or  →  and  →  equality  →  relational  →  add  →  mul  →  unary  →  primary

  private parseExpr(): AST.Expr {
    return this.parseOrExpr();
  }

  private parseOrExpr(): AST.Expr {
    let left = this.parseAndExpr();
    while (this.at(TokenKind.Or)) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseAndExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseAndExpr(): AST.Expr {
    let left = this.parseEqExpr();
    while (this.at(TokenKind.And)) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseEqExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseEqExpr(): AST.Expr {
    let left = this.parseRelExpr();
    while (this.at(TokenKind.EqEq) || this.at(TokenKind.NotEq)) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseRelExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseRelExpr(): AST.Expr {
    let left = this.parseAddExpr();
    while (
      this.at(TokenKind.Lt)   ||
      this.at(TokenKind.Gt)   ||
      this.at(TokenKind.LtEq) ||
      this.at(TokenKind.GtEq)
    ) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseAddExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseAddExpr(): AST.Expr {
    let left = this.parseMulExpr();
    while (this.at(TokenKind.Plus) || this.at(TokenKind.Minus)) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseMulExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseMulExpr(): AST.Expr {
    let left = this.parseUnaryExpr();
    while (this.at(TokenKind.Star) || this.at(TokenKind.Slash)) {
      const span  = this.span();
      const op    = this.advance().value;
      const right = this.parseUnaryExpr();
      left = { kind: "binary", op, left, right, span };
    }
    return left;
  }

  private parseUnaryExpr(): AST.Expr {
    if (this.at(TokenKind.Bang) || this.at(TokenKind.Minus)) {
      const span    = this.span();
      const op      = this.advance().value;
      const operand = this.parseUnaryExpr();
      return { kind: "unary", op, operand, span };
    }
    return this.parsePrimaryExpr();
  }

  private parsePrimaryExpr(): AST.Expr {
    const span = this.span();
    const tok  = this.peek();

    if (tok.kind === TokenKind.IntLit) {
      this.advance();
      return { kind: "literal", value: parseInt(tok.value, 10), span };
    }

    if (tok.kind === TokenKind.FloatLit) {
      this.advance();
      return { kind: "literal", value: parseFloat(tok.value), span };
    }

    if (tok.kind === TokenKind.StringLit) {
      this.advance();
      return { kind: "literal", value: tok.value, span };
    }

    if (tok.kind === TokenKind.LParen) {
      this.advance();
      const inner = this.parseExpr();
      this.expect(TokenKind.RParen);
      return inner;
    }

    if (tok.kind === TokenKind.Ident) {
      const name = this.advance().value;
      // Function call: name(arg, arg, …)
      if (this.at(TokenKind.LParen)) {
        this.advance();
        const args: AST.Expr[] = [];
        while (!this.at(TokenKind.RParen) && !this.at(TokenKind.EOF)) {
          args.push(this.parseExpr());
          if (this.at(TokenKind.Comma)) this.advance();
        }
        this.expect(TokenKind.RParen);
        return { kind: "call", callee: name, args, span };
      }
      return { kind: "ident", name, span };
    }

    throw new ParseError("Expected an expression", tok);
  }

  // ── Qualified identifier: Foo | myorg.ecommerce.Order ────────────────────────

  private parseQualifiedIdent(): string[] {
    const parts: string[] = [this.expectIdent("identifier")];
    while (this.at(TokenKind.Dot)) {
      this.advance();
      parts.push(this.expectIdent("identifier after '.'"));
    }
    return parts;
  }

  // ── Primitive helpers ─────────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos] ??
      { kind: TokenKind.EOF, value: "", line: 0, col: 0 };
  }

  private peekAt(offset: number): Token {
    return this.tokens[this.pos + offset] ??
      { kind: TokenKind.EOF, value: "", line: 0, col: 0 };
  }

  private advance(): Token {
    return this.tokens[this.pos++] ??
      { kind: TokenKind.EOF, value: "", line: 0, col: 0 };
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private expect(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(`Expected '${kind}'`, tok);
    }
    return this.advance();
  }

  /** Expect an Ident token; `role` is used only in error messages. */
  private expectIdent(role: string): string {
    const tok = this.peek();
    if (tok.kind !== TokenKind.Ident) {
      throw new ParseError(`Expected ${role} (identifier)`, tok);
    }
    return this.advance().value;
  }

  // Array length spec after `;`: `N` (fixed), `min..max`, `min..`, or `..max`.
  private parseArrayBounds(): { minItems?: number; maxItems?: number } {
    if (this.at(TokenKind.DotDot)) {
      this.advance();
      return { maxItems: this.expectInt("array max length") };
    }
    const first = this.expectInt("array length");
    if (this.at(TokenKind.DotDot)) {
      this.advance();
      if (this.at(TokenKind.RBracket)) return { minItems: first };
      const maxItems = this.expectInt("array max length");
      if (first > maxItems) {
        throw new ParseError(`Array length range is inverted: ${first}..${maxItems}`, this.peek());
      }
      return { minItems: first, maxItems };
    }
    return { minItems: first, maxItems: first };
  }

  private expectInt(role: string): number {
    const tok = this.peek();
    if (tok.kind !== TokenKind.IntLit) {
      throw new ParseError(`Expected ${role} (integer)`, tok);
    }
    return parseInt(this.advance().value, 10);
  }

  private expectString(): string {
    const tok = this.peek();
    if (tok.kind !== TokenKind.StringLit) {
      throw new ParseError("Expected a string literal", tok);
    }
    return this.advance().value;
  }

  /** Capture the current line/col as a Span before consuming tokens. */
  private span(): AST.Span {
    const tok = this.peek();
    return { line: tok.line, col: tok.col };
  }
}