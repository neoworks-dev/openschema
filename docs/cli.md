# CLI Reference

```
openschema <schema> [options]        # generate — the default command
openschema <command> [options]
```

Run with the built binary (`./openschema`) or via Bun
(`bun run src/cli/index.ts`). Global flags:

| Flag | Meaning |
|------|---------|
| `-v`, `--version` | print the version |
| `-h`, `--help` | print help (also works per command) |

## `<schema>` — generate (default)

Generate code for a target. Follows `import`s from the entry file automatically.
See [Code Generation](./code-generation.md).

Generating is what the tool is for, so it needs no verb. `openschema generate` and
the older `openschema gen` are aliases for the same command.

| Flag | Meaning | Default |
|------|---------|---------|
| `-t`, `--target <targets>` | one or more targets, comma-separated (required) | — |
| `-o`, `--out <dir>` | output directory (created if missing) | `.` |
| `--company <id>` | include this company's [overlay](./overlays.md) fields | none |
| `--include-private` | include the schema's own `private` fields | off |
| `--lock <path>` | ordinal lockfile | `<schema dir>/openschema.lock` |
| `--frozen` | never write the ordinal ledger; fail if it is missing or stale | off |
| `--write-lock` | write the ordinal ledger even when `CI` is set | off |
| `--no-lock` | skip the ordinal ledger entirely | off |

Targets: `sql`, `ts`, `zod`, `go`, `json-schema`, `graphql`, `openapi`,
`surrealdb`, `neoworks-ddl`, `internal`, `codec`.

```bash
openschema order.schema -t sql -o ./generated
openschema order.schema -t ts  -o ./src/types
openschema order.schema -t codec,sql -o ./generated          # several at once
openschema acme-overlay.schema -t sql -o ./acme --company acme
openschema order.schema -t graphql --include-private -o ./internal-api
```

On a semantic error (an undefined type, a duplicate ordinal, an unresolved
import), the diagnostics are printed with their codes and nothing is written.

The [ordinal lockfile](./ordinal-ledger.md) beside the schema is created and kept
up to date for you. In CI (detected via the `CI` environment variable) it is
treated as read-only, so a stale or missing lockfile fails the build instead of
being silently rebuilt.

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

## `lock <schema>`

Reconcile the [ordinal ledger](./ordinal-ledger.md) without generating anything.
Generating already maintains the lockfile, so this command exists for CI and for
the occasional case where you want the ledger updated without output.

| Flag | Meaning | Default |
|------|---------|---------|
| `--lock <path>` | lockfile path | `<schema dir>/openschema.lock` |
| `--check` | do not write; exit `1` if missing or out of date | off |
| `--base <path>` | assert the result still contains everything this lockfile records | none |
| `--json` | machine-readable output | off |

```bash
openschema lock order.schema --check   # CI gate
openschema lock order.schema           # update without generating
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
