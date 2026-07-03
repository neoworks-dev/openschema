// tests/lexer.test.ts
import { describe, it, expect } from "bun:test";
import { Lexer, LexError } from "../src/lexer/lexer";
import { TokenKind } from "../src/lexer/tokens";

function lex(src: string) {
  return new Lexer(src).tokenize();
}

// Strips EOF for cleaner assertions
function tokens(src: string) {
  return lex(src).filter(t => t.kind !== TokenKind.EOF);
}

function kinds(src: string) {
  return tokens(src).map(t => t.kind);
}

function values(src: string) {
  return tokens(src).map(t => t.value);
}

// ── Whitespace & comments ─────────────────────────────────────────────────────

describe("whitespace and comments", () => {
  it("ignores spaces, tabs and newlines", () => {
    expect(kinds("  \t\n  ")).toEqual([]);
  });

  it("ignores line comments", () => {
    expect(kinds("// this is a comment\nmodel")).toEqual([TokenKind.Model]);
  });

  it("ignores block comments", () => {
    expect(kinds("/* block */ model /* another */")).toEqual([TokenKind.Model]);
  });

  it("handles block comment spanning multiple lines", () => {
    expect(kinds("/*\n  multi\n  line\n*/\nmodel")).toEqual([TokenKind.Model]);
  });

  it("throws on unterminated block comment", () => {
    expect(() => lex("/* not closed")).toThrow(LexError);
  });

  it("attaches correct line numbers", () => {
    const toks = tokens("model\nUser");
    expect(toks[0].line).toBe(1);
    expect(toks[1].line).toBe(2);
  });

  it("attaches correct column numbers", () => {
    const toks = tokens("model User");
    expect(toks[0].col).toBe(1);
    expect(toks[1].col).toBe(7);
  });
});

// ── Identifiers ───────────────────────────────────────────────────────────────

describe("identifiers", () => {
  it("lexes a simple identifier", () => {
    expect(kinds("hello")).toEqual([TokenKind.Ident]);
    expect(values("hello")).toEqual(["hello"]);
  });

  it("lexes identifiers with underscores and digits", () => {
    expect(kinds("my_field_1")).toEqual([TokenKind.Ident]);
    expect(values("my_field_1")).toEqual(["my_field_1"]);
  });

  it("lexes an underscore-prefixed identifier", () => {
    expect(kinds("_private")).toEqual([TokenKind.Ident]);
  });

  it("does not treat digits as identifier starts", () => {
    expect(kinds("1abc")).toEqual([TokenKind.IntLit, TokenKind.Ident]);
  });

  it("lexes a backtick-escaped identifier as an Ident", () => {
    expect(kinds("`hello`")).toEqual([TokenKind.Ident]);
    expect(values("`hello`")).toEqual(["hello"]);
  });

  it("treats a reserved word as an Ident when backtick-escaped", () => {
    expect(kinds("`model`")).toEqual([TokenKind.Ident]);
    expect(values("`model`")).toEqual(["model"]);
  });

  it("allows spaces and symbols inside a backtick-escaped identifier", () => {
    expect(values("`User Account!`")).toEqual(["User Account!"]);
  });

  it("throws on an unterminated escaped identifier", () => {
    expect(() => lex("`oops")).toThrow();
  });
});

// ── Keywords ──────────────────────────────────────────────────────────────────

describe("keywords", () => {
  const cases: [string, TokenKind][] = [
    ["namespace",   TokenKind.Namespace],
    ["import",      TokenKind.Import],
    ["from",        TokenKind.From],
    ["type",        TokenKind.Type],
    ["model",      TokenKind.Model],
    ["enum",        TokenKind.Enum],
    ["oneof",       TokenKind.Oneof],
    ["extends",     TokenKind.Extends],
    ["private",     TokenKind.Private],
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
    ["uuid",        TokenKind.Uuid],
    ["date",        TokenKind.Date],
    ["time",        TokenKind.Time],
    ["timestamp",   TokenKind.Timestamp],
    ["duration",    TokenKind.Duration],
  ];

  // These words were keywords in the bracket grammar. They are now ordinary
  // identifiers usable as decorator names / arguments (e.g. @primaryKey,
  // @compatibility(backward)).
  const demotedToIdent = [
    "index", "on", "primary_key", "not_null", "unique", "references",
    "default", "check", "compatibility", "table", "backward", "forward",
    "full", "none",
  ];
  for (const word of demotedToIdent) {
    it(`lexes former keyword '${word}' as an identifier`, () => {
      expect(kinds(word)).toEqual([TokenKind.Ident]);
    });
  }

  for (const [word, kind] of cases) {
    it(`recognises keyword '${word}'`, () => {
      expect(kinds(word)).toEqual([kind]);
    });
  }

  it("does not mistake a keyword prefix for a keyword", () => {
    expect(kinds("records")).toEqual([TokenKind.Ident]);
    expect(kinds("enumerated")).toEqual([TokenKind.Ident]);
  });
});

// ── Numeric literals ──────────────────────────────────────────────────────────

