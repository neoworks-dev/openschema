# Compatibility Checking

Once other teams depend on your schema, every change risks breaking them.
OpenSchema compares two versions of a schema, classifies every change, and tells
you whether the new version is compatible with the old one — so you can gate
schema changes in CI.

Two commands:

- `diff` — show every change between two schemas.
- `check` — assert compatibility under a mode; exit non-zero if violated.

## A first diff

Given `order.v1.schema`:

```openschema
model Order {
  1 id: uuid
  2 customerName: string
  3 total: i32
}
```

and `order.v2.schema`:

```openschema
model Order {
  1 id: uuid
  2 customer: string     // renamed (ordinal 2 unchanged)
  3 total: i64           // widened i32 -> i64
  4 note: string?        // new nullable field
}
```

```bash
openschema diff order.v1.schema order.v2.schema
```

```
Diff: order.v1.schema → order.v2.schema

  Warnings
  ⚠ [R005] Order.customer  warning

  Safe
  ✓ [R006] Order.total  safe
  ✓ [R001] Order.note  safe

  Summary: 1 warnings, 2 safe
```

Notice the rename was detected as a **rename** (`R005`), not as "removed
`customerName`, added `customer`." That is the payoff of
[ordinals](./language-reference.md#ordinals-field-numbers): field 2 is the same
field, just relabeled.

## Severities

Every change is classified by who it can break. "Reader" and "writer" are from
the perspective of application code, not schema versions:

| Severity | Meaning |
|----------|---------|
| `safe` | No impact on any existing code or data. |
| `warning` | Technically safe, but worth a human's eyes (e.g. a rename). |
| `breaking_reader` | Code that **reads** this data may break (a field it expects is gone). |
| `breaking_writer` | Code that **writes** this data may break (a new requirement it can't meet). |
| `breaking_both` | Breaks readers and writers. |

## Compatibility modes

`check` enforces one of four modes:

| Mode | Question it answers | Violated by |
|------|---------------------|-------------|
| `backward` | Can the **new** schema read data written by the **old** one? | `breaking_reader`, `breaking_both` |
| `forward` | Can the **old** schema read data written by the **new** one? | `breaking_writer`, `breaking_both` |
| `full` | Both of the above. | any `breaking_*` |
| `none` | No enforcement. | nothing |

Backward compatibility is the most common requirement: you deploy a new schema
and it must still understand the data already in the database.

```bash
openschema check order.v1.schema order.v2.schema --mode backward
```

```
✓ Compatible under backward mode  (3 changes, none breaking)
```

Exit code `0`. If a change had violated the mode, `check` prints the violations
with explanations and exits `1` — ready to fail a CI job.

```bash
# In CI:
openschema check schema.published.schema schema.proposed.schema --mode backward || exit 1
```

## What `diff` and `check` cannot see

Both commands compare exactly two versions. That is enough for most rules, but two
classes of breakage are invisible to a pairwise comparison:

- **Ordinal reuse.** If v6 removes field 3 and v7 adds a different field 3, the
  v6 → v7 diff never sees that ordinal 3 was ever used — v6 does not mention it.
- **Encoding changes the type system calls safe.** `[T]` → `[T]?` is reported as
  `R009`/safe, but for the [binary codec](./wire-format.md) it moves the field from
  *repeated at tag N* to a *LEN wrapper at tag N*, and every existing row misparses.

Both are caught by the [ordinal ledger](./ordinal-ledger.md) (`OS2007`, `OS2010`),
which keeps cumulative history rather than comparing two versions. Run
`openschema lock --check` alongside `openschema check` in CI; they cover different
failures.

## The rules

Each change kind has a stable rule ID, so you can reference it (and suppress it).

### Models and fields

| Rule | Change | Severity |
|------|--------|----------|
| `R001` | nullable field added | safe |
| `R002` | required field added **with `@default`** | safe |
| `R004` | field removed | breaking_reader |
| `R005` | field renamed (same ordinal) | warning |
| `R006` | field type widened (e.g. `i32`→`i64`) | safe |
| `R007` | field type narrowed | breaking_writer |
| `R008` | field type changed incompatibly | breaking_both |
| `R009` | field made nullable | safe |
| `R010` | required field added (no default) | breaking_writer |
| `R011` | field made non-nullable | breaking_writer |
| `R012` | `@unique` added | breaking_writer |
| `R013` | `@check` added | breaking_writer |
| `R014` | `@unique`/`@check` removed | safe |
| `R015` | `@primaryKey` added or removed | breaking_both |
| `R016` | model added | safe |
| `R017` | model removed | breaking_both |
| `R018` | `@references` target changed | breaking_both |
| `R019` | field marked `@deprecated` | warning |
| `R020` | model renamed (via `@renamed`) | warning |

### Enums

| Rule | Change | Severity |
|------|--------|----------|
| `E001` | variant added | warning |
| `E002` | variant removed | breaking_reader |
| `E003` | variant renamed (same ordinal) | warning |
| `E004` | variant ordinal changed (renumbered) | breaking_both |
| `E005` | enum added | safe |
| `E006` | enum removed | breaking_both |
| `E007` | enum renamed (via `@renamed`) | warning |

`E004` is the dangerous one: renumbering a variant silently reinterprets every
piece of data that used the old number. Keep variant ordinals stable, like field
ordinals. A *duplicate* variant ordinal within one version is rejected outright by
the resolver (`OS2003`), as is a duplicate `oneof` variant ordinal (`OS2004`).

### Type aliases

| Rule | Change | Severity |
|------|--------|----------|
| `T001` | alias target changed | mirrors the underlying type change |
| `T002` | alias added | safe |
| `T003` | alias removed | breaking_both |
| `T004` | alias renamed (via `@renamed`) | warning |

## Renaming a model, enum, or alias

Fields and enum variants are matched by ordinal, so renaming one is already a
warning — the ordinal preserves identity. Declarations have no ordinal; they are
matched by name, so renaming a model normally looks like a breaking remove + add.

Carry the old name forward with `@renamed("OldName")` and the differ matches the
new declaration to the removed one, reporting a rename (`R020`/`E007`/`T004`,
warning) instead. Fields are still diffed under the new name.

```openschema
// was: model Order { ... }
@renamed("Order")
model PurchaseOrder {
  1 id: uuid
  2 total: i32
}
```

Drop the decorator once every consumer has migrated past the rename. If a
declaration with the old name still exists, the `@renamed` is ignored and the
new declaration counts as a normal addition.

## Suppressing a rule

Sometimes a flagged change is intentional and you want to silence it for a
specific element. Use a `#suppress` directive naming the rule and a reason:

```openschema
model User {
  // Renaming this is intentional; we've migrated all consumers.
  #suppress "R005" "renamed fullName -> name in v3, consumers migrated"
  1 name: string
}
```

A `#suppress` on a field suppresses matching changes for that field; on a
model or enum, for that declaration. The reason string is required — it
documents *why* the rule was waived, for the next person who reads the diff.

## How it fits your workflow

1. Keep the last published schema in version control.
2. On every pull request that touches the schema, run
   `openschema check <published> <proposed> --mode backward` in CI.
3. A red check means a breaking change — either rework it, bump a major version,
   or `#suppress` the specific rule with a justification.

This turns "did we break a downstream consumer?" from a question you answer in
production into one CI answers before merge.
