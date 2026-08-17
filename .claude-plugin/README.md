# openschema-lsp

Claude Code plugin that attaches the OpenSchema language server so the agent gets
**live diagnostics on every `.schema` / `.openschema` edit** — the same way the
official `typescript-lsp` plugin attaches tsserver. No editor or IDE required: the
Claude Code harness spawns the server over stdio and injects its diagnostics
(OS#### codes) back into context after each edit.

## What it provides

- Diagnostics (resolver errors + warnings with spans)
- Hover, go-to-definition, find-references, completion, document outline

All of it reuses the real compiler (`src/lsp/analyze.ts` → lexer/parser/resolver).

## Enable

From a Claude Code session:

```
/plugin
```

then add this directory (`packages/openschema`) as a local plugin, or point your
plugin marketplace at it. Once enabled, open any `.schema` file and edit it —
diagnostics appear automatically.

The manifest runs the server with `bun` against `src/` so it never goes stale
against a build:

```json
"command": "bun",
"args": ["run", "${CLAUDE_PLUGIN_ROOT}/src/lsp/server.ts"]
```

For a published/installed package that ships only `dist/`, use the bin instead:

```json
"command": "openschema-lsp"
```

(the `openschema-lsp` bin maps to `dist/lsp/server.js`; run `bun run build` first).

## Verify it loaded

Edit a `.schema` file with a deliberate error (e.g. reference an undefined type).
An `OS####` diagnostic should surface after the edit. If nothing appears, confirm
`${CLAUDE_PLUGIN_ROOT}` expanded in the args — as a fallback replace it with the
absolute path to `src/lsp/server.ts`.
