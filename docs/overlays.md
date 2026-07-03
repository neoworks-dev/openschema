# Overlays: sharing a schema across companies

Overlays are OpenSchema's answer to a specific, hard problem:

> Several companies want to use the **same** core schema, but each needs to add
> a few private fields of its own — and they must be able to do this without
> coordinating with each other or with the team that owns the shared schema.

This guide explains the problem, the mechanism, and how it generates code.

## The problem with the obvious approaches

Suppose `Person` is a shared model:

```openschema
namespace myorg
model Person {
  1 name:  string
  2 email: string?
}
```

ACME wants to add a `loyaltyTier`; Globex wants to add a `riskScore`. The naive
options all fail:

- **Edit the shared file.** Now the shared schema is polluted with every
  company's private fields, and ACME can see Globex's.
- **Fork the schema.** The whole point was to *share* it; forks drift.
- **Just append fields with new ordinals.** ACME adds field `3`, Globex also
  adds field `3` — collision. Or ACME uses `3` and Globex uses `4`, but now
  they must coordinate ordinals forever, and adding a field to the *shared*
  schema (say a new field `3`) silently clashes with ACME's private `3`.

The root issue is that all these approaches share **one ordinal space**.

## The overlay mechanism

An overlay is a company-scoped set of private fields layered onto a base model.
Crucially, it has its **own independent ordinal space** that starts at 1:

```openschema
// acme-overlay.schema
namespace myorg.acme

import { Person } from "./people"

overlay acme on Person {
  1 loyaltyTier:      string
  2 accountManagerId: u32
}
```

```openschema
// globex-overlay.schema
namespace myorg.globex

import { Person } from "./people"

overlay globex on Person {
  1 riskScore: f32
}
```

Field identity in an overlay is the pair **(company, ordinal)**. ACME's `1` and
Globex's `1` are different fields because the company differs. Therefore:

- Two companies can both start at ordinal `1` and never collide.
- The shared-schema team can add fields `3`, `4`, ... to `Person` forever
  without ever threatening any company's overlay, because overlay ordinals live
  in a separate space.
- A company controls its own overlay's ordinals, so the only collisions possible
  are within one company's own overlay — which the compiler checks.

## Rules the compiler enforces

When resolving overlays, the compiler reports:

| Code | Meaning |
|------|---------|
| `OS3001` | The overlay's base model does not exist. |
| `OS3002` | The named base is not a model (e.g. it's an enum). |
| `OS3003` | An overlay field name collides with a field already on the base model. |
| `OS2002` | Two fields in the same overlay reuse an ordinal. |
| `OS3004` | Two overlays define the same company on the same base model. |

Note `OS3003`: overlays add *new* names. They cannot shadow or redefine a base
field — an overlay is strictly additive.

## Inline `private` vs. overlays

There are two ways to keep fields out of public artifacts, for two different
owners:

- **`private` fields** belong to the **schema owner**. They live in the base
  model, in its ordinal space. Use them for the owning team's internal fields.

  ```openschema
  model Person {
    1 name: string
    100 private fraudScore: f32?   // the owning team's internal field
  }
  ```

- **Overlays** belong to a **different company** consuming the shared schema.
  They live in their own ordinal space and are selected by `--company`.

Both can coexist on the same model.

## Generating a company's view

Generate the base schema plus one company's overlay with `--company`:

```bash
openschema gen acme-overlay.schema --target sql --out ./out --company acme
```

The overlay fields are added to the base model's table, **namespaced by
company** so they cannot collide with base columns or another company's columns:

```sql
CREATE TABLE orders (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(id),
  status TEXT NOT NULL,
  -- ... base columns ...
  acme_loyalty_tier TEXT NOT NULL,
  acme_account_manager_id BIGINT NOT NULL
);
```

Without `--company`, you get just the shared schema — the public view that every
company shares. With `--company acme` you get ACME's view; with
`--company globex`, Globex's. The two never see each other's fields.

Overlays work across every target. In TypeScript the overlay fields join the
interface; in GraphQL they join the type; in all cases only the selected
company's fields appear.

## A complete example

The repository's `examples/ecommerce/` directory is a working multi-file,
multi-company project:

- `common.schema` — shared value types (`Money`, `PostalAddress`, `Region`).
- `orders.schema` — the `Order` aggregate and its API, importing `common`.
- `acme-overlay.schema` — ACME's private overlay, importing `orders`.

Generate the shared view and ACME's view and compare:

```bash
openschema gen examples/ecommerce/orders.schema       --target sql --out ./shared
openschema gen examples/ecommerce/acme-overlay.schema --target sql --out ./acme --company acme
```

The overlay file imports `Order` (which itself imports `common`), so the whole
graph resolves, and ACME's `acme_*` columns appear on the shared `orders` table.
