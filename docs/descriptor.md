# Descriptor target and Neoworks nodes

```sh
openschema calendar.schema --target descriptor --out ./generated
```

Writes `schema.descriptor.json`: the schema as data, for runtimes that encode,
decode and validate the [codec wire format](./wire-format.md) without generated
code. Field layouts come from the same plan the `codec` target generates from, so
a descriptor-driven runtime and the generated TypeScript codec agree byte for byte.
The descriptor rejects every construct the codec rejects.

## Shape

```jsonc
{
  "descriptorVersion": 1,
  "namespace": "neoworks.calendar",
  "enums":  [{ "name": "Status", "variants": [{ "name": "confirmed", "ordinal": 1 }] }],
  "models": [{
    "name": "Event",
    "fields": [{
      "ordinal": 1,
      "name": "title",
      "container": { "kind": "singular", "nullable": false },
      "value": { "kind": "scalar", "scalar": "string" },
      "required": true,
      "constraints": { "maxLength": 200 }
    }]
  }],
  "nodes": [{
    "kind": "item",
    "model": "Event",
    "facets": [
      { "name": "default", "tag": 1, "fields": [1, 2] },
      { "name": "Availability", "tag": 488337835, "fields": [3, 4] }
    ],
    "searchable": [1],
    "title": null,
    "timeRange": { "start": 3, "end": 4 }
  }]
}
```

`container` and `value` are the wire layout described in
[Wire Format](./wire-format.md). Named types refer to models and enums by local
name. Everything inside `nodes` refers to fields by ordinal, so renaming a field
never changes what a facet or index points at.

## Constraints

The [validation decorators](./decorators.md#validation-decorators) become
`constraints`, which a runtime must enforce on encode and decode. They apply to
each value: every element of a list and every value of a map.

| Decorator | Applies to | Check |
|---|---|---|
| `@minValue(n)` `@maxValue(n)` | integer and float scalars | inclusive bound |
| `@minLength(n)` `@maxLength(n)` | `string` (code points), `bytes` (bytes) | inclusive bound |
| `@pattern(re)` | `string` | ECMAScript regular expression, matched against the whole value |
| `@format(name)` | `string` | named format; the runtime decides which names it knows |

A validation decorator on a type it cannot apply to is an error (`OSD009`), not
ignored.

## Neoworks node decorators

Neoworks stores user data as end-to-end encrypted nodes in a tree of roots,
containers and items. A schema published as a collection says which model each
container and item stores and how that model is encrypted. Roots carry no content;
a collection's name is the registry title from its manifest.

| Decorator | On | Meaning |
|---|---|---|
| `@neoworks.node("container" \| "item")` | model | The model is the content of every node of this kind. At most one model per kind. |
| `@neoworks.facet("Name")` | field of a node model | The field is encrypted in the named facet. |
| `@neoworks.searchable` | `string` or `[string]` field of a node model | The client indexes the field for search. |
| `@neoworks.timeRange(start: "a", end: "b")` | node model | The client indexes nodes by the interval between two `timestamp` fields in the same facet. |
| `@neoworks.title` | one single `string` field of a node model | The node's display name, e.g. a calendar's name on the consent screen. |

```openschema
namespace neoworks.calendar

@neoworks.node("item")
@neoworks.timeRange(start: "start", end: "end")
model Event {
  @neoworks.searchable
  1 title: string
  2 notes: string?

  @neoworks.facet("Availability") 3 start: timestamp
  @neoworks.facet("Availability") 4 end: timestamp
}
```

### Facets

A node's content is one message of the node model, split by facet. Each facet's
fields are encoded as their own message and encrypted under a key for that facet,
so access to a node can be granted for some facets only. Above, sharing
`Availability` reveals when an event is but not its title.

- Fields without `@neoworks.facet` belong to the `default` facet, tag 1.
- A named facet's tag is derived from its name: `2 + (first four bytes of
  sha256("neoworks.facet:" + name), big-endian) mod 536870909`. Two facets of one
  model that derive the same tag are an error (`OSD006`); rename one.
- Facet names are letters and digits, starting with a letter, and cannot be
  `default` in any case (`OSD005`).

### Facets are permanent

Existing nodes keep a field encrypted under the facet it was written in. The
[ordinal ledger](./ordinal-ledger.md) therefore records each field's facet and
refuses to move a field to another facet — including by renaming the facet — as
`OS2013`. Renaming the field itself is still fine.

## Errors

| Code | Meaning |
|---|---|
| `OSD001` | unknown `@neoworks` decorator |
| `OSD002` | `@neoworks.node` without exactly one valid node kind |
| `OSD003` | two models declare the same node kind |
| `OSD004` | `@neoworks.facet`, `@neoworks.searchable`, `@neoworks.timeRange` or `@neoworks.title` on a model that is not a node |
| `OSD005` | invalid or repeated facet name |
| `OSD006` | two facets of one model derive the same tag |
| `OSD007` | `@neoworks.searchable` on a field that is not `string` or `[string]` |
| `OSD008` | invalid `@neoworks.timeRange` |
| `OSD009` | invalid validation decorator |
| `OSD010` | `@neoworks.title` not on exactly one single `string` field |
