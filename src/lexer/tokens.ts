// src/token.ts
// All token kinds produced by the lexer.

export const enum TokenKind {
  // ── Literals ──────────────────────────────────────────────
  IntLit    = "IntLit",
  FloatLit  = "FloatLit",
  StringLit = "StringLit",

  // ── Identifier (non-keyword) ──────────────────────────────
  Ident = "Ident",

  // ── Structural keywords ───────────────────────────────────
  Namespace = "namespace",
  Import    = "import",
  From      = "from",
  Type      = "type",
  Model     = "model",
  Enum      = "enum",
  Oneof     = "oneof",
  Op        = "op",
  Interface = "interface",
  Overlay   = "overlay",

  // ── Scalar type keywords ──────────────────────────────────
  Bool      = "bool",
  I8        = "i8",
  I16       = "i16",
  I32       = "i32",
  I64       = "i64",
  U8        = "u8",
  U16       = "u16",
  U32       = "u32",
  U64       = "u64",
  F32       = "f32",
  F64       = "f64",
  Decimal   = "decimal",
  KwString  = "string",
  Bytes     = "bytes",
  Json      = "json",
  Uuid      = "uuid",
  Date      = "date",
  Time      = "time",
  Timestamp = "timestamp",
  Duration  = "duration",

  // ── Modifier keywords ─────────────────────────────────────
	Extends  = "extends",
	Private  = "private",

  // ── Punctuation ───────────────────────────────────────────
  LBrace   = "{",
  RBrace   = "}",
  LBracket = "[",
  RBracket = "]",
  LParen   = "(",
  RParen   = ")",
  Colon    = ":",
  Semicolon = ";",
  Comma    = ",",
  Dot      = ".",
  DotDot   = "..",
  Equals   = "=",
  Pipe     = "|",
  Question = "?",
  At       = "@",
  Hash     = "#",

  // ── Expression operators ──────────────────────────────────
  Plus   = "+",
  Minus  = "-",
  Star   = "*",
  Slash  = "/",
  Bang   = "!",
  Lt     = "<",
  Gt     = ">",
  LtEq   = "<=",
  GtEq   = ">=",
  EqEq   = "==",
  NotEq  = "!=",
  And    = "&&",
  Or     = "||",

  // ── End of input ──────────────────────────────────────────
	EOF = "EOF",
	
	// ── Doc comment (not a real token, but we want to keep it in the token stream) ──
  DocComment = "DocComment",
}

export interface Token {
  kind:  TokenKind
  value: string
  line:  number
  col:   number
}