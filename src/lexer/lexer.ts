// src/lexer.ts
// Converts raw source text into a flat array of Tokens.

import { Token, TokenKind } from "./tokens.js";

// ── Keyword table ─────────────────────────────────────────────────────────────

const KEYWORDS = new Map<string, TokenKind>([
  ["namespace",   TokenKind.Namespace],
  ["import",      TokenKind.Import],
  ["from",        TokenKind.From],
  ["type",        TokenKind.Type],
  ["model",      TokenKind.Model],
  ["enum",        TokenKind.Enum],
  ["oneof",       TokenKind.Oneof],
  ["op",          TokenKind.Op],
  ["interface",   TokenKind.Interface],
  ["overlay",     TokenKind.Overlay],
  ["bool",        TokenKind.Bool],
  ["i8",          TokenKind.I8],
  ["i16",         TokenKind.I16],
  ["i32",         TokenKind.I32],
  ["i64",         TokenKind.I64],
  ["u8",          TokenKind.U8],
  ["u16",         TokenKind.U16],
  ["u32",         TokenKind.U32],
  ["u64",         TokenKind.U64],
  ["f32",         TokenKind.F32],
  ["f64",         TokenKind.F64],
  ["decimal",     TokenKind.Decimal],
  ["string",      TokenKind.KwString],
  ["bytes",       TokenKind.Bytes],
  ["json",        TokenKind.Json],
  ["uuid",        TokenKind.Uuid],
  ["date",        TokenKind.Date],
  ["time",        TokenKind.Time],
  ["timestamp",   TokenKind.Timestamp],
  ["duration",    TokenKind.Duration],
  ["private",     TokenKind.Private],
  ["extends",     TokenKind.Extends],
]);

// ── Single-character punctuation table ───────────────────────────────────────

const SINGLE: Record<string, TokenKind> = {
  "{": TokenKind.LBrace,
  "}": TokenKind.RBrace,
  "[": TokenKind.LBracket,
  "]": TokenKind.RBracket,
  "(": TokenKind.LParen,
  ")": TokenKind.RParen,
  ":": TokenKind.Colon,
  ";": TokenKind.Semicolon,
  ",": TokenKind.Comma,
  ".": TokenKind.Dot,
  "=": TokenKind.Equals,   // single = only; == is handled separately
  "|": TokenKind.Pipe,     // single | only; || is handled separately
  "?": TokenKind.Question,
  "@": TokenKind.At,
  "#": TokenKind.Hash,
  "+": TokenKind.Plus,
  "*": TokenKind.Star,
  "/": TokenKind.Slash,
  "<": TokenKind.Lt,
  ">": TokenKind.Gt,
};

// ── Error type ────────────────────────────────────────────────────────────────

export class LexError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col:  number
  ) {
    super(`Lex error at ${line}:${col}: ${message}`);
    this.name = "LexError";
  }
}

// ── Lexer ─────────────────────────────────────────────────────────────────────

export class Lexer {
  private pos    = 0;
  private line   = 1;
  private col    = 1;
  private tokens: Token[] = [];

  constructor(private readonly source: string) {}

  // Entry point: tokenize the entire source and return the token stream.
  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;
      this.readToken();
    }
    this.push(TokenKind.EOF, "");
    return this.tokens;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private ch(offset = 0): string {
    return this.source[this.pos + offset] ?? "";
  }

  private advance(): string {
    const c = this.source[this.pos++];
    if (c === "\n") { this.line++; this.col = 1; }
    else            { this.col++; }
    return c;
  }

  private push(kind: TokenKind, value: string, line = this.line, col = this.col): void {
    this.tokens.push({ kind, value, line, col });
  }

  // ── Whitespace / comment skipping ───────────────────────────────────────────

  private skipWhitespaceAndComments(): void {
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
          const col  = this.col;
          this.advance(); this.advance(); this.advance(); // consume ///
          // skip leading space
          if (this.ch() === " ") this.advance();
          let text = "";
          while (this.pos < this.source.length && this.ch() !== "\n") {
            text += this.advance();
          }
          this.tokens.push({ kind: TokenKind.DocComment, value: text.trimEnd(), line, col });
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
        const startCol  = this.col;
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

  private readToken(): void {
    const line = this.line;
    const col  = this.col;
    const c    = this.ch();

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
      case "<=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.LtEq,  value: "<=", line, col }); return;
      case ">=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.GtEq,  value: ">=", line, col }); return;
      case "==": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.EqEq,  value: "==", line, col }); return;
      case "!=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.NotEq, value: "!=", line, col }); return;
      case "&&": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.And,   value: "&&", line, col }); return;
      case "||": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Or,    value: "||", line, col }); return;
      case "..": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.DotDot, value: "..", line, col }); return;
    }

    // Minus (not a two-char op in this position)
    if (c === "-") {
      this.advance();
      this.tokens.push({ kind: TokenKind.Minus, value: "-", line, col });
      return;
    }

    // Bang (sole ! not followed by =)
    if (c === "!") {
      this.advance();
      this.tokens.push({ kind: TokenKind.Bang, value: "!", line, col });
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

  private lexString(line: number, col: number): void {
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
          case '"':  value += '"';  break;
          case "\\": value += "\\"; break;
          case "n":  value += "\n"; break;
          case "t":  value += "\t"; break;
          case "r":  value += "\r"; break;
          default:
            throw new LexError(`Unknown escape sequence: \\${esc}`, this.line, this.col);
        }
      } else {
        value += this.advance();
      }
    }

    if (this.ch() !== '"') {
      throw new LexError("Unterminated string literal", line, col);
    }
    this.advance(); // closing "
    this.tokens.push({ kind: TokenKind.StringLit, value, line, col });
  }

  // ── Numeric literal ─────────────────────────────────────────────────────────

  private lexNumber(line: number, col: number): void {
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
      this.tokens.push({ kind: TokenKind.FloatLit, value: raw, line, col });
    } else {
      this.tokens.push({ kind: TokenKind.IntLit, value: raw, line, col });
    }
  }

  // ── Identifier / keyword ────────────────────────────────────────────────────

  private lexWord(line: number, col: number): void {
    let raw = "";
    while (
      this.pos < this.source.length &&
      ((this.ch() >= "a" && this.ch() <= "z") ||
       (this.ch() >= "A" && this.ch() <= "Z") ||
       (this.ch() >= "0" && this.ch() <= "9") ||
        this.ch() === "_")
    ) {
      raw += this.advance();
    }

    const kind = KEYWORDS.get(raw) ?? TokenKind.Ident;
    this.tokens.push({ kind, value: raw, line, col });
  }

  // `escaped name` — the backticked text is always an Ident, even if it is a
  // reserved word or contains characters that are otherwise illegal in a name.
  private lexEscapedIdent(line: number, col: number): void {
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
    this.tokens.push({ kind: TokenKind.Ident, value, line, col });
  }
}