describe("numeric literals", () => {
  it("lexes a single-digit integer", () => {
    const [t] = tokens("0");
    expect(t.kind).toBe(TokenKind.IntLit);
    expect(t.value).toBe("0");
  });

  it("lexes a multi-digit integer", () => {
    expect(values("12345")).toEqual(["12345"]);
  });

  it("lexes a float", () => {
    const [t] = tokens("3.14");
    expect(t.kind).toBe(TokenKind.FloatLit);
    expect(t.value).toBe("3.14");
  });

  it("does not treat '1.' as a float (no trailing digits)", () => {
    // 1. is integer 1 then dot
    expect(kinds("1.")).toEqual([TokenKind.IntLit, TokenKind.Dot]);
  });

  it("lexes two integers separated by whitespace", () => {
    expect(kinds("1 2")).toEqual([TokenKind.IntLit, TokenKind.IntLit]);
    expect(values("1 2")).toEqual(["1", "2"]);
  });
});

// ── String literals ───────────────────────────────────────────────────────────

describe("string literals", () => {
  it("lexes an empty string", () => {
    const [t] = tokens('""');
    expect(t.kind).toBe(TokenKind.StringLit);
    expect(t.value).toBe("");
  });

  it("lexes a plain string", () => {
    expect(values('"hello world"')).toEqual(["hello world"]);
  });

  it("handles escape sequences", () => {
    expect(values('"a\\nb\\tc\\\\d\\\"e"')).toEqual(['a\nb\tc\\d"e']);
  });

  it("throws on unterminated string", () => {
    expect(() => lex('"not closed')).toThrow(LexError);
  });

  it("throws on newline inside string", () => {
    expect(() => lex('"line1\nline2"')).toThrow(LexError);
  });

  it("throws on unknown escape", () => {
    expect(() => lex('"\\q"')).toThrow(LexError);
  });
});

// ── Punctuation ───────────────────────────────────────────────────────────────

describe("punctuation", () => {
  const singles: [string, TokenKind][] = [
    ["{", TokenKind.LBrace],
    ["}", TokenKind.RBrace],
    ["[", TokenKind.LBracket],
    ["]", TokenKind.RBracket],
    ["(", TokenKind.LParen],
    [")", TokenKind.RParen],
    [":", TokenKind.Colon],
    [",", TokenKind.Comma],
    [".", TokenKind.Dot],
    ["=", TokenKind.Equals],
    ["|", TokenKind.Pipe],
    ["?", TokenKind.Question],
    ["@", TokenKind.At],
    ["+", TokenKind.Plus],
    ["-", TokenKind.Minus],
    ["*", TokenKind.Star],
    ["/", TokenKind.Slash],
    ["<", TokenKind.Lt],
    [">", TokenKind.Gt],
    ["!", TokenKind.Bang],
  ];

  for (const [ch, kind] of singles) {
    it(`lexes '${ch}'`, () => {
      expect(kinds(ch)).toEqual([kind]);
    });
  }

  const doubles: [string, TokenKind][] = [
    ["<=", TokenKind.LtEq],
    [">=", TokenKind.GtEq],
    ["==", TokenKind.EqEq],
    ["!=", TokenKind.NotEq],
    ["&&", TokenKind.And],
    ["||", TokenKind.Or],
  ];

  for (const [op, kind] of doubles) {
    it(`lexes two-char operator '${op}'`, () => {
      expect(kinds(op)).toEqual([kind]);
    });
  }

  it("distinguishes = from ==", () => {
    expect(kinds("= ==")).toEqual([TokenKind.Equals, TokenKind.EqEq]);
  });

  it("distinguishes < from <=", () => {
    expect(kinds("< <=")).toEqual([TokenKind.Lt, TokenKind.LtEq]);
  });
});

// ── EOF ───────────────────────────────────────────────────────────────────────

describe("EOF", () => {
  it("always ends with EOF", () => {
    const toks = lex("");
    expect(toks.at(-1)?.kind).toBe(TokenKind.EOF);
  });

  it("EOF has empty value", () => {
    expect(lex("").at(-1)?.value).toBe("");
  });
});

// ── Realistic snippet ─────────────────────────────────────────────────────────

describe("realistic snippet", () => {
  it("tokenizes a decorated field declaration", () => {
    expect(kinds("@unique 2 email: string")).toEqual([
      TokenKind.At,
      TokenKind.Ident,
      TokenKind.IntLit,
      TokenKind.Ident,
      TokenKind.Colon,
      TokenKind.KwString,
    ]);
  });

  it("tokenizes an annotation", () => {
    expect(kinds('@target(postgres: "JSONB")')).toEqual([
      TokenKind.At,
      TokenKind.Ident,
      TokenKind.LParen,
      TokenKind.Ident,
      TokenKind.Colon,
      TokenKind.StringLit,
      TokenKind.RParen,
    ]);
  });

  it("tokenizes a check decorator expression", () => {
    expect(kinds("@check(total >= 0 && total <= 1000)")).toEqual([
      TokenKind.At,
      TokenKind.Ident,
      TokenKind.LParen,
      TokenKind.Ident,
      TokenKind.GtEq,
      TokenKind.IntLit,
      TokenKind.And,
      TokenKind.Ident,
      TokenKind.LtEq,
      TokenKind.IntLit,
      TokenKind.RParen,
    ]);
  });
});