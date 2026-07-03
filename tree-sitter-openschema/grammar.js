/**
 * tree-sitter grammar for the OpenSchema DSL.
 *
 * Mirrors the hand-written lexer/parser in ../src: decorators and directives
 * precede declarations and fields, ordinals lead each field, and the type
 * algebra covers scalars, decimal(p,s), arrays, maps, nullable, unions, oneof,
 * and generic named types. Identifiers may be backtick-escaped.
 */

const commaSep = rule => optional(commaSep1(rule));
const commaSep1 = rule => seq(rule, repeat(seq(",", rule)));
const dotSep1 = rule => seq(rule, repeat(seq(".", rule)));

const SCALAR_TYPES = [
  "bool",
  "i8", "i16", "i32", "i64",
  "u8", "u16", "u32", "u64",
  "f32", "f64",
  "string", "bytes", "uuid", "json",
  "date", "time", "timestamp", "duration",
];

module.exports = grammar({
  name: "openschema",

  word: $ => $.identifier,

  extras: $ => [/\s/, $.comment, $.doc_comment],

  rules: {
    source_file: $ => repeat($._declaration),

    _declaration: $ => choice(
      $.namespace_declaration,
      $.import_declaration,
      $.model_declaration,
      $.enum_declaration,
      $.type_alias,
      $.operation_declaration,
      $.interface_declaration,
      $.overlay_declaration,
    ),

    // ── Annotations ────────────────────────────────────────────────────────────

    _annotation: $ => choice($.decorator, $.directive),

    decorator: $ => seq(
      "@",
      field("name", $.decorator_name),
      optional($.decorator_arguments),
    ),

    decorator_name: $ => dotSep1($.identifier),

    decorator_arguments: $ => seq("(", commaSep($.decorator_argument), ")"),

    decorator_argument: $ => seq(
      optional(seq(field("label", $._name), ":")),
      field("value", $._expression),
    ),

    directive: $ => seq(
      "#",
      field("name", $.identifier),
      repeat($.string),
    ),

    // ── Top-level declarations ─────────────────────────────────────────────────

    namespace_declaration: $ => seq("namespace", field("path", $.qualified_name)),

    import_declaration: $ => seq(
      "import",
      "{", commaSep1($._name), "}",
      "from",
      field("source", $.string),
    ),

    model_declaration: $ => seq(
      repeat($._annotation),
      "model",
      field("name", $._name),
      optional($.type_parameters),
      optional($.extends_clause),
      $.model_body,
    ),

    extends_clause: $ => seq("extends", field("base", $.qualified_name)),

    model_body: $ => seq("{", repeat($.field), "}"),

    field: $ => seq(
      repeat($._annotation),
      field("ordinal", $.integer),
      optional("private"),
      field("name", $._name),
      ":",
      field("type", $._type),
    ),

    enum_declaration: $ => seq(
      repeat($._annotation),
      "enum",
      field("name", $._name),
      $.enum_body,
    ),

    enum_body: $ => seq("{", repeat($.enum_variant), "}"),

    enum_variant: $ => seq(
      repeat($._annotation),
      field("ordinal", $.integer),
      field("name", $._name),
    ),

    type_alias: $ => seq(
      repeat($._annotation),
      "type",
      field("name", $._name),
      optional($.type_parameters),
      "=",
      field("type", $._type),
    ),

    operation_declaration: $ => seq(
      repeat($._annotation),
      "op",
      field("name", $._name),
      $.parameter_list,
      ":",
      field("return_type", $._type),
    ),

    parameter_list: $ => seq("(", commaSep($.parameter), ")"),

    parameter: $ => seq(
      field("name", $._name),
      ":",
      field("type", $._type),
    ),

    interface_declaration: $ => seq(
      repeat($._annotation),
      "interface",
      field("name", $._name),
      "{", repeat($.operation_declaration), "}",
    ),

    overlay_declaration: $ => seq(
      repeat($._annotation),
      "overlay",
      field("company", $._name),
      "on",
      field("base", $.qualified_name),
      $.model_body,
    ),

    // ── Generics ───────────────────────────────────────────────────────────────

    type_parameters: $ => seq("<", commaSep1($.type_parameter), ">"),

    type_parameter: $ => seq(
      field("name", $._name),
      optional(seq("extends", field("constraint", $._type))),
    ),

    type_arguments: $ => seq("<", commaSep1($._type), ">"),

    // ── Types ──────────────────────────────────────────────────────────────────

    _type: $ => choice($._postfix_type, $.union_type),

    union_type: $ => prec.left(seq(
      $._postfix_type,
      repeat1(seq("|", $._postfix_type)),
    )),

    _postfix_type: $ => choice($._primary_type, $.nullable_type),

    nullable_type: $ => seq($._primary_type, "?"),

    _primary_type: $ => choice(
      $.scalar_type,
      $.decimal_type,
      $.array_type,
      $.map_type,
      $.oneof_type,
      $.named_type,
    ),

    scalar_type: $ => choice(...SCALAR_TYPES),

    decimal_type: $ => seq(
      "decimal",
      "(", field("precision", $.integer), ",", field("scale", $.integer), ")",
    ),

    array_type: $ => seq("[", $._type, optional($.array_length), "]"),

    // [T; n] (fixed) or [T; min..max] (range; either end may be omitted).
    array_length: $ => seq(";", choice(
      field("length", $.integer),
      seq(optional(field("min", $.integer)), "..", optional(field("max", $.integer))),
    )),

    map_type: $ => seq("{", field("key", $._type), ":", field("value", $._type), "}"),

    oneof_type: $ => seq(
      "oneof",
      "{", repeat($.oneof_variant), "}",
    ),

    oneof_variant: $ => seq(
      field("ordinal", $.integer),
      field("name", $._name),
      ":",
      field("type", $._type),
      optional(","),
    ),

    named_type: $ => seq(
      field("name", $.qualified_name),
      optional($.type_arguments),
    ),

    // ── Expressions (decorator argument values) ────────────────────────────────

    _expression: $ => choice(
      $.call_expression,
      $.binary_expression,
      $.unary_expression,
      $.qualified_name,
      $.string,
      $.number,
      $.boolean,
    ),

    call_expression: $ => seq(
      field("callee", $.identifier),
      "(", commaSep($._expression), ")",
    ),

    binary_expression: $ => prec.left(1, seq(
      $._expression,
      field("operator", $.binary_operator),
      $._expression,
    )),

    unary_expression: $ => prec(2, seq(
      field("operator", choice("-", "!")),
      $._expression,
    )),

    binary_operator: $ => choice(
      "+", "-", "*", "/",
      "<", ">", "<=", ">=", "==", "!=", "&&", "||",
    ),

    // ── Names and literals ─────────────────────────────────────────────────────

    qualified_name: $ => dotSep1($._name),

    _name: $ => choice($.identifier, $.escaped_identifier),

    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,

    escaped_identifier: $ => /`[^`\n]+`/,

    boolean: $ => token(prec(1, choice("true", "false"))),

    number: $ => choice($.integer, $.float),

    integer: $ => /\d+/,

    float: $ => /\d+\.\d+/,

    string: $ => /"([^"\\\n]|\\.)*"/,

    // /// doc comments are kept distinct so editors can style them.
    doc_comment: $ => token(prec(2, /\/\/\/[^\n]*/)),

    comment: $ => token(prec(1, choice(
      /\/\/[^\n]*/,
      /\/\*[\s\S]*?\*\//,
    ))),
  },
});
