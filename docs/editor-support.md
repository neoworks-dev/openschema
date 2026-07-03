# Editor support

OpenSchema ships two independent pieces of editor tooling:

| Piece | Gives you | Lives in |
|-------|-----------|----------|
| **Tree-sitter grammar** | Syntax highlighting, folding, structural selection | `tree-sitter-openschema/` |
| **Language server (LSP)** | Live diagnostics, hover, go-to-definition, completion, outline | `src/lsp/` |

They work together but neither depends on the other. The instructions below are
for Neovim 0.11+, but the LSP is a standard stdio server that works in any
LSP-capable editor.

---

## 1. Tree-sitter grammar

The grammar mirrors the real lexer/parser: decorators and directives, leading
ordinals, `model`/`enum`/`type`/`op`/`interface`/`overlay`, the full type
algebra (scalars, `decimal(p,s)`, arrays, maps, nullable, unions, `oneof`,
generics), and backtick-escaped identifiers.

### Install (Neovim)

Requires the [`tree-sitter` CLI](https://tree-sitter.github.io/tree-sitter/cli/).

```sh
editor/nvim/install.sh
```

This runs `tree-sitter generate` + `tree-sitter build`, then copies the compiled
parser to `~/.config/nvim/parser/openschema.so` and the queries to
`~/.config/nvim/queries/openschema/`.

### Work on the grammar

```sh
cd tree-sitter-openschema
tree-sitter generate                 # regenerate src/parser.c from grammar.js
tree-sitter test                     # run the corpus tests in test/corpus/
tree-sitter parse ../examples/ecommerce/orders.schema   # inspect a parse tree
```

Highlight captures use the standard Neovim groups (`@keyword`, `@type`,
`@type.builtin`, `@variable.member`, `@attribute`, `@comment.documentation`, …),
so they pick up your colorscheme automatically.

---

## 2. Language server

The server (`src/lsp/server.ts`) runs the actual OpenSchema compiler over your
buffer, so the editor reports exactly what the CLI would — the same `OS####`
diagnostic codes, including ordinal, name-resolution, and overlay errors. It
follows `import` statements from disk, so a file that imports siblings does not
show false "undefined type" errors.

Features: **diagnostics**, **hover**, **go-to-definition**, **find references**,
**completion**, and the **document outline**.

Find-references reports every place a type is used (field types, parameters,
return types, type arguments, unions, `oneof` variants, alias targets), plus its
declaration. It is currently scoped to the open document.

Hover explains declared types, scalar types, decorator names, and — the useful
part for enum-like arguments — known decorator **argument values**: hovering
`backward` in `@compatibility(backward)` describes the compatibility mode, and
the same applies to `@visibility(...)` phases and `@format(...)` values.
Completion is context-aware: after `@` it offers decorators; inside a decorator
whose arguments are an enum (e.g. `@compatibility(`) it offers the valid values;
elsewhere it offers scalars, keywords, and declared type names.

### Run it

The server runs straight from source with Bun — no build step:

```sh
bun run src/lsp/server.ts      # or: bun run lsp
```

### Neovim setup

After installing the parser, add the bundled config:

```lua
-- in your init.lua, after copying or pointing at the repo file
vim.cmd("luafile /home/moritz/Documents/neoworks/openschema/editor/nvim/openschema.lua")
```

`editor/nvim/openschema.lua` registers the `*.schema` / `*.openschema`
filetype, turns on tree-sitter highlighting + folding, and wires the LSP via
`vim.lsp.config` / `vim.lsp.enable`. Edit the `REPO_ROOT` constant at the top if
you move the repo.

> **Using lazy.nvim?** Do **not** put `editor/nvim/openschema.lua` in your
> `lua/plugins/` directory — lazy imports every file there and expects each to
> *return a plugin spec table*, so a plain config module fails with
> `invalid spec module: plugins.openschema expected a table`. Use
> `editor/nvim/lazy.lua` instead, which returns a proper spec (a local,
> no-download plugin), e.g. copy it to `lua/plugins/openschema.lua`. The plain
> `openschema.lua` is only for `require(...)` or `:luafile`.

> **Neovim 0.10 or earlier** lacks `vim.lsp.config`/`vim.lsp.enable`. Start the
> server from a `FileType` autocmd instead:
>
> ```lua
> vim.api.nvim_create_autocmd("FileType", {
>   pattern = "openschema",
>   callback = function(args)
>     vim.lsp.start({
>       name = "openschema",
>       cmd = { "bun", "run", "/home/moritz/Documents/neoworks/openschema/src/lsp/server.ts" },
>       root_dir = vim.fs.root(args.buf, { "package.json", ".git" }),
>     })
>   end,
> })
> ```

### Other editors

The server speaks LSP over stdio with the launch command
`bun run <repo>/src/lsp/server.ts`. Point any LSP client at that command and
associate it with the `schema`/`openschema` extensions.

---

## Sanity check

Open `examples/ecommerce/orders.schema`. You should see highlighting, an outline
(`:lua vim.lsp.buf.document_symbol()`), and — if you introduce a duplicate
ordinal or reference an undefined type — a diagnostic with an `OS####` code.
