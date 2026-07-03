# tree-sitter-openschema

Tree-sitter grammar for the [OpenSchema](../README.md) DSL.

The grammar (`grammar.js`) tracks the hand-written lexer/parser in `../src`:

- declarations: `namespace`, `import`, `model`, `enum`, `type`, `op`,
  `interface`, `overlay`
- decorators (`@minValue(0)`, `@sql.type("JSONB")`) and directives
  (`#suppress "R003"`)
- leading ordinals and `private` on fields
- the type algebra: scalars, `decimal(p, s)`, arrays `[T]`, maps `{K: V}`,
  nullable `T?`, unions `A | B`, `oneof { 1 a: A }`, and generics `Page<T>`
- backtick-escaped identifiers (`` `User Account` ``) and `///` doc comments

## Develop

```sh
tree-sitter generate     # build src/parser.c from grammar.js
tree-sitter test         # run corpus tests (test/corpus/)
tree-sitter build -o openschema.so
tree-sitter parse ../examples/ecommerce/orders.schema
```

## Queries

- `queries/highlights.scm` — syntax highlighting (Neovim capture groups)
- `queries/folds.scm` — foldable regions

## Install into Neovim

See [`../docs/editor-support.md`](../docs/editor-support.md), or just run
`../editor/nvim/install.sh`.
