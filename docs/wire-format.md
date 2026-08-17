# Wire format

The normative specification for the `codec` target — a canonical, byte-deterministic
binary encoding in the style of Protocol Buffers.

This format is designed for data the server cannot read. Under end-to-end encryption
nobody can scan production rows to detect a corrupt encoding, and no backup can be
repaired, so every rule here exists to make a mistake a compile-time error rather than
a silent one.

```sh
openschema schema.schema --target codec --out ./generated
```

Generates a single self-contained `schema.codec.ts` with no imports.

## Framing

Each field is a key followed by a body. The key is an unsigned varint:

```
key = ordinal * 8 + wireType
```

Computed by multiplication, never `ordinal << 3` — the shift overflows int32 above
2²⁸ and would corrupt high tags.

| Wire type | Value | Body |
|---|---|---|
| VARINT | 0 | base-128 varint, at most 10 bytes |
| I64 | 1 | 8 bytes little-endian |
| LEN | 2 | varint length, then that many bytes |
| SGROUP / EGROUP | 3 / 4 | never emitted; rejected on decode |
| I32 | 5 | 4 bytes little-endian; decode-only |

Ordinals must satisfy `1 ≤ ordinal ≤ 536870911`.

Ordinal `536870911` is reserved for a future per-company overlay envelope and must
not be used by a schema.

## Types

| OpenSchema | Wire | TypeScript | Notes |
|---|---|---|---|
| `bool` | VARINT | `boolean` | 0 or 1 |
| `i8` `i16` `i32` | VARINT | `number` | two's complement, sign-extended to 64 bits |
| `i64` | VARINT | `bigint` | **not** `number` |
| `u8` `u16` `u32` | VARINT | `number` | negative values rejected on encode |
| `u64` | VARINT | `bigint` | |
| `f32` `f64` | I64 | `number` | IEEE-754 double; decode also accepts I32 |
| `string` | LEN | `string` | UTF-8 |
| `bytes` | LEN | `Uint8Array` | |
| `uuid` | LEN | `string` | 16 raw bytes; decoded lowercase and hyphenated |
| `json` | LEN | `unknown` | UTF-8 of the canonicalized JSON |
| `decimal(p,s)` | LEN | `string` | canonical decimal string |
| `date` | VARINT | `YYYY-MM-DD` | int32 days since 1970-01-01 UTC |
| `time` | VARINT | `HH:MM:SS[.fffffffff]` | int64 nanoseconds since midnight |
| `timestamp` | VARINT | ISO-8601 UTC | int64 milliseconds since the epoch |
| `duration` | VARINT | `bigint` | int64 nanoseconds, signed |
| enum | VARINT | numeric enum | the variant's ordinal |
| model | LEN | `interface` | nested message |
| `oneof` | LEN | discriminated union | nested message; variant ordinal is the inner tag |
| `[T]` packable | LEN | `T[]` | packed; decode accepts packed and unpacked |
| `[T]` LEN element | repeated LEN | `T[]` | one key per element |
| `[T]?` | LEN | `T[] \| null` | wrapper message `{1: repeated T}` |
| `{K: V}` | repeated LEN | `Map<K, V>` | entry message `{1: key, 2: value}` |
| `{K: V}?` | LEN | `Map<K, V> \| null` | wrapper message `{1: repeated entry}` |

A type is *packable* when it encodes as VARINT or I64 — every scalar except
`string`, `bytes`, `uuid`, `json`, and `decimal`, plus enums.

Map keys must be `string`, `uuid`, `bool`, or an integer scalar.

`Map` rather than `Record` preserves `bigint` keys, avoids V8's reordering of
integer-like object keys, and keeps `__proto__` from being an attacker-controlled key.

### Why integers never use zigzag

`NUMERIC_WIDENS` in the compatibility checker treats `i8 → i64`, `u32 → i64`,
`u8 → i16` and friends as safe. Plain two's-complement varint makes every one of
those a byte-level no-op, so widening a field changes nothing on the wire. Zigzag
(`sint32`/`sint64`) would silently corrupt them.

The cost is that every negative integer occupies the full 10-byte sign-extended
form, whatever its declared width.

### Why f32 and f64 share one encoding

Dispatching on the wire type present cannot disambiguate a packed repeated float:
an 8-byte packed body is both two `f32` values and one `f64`, with nothing in the
encoding to tell them apart. Encoding both as I64 doubles keeps `f32 → f64` a no-op
for singular *and* repeated fields, at a cost of 4 bytes per `f32`.

`f32` therefore declares intent and range, which the `zod` target enforces; it is
not a wire distinction.

