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
| `-t`, `--target <target>` | `sql`, `ts`, `go`, `json-schema`, `graphql`, `openapi`, `surrealdb`, `internal`, `codec` (required) | — |
| `-o`, `--out <dir>` | output directory (created if missing) | `.` |
| `--company <id>` | include this company's [overlay](./overlays.md) fields | none |
| `--include-private` | include the schema's own `private` fields | off |
| `--lock <path>` | ordinal lockfile | `<schema dir>/openschema.lock` |
| `--frozen` | fail if the ordinal ledger is missing or out of date | off |
| `--no-lock` | skip ordinal-ledger validation entirely | off |

```bash
openschema gen order.schema --target sql --out ./generated
openschema gen order.schema --target ts  --out ./src/types
openschema gen order.schema --target codec --out ./src/wire
openschema gen acme-overlay.schema --target sql --out ./acme --company acme
openschema gen order.schema --target graphql --include-private --out ./internal-api
```

On a semantic error (an undefined type, a duplicate ordinal, an unresolved
import), `gen` prints the diagnostics with their codes and exits `1` without
writing output.

`gen` validates the [ordinal ledger](./ordinal-ledger.md) but never writes it — see
that document for why.

## `lock <schema>`

Create or update the [ordinal ledger](./ordinal-ledger.md), which prevents a
retired wire tag from being reclaimed.

| Flag | Meaning | Default |
|------|---------|---------|
| `--lock <path>` | lockfile path | `<schema dir>/openschema.lock` |
| `--check` | do not write; exit `1` if missing or out of date | off |
| `--base <path>` | assert the result still contains everything this lockfile records | none |
| `--json` | machine-readable output | off |

```bash
openschema lock order.schema           # create or update, then commit the lockfile
openschema lock order.schema --check   # CI gate
```

### Wiring the ledger into CI

`--check` alone catches a stale lockfile. To enforce that the ledger is genuinely
append-only, compare against the merge base — the digest cannot do this, because it
is recomputed on every write:

```yaml
- run: git show origin/main:schema/openschema.lock > /tmp/base.lock || true
- run: openschema lock schema/order.schema --check --base /tmp/base.lock
- run: openschema check published.schema schema/order.schema --mode backward
```

The two checks cover different failures. `check` compares two versions pairwise and
cannot see an ordinal retired several versions ago; `lock --check` can.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | success (or, for `check`/`lock --check`, up to date) |
| `1` | a lex/parse/semantic error, an incompatible `check`, an unencodable construct, or a stale/violated ledger |

## Building a standalone binary

```bash
bun build src/cli/index.ts --compile --outfile openschema
```

This produces a single executable with no runtime dependency on Bun or Node —
convenient to vendor into a CI image.
