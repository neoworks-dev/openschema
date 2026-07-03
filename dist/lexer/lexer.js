// src/lexer.ts
// Converts raw source text into a flat array of Tokens.
// ── Keyword table ─────────────────────────────────────────────────────────────
const KEYWORDS = new Map([
    ["namespace", "namespace" /* TokenKind.Namespace */],
    ["import", "import" /* TokenKind.Import */],
    ["from", "from" /* TokenKind.From */],
    ["type", "type" /* TokenKind.Type */],
    ["model", "model" /* TokenKind.Model */],
    ["enum", "enum" /* TokenKind.Enum */],
    ["oneof", "oneof" /* TokenKind.Oneof */],
    ["op", "op" /* TokenKind.Op */],
    ["interface", "interface" /* TokenKind.Interface */],
    ["overlay", "overlay" /* TokenKind.Overlay */],
    ["bool", "bool" /* TokenKind.Bool */],
    ["i8", "i8" /* TokenKind.I8 */],
    ["i16", "i16" /* TokenKind.I16 */],
    ["i32", "i32" /* TokenKind.I32 */],
    ["i64", "i64" /* TokenKind.I64 */],
    ["u8", "u8" /* TokenKind.U8 */],
    ["u16", "u16" /* TokenKind.U16 */],
    ["u32", "u32" /* TokenKind.U32 */],
    ["u64", "u64" /* TokenKind.U64 */],
    ["f32", "f32" /* TokenKind.F32 */],
    ["f64", "f64" /* TokenKind.F64 */],
    ["decimal", "decimal" /* TokenKind.Decimal */],
    ["string", "string" /* TokenKind.KwString */],
    ["bytes", "bytes" /* TokenKind.Bytes */],
    ["json", "json" /* TokenKind.Json */],
    ["uuid", "uuid" /* TokenKind.Uuid */],
    ["date", "date" /* TokenKind.Date */],
    ["time", "time" /* TokenKind.Time */],
    ["timestamp", "timestamp" /* TokenKind.Timestamp */],
    ["duration", "duration" /* TokenKind.Duration */],
    ["private", "private" /* TokenKind.Private */],
    ["extends", "extends" /* TokenKind.Extends */],
]);
// ── Single-character punctuation table ───────────────────────────────────────
const SINGLE = {
    "{": "{" /* TokenKind.LBrace */,
    "}": "}" /* TokenKind.RBrace */,
    "[": "[" /* TokenKind.LBracket */,
    "]": "]" /* TokenKind.RBracket */,
    "(": "(" /* TokenKind.LParen */,
    ")": ")" /* TokenKind.RParen */,
    ":": ":" /* TokenKind.Colon */,
    ";": ";" /* TokenKind.Semicolon */,
    ",": "," /* TokenKind.Comma */,
    ".": "." /* TokenKind.Dot */,
    "=": "=" /* TokenKind.Equals */, // single = only; == is handled separately
    "|": "|" /* TokenKind.Pipe */, // single | only; || is handled separately
    "?": "?" /* TokenKind.Question */,
    "@": "@" /* TokenKind.At */,
    "#": "#" /* TokenKind.Hash */,
    "+": "+" /* TokenKind.Plus */,
    "*": "*" /* TokenKind.Star */,
    "/": "/" /* TokenKind.Slash */,
    "<": "<" /* TokenKind.Lt */,
    ">": ">" /* TokenKind.Gt */,
};
// ── Error type ────────────────────────────────────────────────────────────────
export class LexError extends Error {
    constructor(message, line, col) {
        super(`Lex error at ${line}:${col}: ${message}`);
        this.line = line;
        this.col = col;
        this.name = "LexError";
    }
}
// ── Lexer ─────────────────────────────────────────────────────────────────────
export class Lexer {
    constructor(source) {
        this.source = source;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
    }
    // Entry point: tokenize the entire source and return the token stream.
    tokenize() {
        while (this.pos < this.source.length) {
            this.skipWhitespaceAndComments();
            if (this.pos >= this.source.length)
                break;
            this.readToken();
        }
        this.push("EOF" /* TokenKind.EOF */, "");
        return this.tokens;
    }
    // ── Internal helpers ────────────────────────────────────────────────────────
    ch(offset = 0) {
        return this.source[this.pos + offset] ?? "";
    }
    advance() {
        const c = this.source[this.pos++];
        if (c === "\n") {
            this.line++;
            this.col = 1;
        }
        else {
            this.col++;
        }
        return c;
    }
    push(kind, value, line = this.line, col = this.col) {
        this.tokens.push({ kind, value, line, col });
    }
    // ── Whitespace / comment skipping ───────────────────────────────────────────
    skipWhitespaceAndComments() {
        while (this.pos < this.source.length) {
            const c = this.ch();
            // Whitespace
            if (c === " " || c === "\t" || c === "\r" || c === "\n") {
                this.advance();
                continue;
            }
            // Line comment: //
            if (c === "/" && this.ch(1) === "/") {
                // Doc comment: /// attaches to the next declaration
                if (this.ch(2) === "/") {
                    const line = this.line;
                    const col = this.col;
                    this.advance();
                    this.advance();
                    this.advance(); // consume ///
                    // skip leading space
                    if (this.ch() === " ")
                        this.advance();
                    let text = "";
                    while (this.pos < this.source.length && this.ch() !== "\n") {
                        text += this.advance();
                    }
                    this.tokens.push({ kind: "DocComment" /* TokenKind.DocComment */, value: text.trimEnd(), line, col });
                    continue;
                }
                // Ordinary line comment: discard
                while (this.pos < this.source.length && this.ch() !== "\n") {
                    this.advance();
                }
                continue;
            }
            // Block comment: /* … */
            if (c === "/" && this.ch(1) === "*") {
                const startLine = this.line;
                const startCol = this.col;
                this.advance(); // /
                this.advance(); // *
                let closed = false;
                while (this.pos < this.source.length) {
                    if (this.ch() === "*" && this.ch(1) === "/") {
                        this.advance(); // *
                        this.advance(); // /
                        closed = true;
                        break;
                    }
                    this.advance();
                }
                if (!closed) {
                    throw new LexError("Unterminated block comment", startLine, startCol);
                }
                continue;
            }
            break;
        }
    }
    // ── Token dispatch ──────────────────────────────────────────────────────────
    readToken() {
        const line = this.line;
        const col = this.col;
        const c = this.ch();
        // String literal
        if (c === '"') {
            this.lexString(line, col);
            return;
        }
        // Backtick-escaped identifier: `any name`, even reserved words or spaces
        if (c === "`") {
            this.lexEscapedIdent(line, col);
            return;
        }
        // Number (integer or float)
        if (c >= "0" && c <= "9") {
            this.lexNumber(line, col);
            return;
        }
        // Identifier or keyword
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
            this.lexWord(line, col);
            return;
        }
        // Two-character operators — check before single-char fallback
        const two = c + this.ch(1);
        switch (two) {
            case "<=":
                this.advance();
                this.advance();
                this.tokens.push({ kind: "<=" /* TokenKind.LtEq */, value: "<=", line, col });
                return;
            case ">=":
                this.advance();
                this.advance();
                this.tokens.push({ kind: ">=" /* TokenKind.GtEq */, value: ">=", line, col });
                return;
            case "==":
                this.advance();
                this.advance();
                this.tokens.push({ kind: "==" /* TokenKind.EqEq */, value: "==", line, col });
                return;
            case "!=":
                this.advance();
                this.advance();
                this.tokens.push({ kind: "!=" /* TokenKind.NotEq */, value: "!=", line, col });
                return;
            case "&&":
                this.advance();
                this.advance();
                this.tokens.push({ kind: "&&" /* TokenKind.And */, value: "&&", line, col });
                return;
            case "||":
                this.advance();
                this.advance();
                this.tokens.push({ kind: "||" /* TokenKind.Or */, value: "||", line, col });
                return;
            case "..":
                this.advance();
                this.advance();
                this.tokens.push({ kind: ".." /* TokenKind.DotDot */, value: "..", line, col });
                return;
        }
        // Minus (not a two-char op in this position)
        if (c === "-") {
            this.advance();
            this.tokens.push({ kind: "-" /* TokenKind.Minus */, value: "-", line, col });
            return;
        }
        // Bang (sole ! not followed by =)
        if (c === "!") {
            this.advance();
            this.tokens.push({ kind: "!" /* TokenKind.Bang */, value: "!", line, col });
            return;
        }
        // Single-character punctuation
        const kind = SINGLE[c];
        if (kind !== undefined) {
            this.advance();
            this.tokens.push({ kind, value: c, line, col });
            return;
        }
        throw new LexError(`Unexpected character: ${JSON.stringify(c)}`, line, col);
    }
    // ── String literal ──────────────────────────────────────────────────────────
    lexString(line, col) {
        this.advance(); // opening "
        let value = "";
        while (this.pos < this.source.length && this.ch() !== '"') {
            if (this.ch() === "\n") {
                throw new LexError("Unterminated string literal (newline inside)", line, col);
            }
            if (this.ch() === "\\") {
                this.advance(); // backslash
                const esc = this.advance();
                switch (esc) {
                    case '"':
                        value += '"';
                        break;
                    case "\\":
                        value += "\\";
                        break;
                    case "n":
                        value += "\n";
                        break;
                    case "t":
                        value += "\t";
                        break;
                    case "r":
                        value += "\r";
                        break;
                    default:
                        throw new LexError(`Unknown escape sequence: \\${esc}`, this.line, this.col);
                }
            }
            else {
                value += this.advance();
            }
        }
        if (this.ch() !== '"') {
            throw new LexError("Unterminated string literal", line, col);
        }
        this.advance(); // closing "
        this.tokens.push({ kind: "StringLit" /* TokenKind.StringLit */, value, line, col });
    }
    // ── Numeric literal ─────────────────────────────────────────────────────────
    lexNumber(line, col) {
        let raw = "";
        while (this.ch() >= "0" && this.ch() <= "9") {
            raw += this.advance();
        }
        // Float: digits . digits
        if (this.ch() === "." && this.ch(1) >= "0" && this.ch(1) <= "9") {
            raw += this.advance(); // .
            while (this.ch() >= "0" && this.ch() <= "9") {
                raw += this.advance();
            }
            this.tokens.push({ kind: "FloatLit" /* TokenKind.FloatLit */, value: raw, line, col });
        }
        else {
            this.tokens.push({ kind: "IntLit" /* TokenKind.IntLit */, value: raw, line, col });
        }
    }
    // ── Identifier / keyword ────────────────────────────────────────────────────
    lexWord(line, col) {
        let raw = "";
        while (this.pos < this.source.length &&
            ((this.ch() >= "a" && this.ch() <= "z") ||
                (this.ch() >= "A" && this.ch() <= "Z") ||
                (this.ch() >= "0" && this.ch() <= "9") ||
                this.ch() === "_")) {
            raw += this.advance();
        }
        const kind = KEYWORDS.get(raw) ?? "Ident" /* TokenKind.Ident */;
        this.tokens.push({ kind, value: raw, line, col });
    }
    // `escaped name` — the backticked text is always an Ident, even if it is a
    // reserved word or contains characters that are otherwise illegal in a name.
    lexEscapedIdent(line, col) {
        this.advance(); // opening backtick
        let value = "";
        while (this.pos < this.source.length && this.ch() !== "`") {
            if (this.ch() === "\n") {
                throw new LexError("Unterminated escaped identifier (newline inside)", line, col);
            }
            value += this.advance();
        }
        if (this.ch() !== "`") {
            throw new LexError("Unterminated escaped identifier", line, col);
        }
        this.advance(); // closing backtick
        if (value.length === 0) {
            throw new LexError("Empty escaped identifier", line, col);
        }
        this.tokens.push({ kind: "Ident" /* TokenKind.Ident */, value, line, col });
    }
}
//# sourceMappingURL=lexer.js.map