### Canonical decimal

Optional leading `-`; no leading zeros beyond a single `0`; exactly `scale`
fraction digits when `scale > 0`; no `+`, no exponent; `-0` normalizes to `0`.
A value with more fraction digits than the declared scale is rejected.

```
1.5      decimal(12,2)  ->  "1.50"
007.10   decimal(12,2)  ->  "7.10"
-0.00    decimal(12,2)  ->  "0.00"
1.234    decimal(12,2)  ->  rejected
```

## Canonical encoding

Identical data always produces identical bytes, so a hash of the payload can stand
in for the payload — an unchanged row is recognisable without being decrypted.

1. Known fields are emitted strictly ascending by ordinal.
2. Absent fields are not emitted. Present fields always are, including `0`, `""`,
   and `false`.
3. Repeated packable fields are packed into one LEN field. An empty repeated field
   emits nothing.
4. Map entries are sorted by their **encoded key bytes**, not by JavaScript string
   comparison — UTF-16 code-unit order disagrees with UTF-8 byte order across the
   surrogate boundary, which emoji reach.
5. Unknown fields are merged into the ascending tag stream, never appended.
6. No duplicate tags. Encoding throws if an unknown field carries a tag the message
   declares.
7. Varints are minimal-length, except negative signed values, which are always the
   10-byte sign-extended form.
8. `json` values are canonicalized by recursively sorting object keys before
   serialization.

Consequence worth planning for: the first re-encode of a row that was written
non-canonically changes its hash once, then stays stable.

## Unknown fields

A decoder retains every field the schema does not declare:

```ts
interface UnknownField {
  tag: number;
  wire: number;
  raw: Uint8Array;   // key varint plus body
}
```

Stored on each decoded value as `$unknown`, present only when non-empty, and
re-emitted verbatim on encode. `raw` holds the key as well as the body so
re-emission is a byte copy that cannot be re-encoded wrongly.

**This is not optional.** Without it, a device on an older app version that reads a
row, edits one field, and writes it back destroys every field added since — with no
server-side way to notice.

For the same reason:

- an **enum** value the schema does not know is preserved as its raw number, never
  rejected;
- a **oneof** variant the schema does not know decodes to the `$unknown` arm and
  round-trips intact.

A schema may not declare a field named `$unknown`.

### Retired tags

Each message also carries a retired-tag set:

```ts
const RETIRED_Contact: ReadonlySet<number> = new Set([]);
```

Tags in it are dropped on decode rather than preserved. The distinction matters:
a *retired* tag is known-dead, while an *unknown* tag may come from a newer client
and must survive. Without it, every field ever deleted would be carried forever on
every device.

The set is empty today; the [ordinal ledger](./ordinal-ledger.md) is what will fill it.

## Constructs the codec rejects

| Code | Construct |
|---|---|
| `OSC001` | untagged union `A \| B` — no discriminant on the wire; use `oneof` |
| `OSC002` | `[T?]` — null is unrepresentable in a repeated position |
| `OSC003` | a map key that is not `string`, `uuid`, `bool`, or an integer |
| `OSC004` | an ordinal outside `1..536870911` |
| `OSC005` | `--company` — overlay ordinals share the base record's tag space |
| `OSC006` | a field named `$unknown` |
| `OSC007` | an unresolvable named reference or unsubstituted type parameter |
| `OSC008` | the same local name declared in two namespaces |

Rejection is at the use site: a union alias no encoded model references does not
fail the build. Generic models are skipped, matching the `zod` target.

## Compatibility

Safe without a migration:

- adding a field at a fresh ordinal (nullable, or repeated)
- renaming a field, keeping its ordinal
- widening an integer, or `f32 → f64`
- `T → T?` for a **singular** field
- adding an enum or oneof variant at a fresh ordinal

Never safe:

- reusing an ordinal — see the [ordinal ledger](./ordinal-ledger.md)
- changing a field's encoding at a live ordinal, including **`[T] → [T]?`**,
  which the compatibility checker classifies as a safe widening but which moves the
  field from *repeated at tag N* to a *LEN wrapper at tag N*
- `T? → T`, which fails loudly on decode of a row whose value was null
- adding a required field, which makes every existing row fail to decode

Run `openschema check --mode backward` in CI for the cases the differ can see, and
`openschema lock --check` for the ones only the ledger can.

## Limits

- Message nesting is capped at 100 levels, against hostile buffers.
- `bigint` literals require the consuming project to target ES2020 or later.
- The generated file is not typechecked by this package's build. Run
  `tsc --noEmit` over the output in CI.
