# Ordinal ledger

A generated, git-committed lockfile recording every field ordinal a schema has ever
used, so a retired wire tag can never be reclaimed.

```sh
openschema lock schema.schema          # create or update
openschema lock schema.schema --check  # CI: fail if missing or out of date
```

## Why the compiler has to enforce this

Ordinals are the wire identity of a field. Reuse one and previously encoded data
decodes into the wrong field — often to a plausible wrong value rather than an error.

Normally you would catch that by looking at production rows. When the payloads are
end-to-end encrypted, nobody can. There is no scan, no repair, and no backup that
helps, because the backups are ciphertext too. The compiler is the only place the
mistake can be caught.

The compatibility checker cannot do it either. `openschema diff` and
`openschema check` compare two versions pairwise:

```
v5   3 phoneNumber: string
v6   (removed)                 -> R004, correctly reported
v7   3 isFavorite: bool        -> compared against v6, which no longer mentions 3
```

The v6 → v7 diff has no way to know ordinal 3 was ever used. The ledger is the
durable memory that closes that gap.

## Ordinal spaces

Four independent tag spaces, keyed as:

| Key | Space |
|---|---|
| `model:<qualifiedName>` | a record's own fields |
| `overlay:<base>@<company>` | one company's overlay — its own space, starting at 1 |
| `enum:<qualifiedName>` | enum variant values |
| `oneof:<model>:<fieldOrdinal>` | a oneof's inner tags |

A oneof space is keyed by the declaring field's **ordinal**, not its name, so
renaming the field does not churn the ledger.

A record inherits its base chain's spent ordinals, because the flattened record is
what gets encoded — a base's retired tag must not be reclaimed by a derived record.

## The lockfile

```jsonc
{
  "lockfileVersion": 1,
  "generator": "openschema 0.1.0",
  "baseline": false,
  "digest": "sha256-…",
  "spaces": {
    "model:shop.Order": {
      "kind": "model",
      "ordinals": {
        "1": { "state": "active",   "name": "id",     "type": "uuid",    "encoding": "singular:len",   "since": "…" },
        "7": { "state": "retired",  "name": "legacy", "type": "string?", "encoding": "singular:len",   "since": "…", "retiredAt": "…" },
        "9": { "state": "reserved", "name": null,     "type": null,      "encoding": null,             "since": "…" }
      }
    }
  }
}
```

`retired` and `reserved` are both spent; only `active` may be encoded.

Entries are keyed by ordinal and serialized in numeric order, so a git diff is one
line per ordinal and merge conflicts localise to the ordinals two branches actually
touched.

### The encoding signature

`encoding` records how the field is laid out, more finely than the four wire types:

```
singular:varint | singular:i64 | singular:len
repeated:packed | repeated:len-element
wrapper:repeated | wrapper:map
map:entry
```

This exists for one case in particular. Changing `[T]` to `[T]?` keeps the wire type
LEN, and the compatibility checker calls it a **safe widening** — but it moves the
field from *repeated at tag N* to a *LEN wrapper at tag N*, and every existing row
misparses. The ledger reports it as `OS2010`. Nothing else catches it.

### The digest

`digest` is sha256 over the canonical form of `spaces`, verified on load. It catches
**accidental** corruption: a botched merge-conflict resolution, an editor mangling
the file.

It is **not** a security control. Anyone can run `openschema lock` and get a fresh
digest. Real append-only enforcement is `--base` against the git merge base:

```sh
git show origin/main:schema/openschema.lock > /tmp/base.lock || true
openschema lock schema/orders.schema --check --base /tmp/base.lock
```

## `gen` never writes the lockfile

Only `openschema lock` writes. `gen` reads and validates.

This is deliberate. `gen` is what runs in CI, so if a deleted lockfile made `gen`
regenerate it, CI would pass on exactly the failure the ledger exists to catch — the
self-healing would be the disarm. A warning would not help either; it would scroll
past among the generated-file lines.

| State | `gen` |
|---|---|
| current | proceeds silently |
| out of date | `OS2008`, exit 1 |
| ordinal reuse | `OS2007`, exit 1 |
| missing | `OS2011` warning, proceeds — unless required |
| `--frozen` | missing or stale is an error |
| `--no-lock` | skips validation, explicitly and greppably |

## `#requireLedger`

`--frozen` lives in CI configuration, and whoever deletes a lockfile can delete the
flag too. A directive on the namespace travels with the schema instead, so disarming
it is a visible diff in the file under review:

```openschema
#requireLedger
namespace shop
```

With it present, a missing or out-of-date ledger is an error for every command.

## Spaces not seen in a run are left alone

Only ordinal spaces observed in the current run may have ordinals retired. A space
absent from the run is copied through untouched.

This matters whenever one lockfile serves several entry files. Without the rule,
running `lock` on entry A would retire every live field belonging to entry B, and
B's next run would report `OS2007` on all of them.

A corollary: absence from the schema is never itself an error. Deleting a whole
model leaves its ordinals permanently spent.

## Diagnostics

| Code | Meaning |
|---|---|
| `OS2003` | duplicate enum variant ordinal |
| `OS2004` | duplicate `oneof` variant ordinal |
| `OS2005` | an ordinal is declared but also `reserved` |
| `OS2007` | an ordinal is retired or reserved and cannot be reused |
| `OS2008` | the ledger is out of date |
| `OS2009` | ledger integrity: digest mismatch, or `--base` superset violated |
| `OS2010` | the encoding signature changed at a live ordinal |
| `OS2011` | no ledger found |
| `OS2012` | a malformed `reserved` declaration |

## Relationship to `reserved`

A [`reserved`](./language-reference.md#reserved-ordinals) declaration in source is
absorbed into the ledger as `state: "reserved"` the next time `lock` runs. Once
absorbed the ordinal stays spent even if the source line is later deleted, so the
ledger — not the source — is the durable record.
