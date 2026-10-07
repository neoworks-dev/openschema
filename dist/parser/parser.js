// src/parser.ts
// Recursive-descent parser that converts a token stream into an AST.
// ── Error type ────────────────────────────────────────────────────────────────
export class ParseError extends Error {
    constructor(message, token) {
        super(`Parse error at ${token.line}:${token.col}: ${message} ` +
            `(got ${token.kind} ${JSON.stringify(token.value)})`);
        this.token = token;
        this.name = "ParseError";
    }
}
// ── Scalar-type keyword → ScalarKind map ─────────────────────────────────────
const SCALAR_KINDS = new Map([
    ["bool" /* TokenKind.Bool */, "bool"],
    ["i8" /* TokenKind.I8 */, "i8"],
    ["i16" /* TokenKind.I16 */, "i16"],
    ["i32" /* TokenKind.I32 */, "i32"],
    ["i64" /* TokenKind.I64 */, "i64"],
    ["u8" /* TokenKind.U8 */, "u8"],
    ["u16" /* TokenKind.U16 */, "u16"],
    ["u32" /* TokenKind.U32 */, "u32"],
    ["u64" /* TokenKind.U64 */, "u64"],
    ["f32" /* TokenKind.F32 */, "f32"],
    ["f64" /* TokenKind.F64 */, "f64"],
    ["string" /* TokenKind.KwString */, "string"],
    ["bytes" /* TokenKind.Bytes */, "bytes"],
    ["json" /* TokenKind.Json */, "json"],
    ["uuid" /* TokenKind.Uuid */, "uuid"],
    ["date" /* TokenKind.Date */, "date"],
    ["time" /* TokenKind.Time */, "time"],
    ["timestamp" /* TokenKind.Timestamp */, "timestamp"],
    ["duration" /* TokenKind.Duration */, "duration"],
]);
// ── Parser ────────────────────────────────────────────────────────────────────
export class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    // ── Entry point ─────────────────────────────────────────────────────────────
    parse() {
        const declarations = [];
        while (!this.at("EOF" /* TokenKind.EOF */)) {
            // Skip doc comments — they stay in this.tokens for lastDocComment()
            // to look back at, but are not declarations themselves.
            while (this.at("DocComment" /* TokenKind.DocComment */))
                this.advance();
            if (this.at("EOF" /* TokenKind.EOF */))
                break;
            declarations.push(this.parseDeclaration());
        }
        return { declarations };
    }
    // ── Top-level declarations ───────────────────────────────────────────────────
    parseDeclaration() {
        const meta = this.parseLeadingMetadata();
        const tok = this.peek();
        switch (tok.kind) {
            case "namespace" /* TokenKind.Namespace */:
                this.rejectDecorators(meta, tok);
                return this.parseNamespace(meta);
            case "import" /* TokenKind.Import */:
                this.rejectMetadata(meta, tok);
                return this.parseImport();
            case "type" /* TokenKind.Type */: return this.parseTypeAlias(meta);
            case "model" /* TokenKind.Model */: return this.parseModel(meta);
            case "enum" /* TokenKind.Enum */: return this.parseEnum(meta);
            case "op" /* TokenKind.Op */: return this.parseOperation(meta);
            case "interface" /* TokenKind.Interface */: return this.parseInterface(meta);
            case "overlay" /* TokenKind.Overlay */: return this.parseOverlay(meta);
            default:
                throw new ParseError("Expected a top-level declaration: namespace | import | type | record | enum | op | interface | overlay", tok);
        }
    }
    // ── Leading metadata: doc comment, directives, decorators ────────────────────
    parseLeadingMetadata() {
        const doc = this.lastDocComment();
        const decorators = [];
        const directives = [];
        while (this.at("@" /* TokenKind.At */) || this.at("#" /* TokenKind.Hash */)) {
            if (this.at("@" /* TokenKind.At */)) {
                decorators.push(this.parseDecorator());
                continue;
            }
            directives.push(this.parseDirective());
        }
        return { doc, decorators, directives };
    }
    rejectMetadata(meta, tok) {
        if (meta.decorators.length === 0 && meta.directives.length === 0)
            return;
        throw new ParseError(`Decorators and directives are not allowed on '${tok.value}'`, tok);
    }
    /** `namespace` carries directives (e.g. #requireLedger) but never decorators. */
    rejectDecorators(meta, tok) {
        if (meta.decorators.length === 0)
            return;
        throw new ParseError(`Decorators are not allowed on '${tok.value}'`, tok);
    }
    // @sql.type("JSONB")  @minValue(0)  @compatibility(backward)  @deprecated
    parseDecorator() {
        const span = this.span();
        this.expect("@" /* TokenKind.At */);
        const path = [this.expectNameSegment("decorator name")];
        while (this.at("." /* TokenKind.Dot */)) {
            this.advance();
            path.push(this.expectNameSegment("decorator name segment"));
        }
        const name = path.join(".");
        if (!this.at("(" /* TokenKind.LParen */)) {
            return { path, name, args: [], span };
        }
        this.advance(); // (
        const args = [];
        while (!this.at(")" /* TokenKind.RParen */) && !this.at("EOF" /* TokenKind.EOF */)) {
            args.push(this.parseDecoratorArg());
            if (this.at("," /* TokenKind.Comma */))
                this.advance();
        }
        this.expect(")" /* TokenKind.RParen */);
        return { path, name, args, span };
    }
    parseDecoratorArg() {
        const span = this.span();
        // Named argument: an identifier immediately followed by a colon.
        if (this.at("Ident" /* TokenKind.Ident */) && this.peekAt(1).kind === ":" /* TokenKind.Colon */) {
            const argName = this.advance().value;
            this.advance(); // :
            const value = this.parseDecoratorValue();
            return { name: argName, value, span };
        }
        const value = this.parseDecoratorValue();
        return { name: null, value, span };
    }
    parseDecoratorValue() {
        // Qualified identifier value, e.g. @references(User.id).
        if (this.at("Ident" /* TokenKind.Ident */) && this.peekAt(1).kind === "." /* TokenKind.Dot */) {
            const path = this.parseQualifiedIdent();
            return { kind: "ident", value: path.join(".") };
        }
        const expr = this.parseExpr();
        return this.normalizeDecoratorValue(expr);
    }
    // Collapse simple expressions into plain literal decorator values; keep
    // genuine expressions (calls, comparisons) as { kind: "expr" }.
    normalizeDecoratorValue(expr) {
        if (expr.kind === "literal" && typeof expr.value === "number") {
            return { kind: "number", value: expr.value };
        }
        if (expr.kind === "literal" && typeof expr.value === "string") {
            return { kind: "string", value: expr.value };
        }
        if (expr.kind === "unary" && expr.op === "-" &&
            expr.operand.kind === "literal" && typeof expr.operand.value === "number") {
            return { kind: "number", value: -expr.operand.value };
        }
        if (expr.kind === "ident") {
            if (expr.name === "true")
                return { kind: "bool", value: true };
            if (expr.name === "false")
                return { kind: "bool", value: false };
            return { kind: "ident", value: expr.name };
        }
        return { kind: "expr", expr };
    }
    // #suppress "R003" "intentional field removal"
    parseDirective() {
        const span = this.span();
        this.expect("#" /* TokenKind.Hash */);
        const name = this.expectIdent("directive name");
        const args = [];
        while (this.at("StringLit" /* TokenKind.StringLit */)) {
            args.push(this.expectString());
        }
        return { name, args, span };
    }
    // #requireLedger  namespace myorg.ecommerce
    parseNamespace(meta) {
        const span = this.span();
        this.expect("namespace" /* TokenKind.Namespace */);
        const path = this.parseQualifiedIdent();
        return { kind: "namespace", path, directives: meta.directives, span };
    }
    // import { Foo, Bar } from "@myorg/common/v1"
    parseImport() {
        const span = this.span();
        this.expect("import" /* TokenKind.Import */);
        this.expect("{" /* TokenKind.LBrace */);
        const names = [];
        while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
            names.push(this.expectIdent("import name"));
            if (this.at("," /* TokenKind.Comma */))
                this.advance();
        }
        this.expect("}" /* TokenKind.RBrace */);
        this.expect("from" /* TokenKind.From */);
        const from = this.expectString();
        return { kind: "import", names, from, span };
    }
    // type Identifier = uuid | string   |   type Box<T> = T
    parseTypeAlias(meta) {
        const span = this.span();
        this.expect("type" /* TokenKind.Type */);
        const name = this.expectIdent("type alias name");
        const typeParams = this.parseTypeParams();
        this.expect("=" /* TokenKind.Equals */);
        const type = this.parseTypeExpr();
        return {
            kind: "type_alias", name, typeParams, type,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    // @compatibility(backward) @table("orders") record Order { … }
    parseModel(meta) {
        const span = this.span();
        this.expect("model" /* TokenKind.Model */);
        const name = this.expectIdent("record name");
        const typeParams = this.parseTypeParams();
        const base = this.at("extends" /* TokenKind.Extends */)
            ? (this.advance(), this.parseQualifiedIdent())
            : null;
        this.expect("{" /* TokenKind.LBrace */);
        const members = [];
        const reserved = [];
        while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
            while (this.at("DocComment" /* TokenKind.DocComment */))
                this.advance();
            if (this.at("}" /* TokenKind.RBrace */))
                break;
            if (this.atReservedDeclaration()) {
                reserved.push(this.parseReserved());
                continue;
            }
            members.push(this.parseField());
        }
        this.expect("}" /* TokenKind.RBrace */);
        return {
            kind: "model", name, typeParams, extends: base, members, reserved,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    // <T, U extends Base> — generic type parameters on a record or alias.
    parseTypeParams() {
        if (!this.at("<" /* TokenKind.Lt */))
            return [];
        this.advance(); // <
        const params = [];
        while (!this.at(">" /* TokenKind.Gt */) && !this.at("EOF" /* TokenKind.EOF */)) {
            const pspan = this.span();
            const pname = this.expectIdent("type parameter name");
            let constraint = null;
            if (this.at("extends" /* TokenKind.Extends */)) {
                this.advance();
                constraint = this.parseTypeExpr();
            }
            params.push({ name: pname, constraint, span: pspan });
            if (this.at("," /* TokenKind.Comma */))
                this.advance();
        }
        this.expect(">" /* TokenKind.Gt */);
        return params;
    }
    // <Order, string> — generic type arguments at a named-type use site.
    parseTypeArgs() {
        if (!this.at("<" /* TokenKind.Lt */))
            return [];
        this.advance(); // <
        const args = [];
        while (!this.at(">" /* TokenKind.Gt */) && !this.at("EOF" /* TokenKind.EOF */)) {
            args.push(this.parseTypeExpr());
            if (this.at("," /* TokenKind.Comma */))
                this.advance();
        }
        this.expect(">" /* TokenKind.Gt */);
        return args;
    }
    // Collect all consecutive DocComment tokens immediately preceding the
    // current position and join them into a single string.
    lastDocComment() {
        let i = this.pos - 1;
        const lines = [];
        while (i >= 0 && this.tokens[i].kind === "DocComment" /* TokenKind.DocComment */) {
            lines.unshift(this.tokens[i].value);
            i--;
        }
        return lines.length > 0 ? lines.join("\n") : null;
    }
    parseField() {
        const span = this.span();
        const meta = this.parseLeadingMetadata();
        const ordinal = this.at("IntLit" /* TokenKind.IntLit */)
            ? parseInt(this.advance().value, 10)
            : null;
        const isPrivate = this.at("private" /* TokenKind.Private */)
            ? (this.advance(), true)
            : false;
        const name = this.expectIdent("field name");
        this.expect(":" /* TokenKind.Colon */);
        const type = this.parseTypeExpr();
        return {
            ordinal, private: isPrivate, name, type,
            doc: meta.doc, decorators: meta.decorators, directives: meta.directives, span,
        };
    }
    // enum OrderStatus { 1 pending  2 confirmed  3 shipped }
    parseEnum(meta) {
        const span = this.span();
        this.expect("enum" /* TokenKind.Enum */);
        const name = this.expectIdent("enum name");
        this.expect("{" /* TokenKind.LBrace */);
        const variants = [];
        const reserved = [];
        while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
            while (this.at("DocComment" /* TokenKind.DocComment */))
                this.advance();
            if (this.at("}" /* TokenKind.RBrace */))
                break;
            if (this.atReservedDeclaration()) {
                reserved.push(this.parseReserved());
                continue;
            }
            const vspan = this.span();
            const decorators = this.parseDecorators();
            const ordinal = this.expectInt("enum variant ordinal");
            const vname = this.expectIdent("enum variant name");
            variants.push({ ordinal, name: vname, decorators, span: vspan });
        }
        this.expect("}" /* TokenKind.RBrace */);
        return {
            kind: "enum", name, variants, reserved,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    parseDecorators() {
        const decorators = [];
        while (this.at("@" /* TokenKind.At */)) {
            decorators.push(this.parseDecorator());
        }
        return decorators;
    }
    // op getOrder(id: uuid): Order
    parseOperation(meta) {
        const span = this.span();
        this.expect("op" /* TokenKind.Op */);
        const name = this.expectIdent("operation name");
        this.expect("(" /* TokenKind.LParen */);
        const params = [];
        while (!this.at(")" /* TokenKind.RParen */) && !this.at("EOF" /* TokenKind.EOF */)) {
            params.push(this.parseParam());
            if (this.at("," /* TokenKind.Comma */))
                this.advance();
        }
        this.expect(")" /* TokenKind.RParen */);
        this.expect(":" /* TokenKind.Colon */);
        const returnType = this.parseTypeExpr();
        return {
            kind: "operation", name, params, returnType,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    parseParam() {
        const span = this.span();
        const doc = this.lastDocComment();
        const name = this.expectIdent("parameter name");
        this.expect(":" /* TokenKind.Colon */);
        const type = this.parseTypeExpr();
        return { name, type, doc, span };
    }
    // overlay acme on schema.org.Person { 1 spamScore: f32 }
    parseOverlay(meta) {
        const span = this.span();
        this.expect("overlay" /* TokenKind.Overlay */);
        const company = this.expectIdent("overlay company name");
        this.expectContextual("on");
        const base = this.parseQualifiedIdent();
        this.expect("{" /* TokenKind.LBrace */);
        const fields = [];
        const reserved = [];
        while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
            while (this.at("DocComment" /* TokenKind.DocComment */))
                this.advance();
            if (this.at("}" /* TokenKind.RBrace */))
                break;
            if (this.atReservedDeclaration()) {
                reserved.push(this.parseReserved());
                continue;
            }
            fields.push(this.parseField());
        }
        this.expect("}" /* TokenKind.RBrace */);
        return {
            kind: "overlay", company, base, fields, reserved,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    // ── reserved declarations ────────────────────────────────────────────────────
    //
    // `reserved` is NOT a lexer keyword. Promoting it would break every existing
    // schema with a field named `reserved`, because expectIdent accepts only Ident.
    // Contextual detection is unambiguous instead: a field is
    // `[meta] [IntLit] [private] Ident ':' type`, so an Ident followed by an
    // integer or string literal is a form no field can take.
    atReservedDeclaration() {
        const token = this.peek();
        if (token.kind !== "Ident" /* TokenKind.Ident */)
            return false;
        if (token.value !== "reserved")
            return false;
        const next = this.peekAt(1).kind;
        return next === "IntLit" /* TokenKind.IntLit */ || next === "StringLit" /* TokenKind.StringLit */;
    }
    // reserved 7;   reserved 7, 9..12;   reserved "oldName";
    parseReserved() {
        const span = this.span();
        this.advance(); // the contextual `reserved`
        const ranges = [];
        const names = [];
        while (true) {
            if (this.at("StringLit" /* TokenKind.StringLit */)) {
                names.push(this.expectString());
            }
            else {
                ranges.push(this.parseReservedRange());
            }
            if (!this.at("," /* TokenKind.Comma */))
                break;
            this.advance();
        }
        this.expect(";" /* TokenKind.Semicolon */);
        return { kind: "reserved", ranges, names, span };
    }
    parseReservedRange() {
        const span = this.span();
        const from = this.expectInt("reserved ordinal");
        if (this.at("-" /* TokenKind.Minus */)) {
            throw new ParseError("Reserved ranges use '..' rather than '-', e.g. `reserved 9..12;`", this.peek());
        }
        if (!this.at(".." /* TokenKind.DotDot */)) {
            return { from, to: from, span };
        }
        this.advance(); // ..
        const to = this.expectInt("reserved range end");
        if (from > to) {
            throw new ParseError(`Reserved range is inverted: ${from}..${to}`, this.peek());
        }
        return { from, to, span };
    }
    // Consume an identifier that must equal `word` (a contextual keyword like `on`).
    expectContextual(word) {
        const tok = this.peek();
        if (tok.kind === "Ident" /* TokenKind.Ident */ && tok.value === word) {
            this.advance();
            return;
        }
        throw new ParseError(`Expected '${word}'`, tok);
    }
    // interface Orders { op list(): [Order]  op get(id: uuid): Order }
    parseInterface(meta) {
        const span = this.span();
        this.expect("interface" /* TokenKind.Interface */);
        const name = this.expectIdent("interface name");
        this.expect("{" /* TokenKind.LBrace */);
        const operations = [];
        while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
            while (this.at("DocComment" /* TokenKind.DocComment */))
                this.advance();
            if (this.at("}" /* TokenKind.RBrace */))
                break;
            const opMeta = this.parseLeadingMetadata();
            operations.push(this.parseOperation(opMeta));
        }
        this.expect("}" /* TokenKind.RBrace */);
        return {
            kind: "interface", name, operations,
            decorators: meta.decorators, directives: meta.directives, doc: meta.doc, span,
        };
    }
    // A decorator name segment may reuse a reserved keyword (e.g. @sql.type),
    // so accept any identifier-like word, not just Ident tokens.
    expectNameSegment(role) {
        const tok = this.peek();
        if (tok.kind === "Ident" /* TokenKind.Ident */ || /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok.value)) {
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
    parseTypeExpr() {
        return this.parseUnionType();
    }
    parseUnionType() {
        const span = this.span();
        const first = this.parseNullableType();
        if (!this.at("|" /* TokenKind.Pipe */))
            return first;
        const variants = [first];
        while (this.at("|" /* TokenKind.Pipe */)) {
            this.advance();
            variants.push(this.parseNullableType());
        }
        return { kind: "union", variants, span };
    }
    parseNullableType() {
        const span = this.span();
        const inner = this.parsePrimaryType();
        if (this.at("?" /* TokenKind.Question */)) {
            this.advance();
            return { kind: "nullable", inner, span };
        }
        return inner;
    }
    parsePrimaryType() {
        return this.parsePrimaryTypeInner(this.span());
    }
    parsePrimaryTypeInner(span) {
        const tok = this.peek();
        const scalarKind = SCALAR_KINDS.get(tok.kind);
        if (scalarKind !== undefined) {
            this.advance();
            return { kind: "scalar", scalar: scalarKind, span };
        }
        if (tok.kind === "null" /* TokenKind.Null */) {
            this.advance();
            return { kind: "null", span };
        }
        if (tok.kind === "decimal" /* TokenKind.Decimal */) {
            this.advance();
            this.expect("(" /* TokenKind.LParen */);
            const precision = this.expectInt("decimal precision");
            this.expect("," /* TokenKind.Comma */);
            const scale = this.expectInt("decimal scale");
            this.expect(")" /* TokenKind.RParen */);
            return { kind: "decimal", precision, scale, span };
        }
        if (tok.kind === "[" /* TokenKind.LBracket */) {
            this.advance();
            const element = this.parseTypeExpr();
            const array = { kind: "array", element, span };
            if (this.at(";" /* TokenKind.Semicolon */)) {
                this.advance();
                const bounds = this.parseArrayBounds();
                if (bounds.minItems !== undefined)
                    array.minItems = bounds.minItems;
                if (bounds.maxItems !== undefined)
                    array.maxItems = bounds.maxItems;
            }
            this.expect("]" /* TokenKind.RBracket */);
            return array;
        }
        if (tok.kind === "{" /* TokenKind.LBrace */) {
            this.advance();
            const key = this.parseTypeExpr();
            this.expect(":" /* TokenKind.Colon */);
            const value = this.parseTypeExpr();
            this.expect("}" /* TokenKind.RBrace */);
            return { kind: "map", key, value, span };
        }
        if (tok.kind === "oneof" /* TokenKind.Oneof */) {
            this.advance();
            this.expect("{" /* TokenKind.LBrace */);
            const variants = [];
            while (!this.at("}" /* TokenKind.RBrace */) && !this.at("EOF" /* TokenKind.EOF */)) {
                const vspan = this.span();
                const ordinal = this.expectInt("oneof variant ordinal");
                const name = this.expectIdent("oneof variant name");
                this.expect(":" /* TokenKind.Colon */);
                const type = this.parseTypeExpr();
                variants.push({ ordinal, name, type, span: vspan });
            }
            this.expect("}" /* TokenKind.RBrace */);
            return { kind: "oneof", variants, span };
        }
        if (tok.kind === "(" /* TokenKind.LParen */) {
            this.advance();
            const inner = this.parseTypeExpr();
            this.expect(")" /* TokenKind.RParen */);
            return inner;
        }
        if (tok.kind === "Ident" /* TokenKind.Ident */) {
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
    parseExpr() {
        return this.parseOrExpr();
    }
    parseOrExpr() {
        let left = this.parseAndExpr();
        while (this.at("||" /* TokenKind.Or */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseAndExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseAndExpr() {
        let left = this.parseEqExpr();
        while (this.at("&&" /* TokenKind.And */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseEqExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseEqExpr() {
        let left = this.parseRelExpr();
        while (this.at("==" /* TokenKind.EqEq */) || this.at("!=" /* TokenKind.NotEq */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseRelExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseRelExpr() {
        let left = this.parseAddExpr();
        while (this.at("<" /* TokenKind.Lt */) ||
            this.at(">" /* TokenKind.Gt */) ||
            this.at("<=" /* TokenKind.LtEq */) ||
            this.at(">=" /* TokenKind.GtEq */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseAddExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseAddExpr() {
        let left = this.parseMulExpr();
        while (this.at("+" /* TokenKind.Plus */) || this.at("-" /* TokenKind.Minus */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseMulExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseMulExpr() {
        let left = this.parseUnaryExpr();
        while (this.at("*" /* TokenKind.Star */) || this.at("/" /* TokenKind.Slash */)) {
            const span = this.span();
            const op = this.advance().value;
            const right = this.parseUnaryExpr();
            left = { kind: "binary", op, left, right, span };
        }
        return left;
    }
    parseUnaryExpr() {
        if (this.at("!" /* TokenKind.Bang */) || this.at("-" /* TokenKind.Minus */)) {
            const span = this.span();
            const op = this.advance().value;
            const operand = this.parseUnaryExpr();
            return { kind: "unary", op, operand, span };
        }
        return this.parsePrimaryExpr();
    }
    parsePrimaryExpr() {
        const span = this.span();
        const tok = this.peek();
        if (tok.kind === "IntLit" /* TokenKind.IntLit */) {
            this.advance();
            return { kind: "literal", value: parseInt(tok.value, 10), span };
        }
        if (tok.kind === "FloatLit" /* TokenKind.FloatLit */) {
            this.advance();
            return { kind: "literal", value: parseFloat(tok.value), span };
        }
        if (tok.kind === "StringLit" /* TokenKind.StringLit */) {
            this.advance();
            return { kind: "literal", value: tok.value, span };
        }
        if (tok.kind === "(" /* TokenKind.LParen */) {
            this.advance();
            const inner = this.parseExpr();
            this.expect(")" /* TokenKind.RParen */);
            return inner;
        }
        if (tok.kind === "Ident" /* TokenKind.Ident */) {
            const name = this.advance().value;
            // Function call: name(arg, arg, …)
            if (this.at("(" /* TokenKind.LParen */)) {
                this.advance();
                const args = [];
                while (!this.at(")" /* TokenKind.RParen */) && !this.at("EOF" /* TokenKind.EOF */)) {
                    args.push(this.parseExpr());
                    if (this.at("," /* TokenKind.Comma */))
                        this.advance();
                }
                this.expect(")" /* TokenKind.RParen */);
                return { kind: "call", callee: name, args, span };
            }
            return { kind: "ident", name, span };
        }
        throw new ParseError("Expected an expression", tok);
    }
    // ── Qualified identifier: Foo | myorg.ecommerce.Order ────────────────────────
    parseQualifiedIdent() {
        const parts = [this.expectIdent("identifier")];
        while (this.at("." /* TokenKind.Dot */)) {
            this.advance();
            parts.push(this.expectIdent("identifier after '.'"));
        }
        return parts;
    }
    // ── Primitive helpers ─────────────────────────────────────────────────────────
    peek() {
        return this.tokens[this.pos] ??
            { kind: "EOF" /* TokenKind.EOF */, value: "", line: 0, col: 0 };
    }
    peekAt(offset) {
        return this.tokens[this.pos + offset] ??
            { kind: "EOF" /* TokenKind.EOF */, value: "", line: 0, col: 0 };
    }
    advance() {
        return this.tokens[this.pos++] ??
            { kind: "EOF" /* TokenKind.EOF */, value: "", line: 0, col: 0 };
    }
    at(kind) {
        return this.peek().kind === kind;
    }
    expect(kind) {
        const tok = this.peek();
        if (tok.kind !== kind) {
            throw new ParseError(`Expected '${kind}'`, tok);
        }
        return this.advance();
    }
    /** Expect an Ident token; `role` is used only in error messages. */
    expectIdent(role) {
        const tok = this.peek();
        if (tok.kind !== "Ident" /* TokenKind.Ident */) {
            throw new ParseError(`Expected ${role} (identifier)`, tok);
        }
        return this.advance().value;
    }
    // Array length spec after `;`: `N` (fixed), `min..max`, `min..`, or `..max`.
    parseArrayBounds() {
        if (this.at(".." /* TokenKind.DotDot */)) {
            this.advance();
            return { maxItems: this.expectInt("array max length") };
        }
        const first = this.expectInt("array length");
        if (this.at(".." /* TokenKind.DotDot */)) {
            this.advance();
            if (this.at("]" /* TokenKind.RBracket */))
                return { minItems: first };
            const maxItems = this.expectInt("array max length");
            if (first > maxItems) {
                throw new ParseError(`Array length range is inverted: ${first}..${maxItems}`, this.peek());
            }
            return { minItems: first, maxItems };
        }
        return { minItems: first, maxItems: first };
    }
    expectInt(role) {
        const tok = this.peek();
        if (tok.kind !== "IntLit" /* TokenKind.IntLit */) {
            throw new ParseError(`Expected ${role} (integer)`, tok);
        }
        return parseInt(this.advance().value, 10);
    }
    expectString() {
        const tok = this.peek();
        if (tok.kind !== "StringLit" /* TokenKind.StringLit */) {
            throw new ParseError("Expected a string literal", tok);
        }
        return this.advance().value;
    }
    /** Capture the current line/col as a Span before consuming tokens. */
    span() {
        const tok = this.peek();
        return { line: tok.line, col: tok.col };
    }
}
//# sourceMappingURL=parser.js.map