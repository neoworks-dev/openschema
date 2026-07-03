; OpenSchema syntax highlighting (Neovim capture conventions).

; ── Comments ────────────────────────────────────────────────────────────────
(comment) @comment @spell
(doc_comment) @comment.documentation @spell

; ── Keywords ────────────────────────────────────────────────────────────────
[
  "namespace"
  "import"
  "from"
  "model"
  "enum"
  "type"
  "op"
  "interface"
  "overlay"
  "extends"
  "oneof"
  "on"
] @keyword

"private" @keyword.modifier

; ── Literals ────────────────────────────────────────────────────────────────
(string) @string
(integer) @number
(float) @number.float
(boolean) @boolean

; ── Built-in scalar types ───────────────────────────────────────────────────
(scalar_type) @type.builtin
(decimal_type "decimal" @type.builtin)

; ── Declaration names ───────────────────────────────────────────────────────
(model_declaration name: (identifier) @type.definition)
(model_declaration name: (escaped_identifier) @type.definition)
(enum_declaration name: (identifier) @type.definition)
(enum_declaration name: (escaped_identifier) @type.definition)
(type_alias name: (identifier) @type.definition)
(type_alias name: (escaped_identifier) @type.definition)
(interface_declaration name: (identifier) @type.definition)
(interface_declaration name: (escaped_identifier) @type.definition)
(operation_declaration name: (identifier) @function)
(operation_declaration name: (escaped_identifier) @function)
(overlay_declaration company: (identifier) @module)
(overlay_declaration company: (escaped_identifier) @module)
(type_parameter name: (identifier) @type.parameter)

; ── Namespace path ──────────────────────────────────────────────────────────
(namespace_declaration path: (qualified_name (identifier) @module))

; ── Type references ─────────────────────────────────────────────────────────
(named_type (qualified_name (identifier) @type))
(named_type (qualified_name (escaped_identifier) @type))
(extends_clause (qualified_name (identifier) @type))
(overlay_declaration base: (qualified_name (identifier) @type))
(type_parameter constraint: (named_type (qualified_name (identifier) @type)))

; ── Members ─────────────────────────────────────────────────────────────────
(field name: (identifier) @variable.member)
(field name: (escaped_identifier) @variable.member)
(field ordinal: (integer) @number)
(enum_variant name: (identifier) @constant)
(enum_variant name: (escaped_identifier) @constant)
(parameter name: (identifier) @variable.parameter)
(oneof_variant name: (identifier) @variable.member)

; ── Imports ─────────────────────────────────────────────────────────────────
(import_declaration (identifier) @type)
(import_declaration (escaped_identifier) @type)

; ── Decorators and directives ───────────────────────────────────────────────
(decorator "@" @attribute)
(decorator name: (decorator_name (identifier) @attribute))
(directive "#" @attribute)
(directive name: (identifier) @attribute)

; ── Expressions in decorator arguments ──────────────────────────────────────
(call_expression callee: (identifier) @function.call)
(decorator_argument label: (identifier) @variable.parameter)

; ── Operators and punctuation ───────────────────────────────────────────────
(binary_operator) @operator
[
  "?"
  "|"
  "="
] @operator

[ ":" "," "." ] @punctuation.delimiter
[ "(" ")" "{" "}" "[" "]" "<" ">" ] @punctuation.bracket
