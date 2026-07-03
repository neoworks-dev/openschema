# CLI Reference

```
openschema <command> [options]
```

Run with the built binary (`./openschema`) or via Bun
(`bun run src/cli/index.ts`). Global flags:

| Flag | Meaning |
|------|---------|
| `-v`, `--version` | print the version |
| `-h`, `--help` | print help (also works per command) |

## `parse <file>`

Validate a schema's syntax and print a summary. Exits non-zero on a lex or
parse error, with the line and column.

| Flag | Meaning |
|------|---------|
| `--tokens` | dump the raw token stream instead of the summary |
| `--ast` | dump the full AST as JSON |
| `--json` | format `--tokens`/`--ast` output as JSON |

```bash
openschema parse order.schema
openschema parse order.schema --ast        # inspect the parsed tree
```

Use this as a fast syntax check, or pipe `--ast` into other tooling.

## `diff <old> <new>`

Show every change between two schema files, grouped by severity. See
[Compatibility Checking](./compatibility.md).

| Flag | Meaning | Default |
|------|---------|---------|
| `--only <filter>` | `all`, `breaking`, `warnings`, or `safe` | `all` |
| `--json` | output the result as JSON | off |
| `-v`, `--verbose` | show the rationale and before/after for each change | off |

```bash
openschema diff order.v1.schema order.v2.schema
openschema diff order.v1.schema order.v2.schema --only breaking --verbose
openschema diff order.v1.schema order.v2.schema --json        # for tooling
```

## `check <old> <new>`

Assert that `<new>` is compatible with `<old>` under a mode. Exits `0` if
compatible, `1` if not — designed for CI.

| Flag | Meaning | Default |
|------|---------|---------|
| `-m`, `--mode <mode>` | `backward`, `forward`, `full`, or `none` | `backward` |
| `--json` | output the result as JSON | off |
| `-q`, `--quiet` | print nothing; communicate via exit code only | off |
| `-v`, `--verbose` | show rationale and before/after | on |

```bash
openschema check published.schema proposed.schema --mode backward
openschema check published.schema proposed.schema --mode full --quiet || echo "incompatible"
```

## `gen <schema>`

Generate code for a target. Follows `import`s from the entry file automatically.
See [Code Generation](./code-generation.md).

| Flag | Meaning | Default |
|------|---------|---------|
| `-t`, `--target <target>` | `sql`, `ts`, `go`, `json-schema`, `graphql`, `openapi` (required) | — |
| `-o`, `--out <dir>` | output directory (created if missing) | `.` |
| `--company <id>` | include this company's [overlay](./overlays.md) fields | none |
| `--include-private` | include the schema's own `private` fields | off |

```bash
openschema gen order.schema --target sql --out ./generated
openschema gen order.schema --target ts  --out ./src/types
openschema gen acme-overlay.schema --target sql --out ./acme --company acme
openschema gen order.schema --target graphql --include-private --out ./internal-api
```

On a semantic error (an undefined type, a duplicate ordinal, an unresolved
import), `gen` prints the diagnostics with their codes and exits `1` without
writing output.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | success (or, for `check`, compatible) |
| `1` | a lex/parse/semantic error, or an incompatible `check` |

## Building a standalone binary

```bash
bun build src/cli/index.ts --compile --outfile openschema
```

This produces a single executable with no runtime dependency on Bun or Node —
convenient to vendor into a CI image.
