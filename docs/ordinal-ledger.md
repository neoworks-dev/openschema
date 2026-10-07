# Ordinal ledger

A generated, git-committed lockfile recording every field ordinal a schema has ever
used, so a retired wire tag can never be reclaimed.

You do not maintain it. Generating maintains it for you:

```sh
openschema schema.schema -t codec -o ./generated   # writes openschema.lock alongside
```

Commit the lockfile. There is a `lock` command for CI and for locking without
generating, but day to day you never type it.

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

## Who may write the lockfile

Recording a new ordinal and retiring a removed one are mechanical edits with exactly
one correct answer, so the compiler makes them itself. Making a human run a second
command to apply them buys no safety — it only trains people to reach for `--no-lock`
when the build stops for a bookkeeping reason.

What auto-maintenance never does is **launder a violation**. Reusing a spent ordinal
(`OS2007`) and changing a live ordinal's encoding (`OS2010`) still abort the run, and
the lockfile is written only after every emitter has succeeded — so a failed build
never leaves a ledger recording ordinals that produced no output.

Two situations stay strictly read-only, because there the auto-repair *is* the disarm:

- **CI** (detected via the `CI` environment variable) or `--frozen`. A deleted
  lockfile would otherwise be quietly rebuilt into an empty baseline and the build
  would go green on exactly the failure the ledger exists to catch.
- **`#requireLedger`**, below. A missing lockfile is an error, never a fresh baseline.

| State | Local | CI / `--frozen` |
|---|---|---|
| current | proceeds silently | proceeds silently |
| out of date | updated, one dim line | `OS2008`, exit 1 |
| missing | created, with a "commit it" notice | `OS2011`, exit 1 |
| missing under `#requireLedger` | `OS2011`, exit 1 | `OS2011`, exit 1 |
| ordinal reuse | `OS2007`, exit 1 | `OS2007`, exit 1 |
| encoding change | `OS2010`, exit 1 | `OS2010`, exit 1 |

`--write-lock` forces a write even when `CI` is set, for a bot that commits the
result back. `--no-lock` skips the ledger entirely — explicitly, and greppably.

## `#requireLedger`

`--frozen` lives in CI configuration, and whoever deletes a lockfile can delete the
flag too. A directive on the namespace travels with the schema instead, so disarming
it is a visible diff in the file under review:

```openschema
#requireLedger
namespace shop
```

With it present, a missing ledger is an error rather than a new baseline — locally as
well as in CI. An existing ledger is still updated for you.

## Spaces not seen in a run are left alone

Only ordinal spaces observed in the current run may have ordinals retired. A space
absent from the run is copied through untouched.

This matters whenever one lockfile serves several entry files. Without the rule,
generating from entry A would retire every live field belonging to entry B, and B's
next run would report `OS2007` on all of them.

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
| `OS2013` | a field moved to another `@neoworks.facet`, or its facet was renamed |

A field entry also records its `@neoworks.facet` as `facet` (absent for the default
facet). Existing encrypted data stays in the facet it was written in, so the facet
of a live ordinal can never change. See
[Descriptor target and Neoworks nodes](./descriptor.md#facets-are-permanent).

## Relationship to `reserved`

A [`reserved`](./language-reference.md#reserved-ordinals) declaration in source is
absorbed into the ledger as `state: "reserved"` on the next run. Once absorbed the
ordinal stays spent even if the source line is later deleted, so the ledger — not the
source — is the durable record.
