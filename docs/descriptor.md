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
| `@format(name)` | `string` | named format; the runtime decides which names it knows ([libneoworks](#formats-libneoworks-checks)) |

A validation decorator on a type it cannot apply to is an error (`OSD009`), not
ignored.

### Formats libneoworks checks

`date-time`, `date`, `time` (RFC 3339), `uuid`, `email`, `uri` and `url`
(a scheme, a colon, no spaces), `e164`, `hex-color` (`#rgb` or
`#rrggbb`), `slug`, `iso4217`, `iso3166-1-alpha2`, `iso3166-1-alpha3`, `ipv4`
and `hostname`. A format it does not know passes, so a newer schema never
blocks an older client. `@pattern` uses ECMAScript syntax without the `u` flag
(no `\p{…}` classes).

## JSON mapping

A descriptor-driven runtime takes and returns a model as a JSON object keyed by
field name. Each value maps as follows:

| Type | JSON |
|---|---|
| `bool` | boolean |
| `i8`…`i32`, `u8`…`u32` | number, an integer in range |
| `i64`, `u64`, `duration` | decimal string, e.g. `"-42"`, so no precision is lost |
| `f32`, `f64` | finite number |
| `decimal(p, s)` | decimal string with at most `s` fraction digits and `p` digits |
| `string` | string |
| `bytes` | base64url without padding |
| `uuid` | lowercase hyphenated uuid string |
| `date` | `YYYY-MM-DD` |
| `time` | RFC 3339 partial time, e.g. `08:30:00` |
| `timestamp` | RFC 3339 with any offset on input; written as UTC with milliseconds, e.g. `2026-10-05T08:00:00.000Z` |
| `json` | any JSON value; stored as canonical JSON text |
| enum | variant name; an unknown variant read from newer data is its ordinal number, and is written back unchanged |
| model | object |
| `File` | object `{objectId, name, mediaType, size, variants}`, `size` a decimal string, `variants` an object of `{objectId, size}` by variant name |
| oneof | object with exactly one key, the variant name |
| `[T]` | array |
| `{K: V}` | object; non-string keys are written as their JSON text, e.g. `"42"` |

An optional field that is absent is left out of the object. On update, a field
that is given replaces the stored value, `null` clears it and a field that is
not given keeps its value. For a required field of type `json`, `null` is the
JSON value null, not absence. Fields and facets this runtime's schema does not
know are kept as they are, so an older client never drops data a newer one
wrote. A rejected value is reported with its path and the reason, e.g.
`Event.attendees[2].email` / `is not a valid email`.

## Neoworks node decorators

Neoworks stores user data as end-to-end encrypted nodes in a tree of roots,
containers and items. A schema published as a collection says which model each
container and item stores and how that model is encrypted. Roots carry no content;
a collection's name is the registry title from its manifest.

| Decorator | On | Meaning |
|---|---|---|
| `@neoworks.node("container" \| "item")` | model | The model is the content of every node of this kind. At most one model per kind. |
| `@neoworks.facet("Name")` | field of a node model | The field is encrypted in the named facet. |
| `@neoworks.searchable` | `string`, `[string]`, `File` or `[File]` field of a node model | The client indexes the field for search; a `File` is indexed by its name. |
| `@neoworks.timeRange(start: "a", end: "b")` | node model | The client indexes nodes by the interval between two `timestamp` fields in the same facet. |
| `@neoworks.title` | one single `string` or `File` field of a node model | The node's display name, e.g. a calendar's name on the consent screen; for a `File`, the file's name. |

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

### References

`ref<Model>` is a field type for the id of a node of another model, possibly of
another schema (`ref<neoworks.photos.Album>`). The model must be marked
`@neoworks.node`; the resolver reports `OS1003` for an unknown model and `OS1017`
for one that is not a node model. A reference is a `uuid` on the wire and in the
generated types. In the descriptor the field's value stays `{"kind": "scalar",
"scalar": "uuid"}` and gains `"reference": "<qualified model name>"`, which is how
a runtime finds the references in a node's content. Neoworks shares the nodes an
item references along with the item.

```openschema
@neoworks.node("container")
model Album { 1 name: string }

@neoworks.node("item")
model Photo {
  1 caption: string
  2 album: ref<Album>?
}
```

### Files

`File` is a field type like `string`: `image: File` is required, `picture: File?`
optional and `attachments: [File]` holds several. It may appear in any node model,
and `File` cannot be declared as a model, enum or alias (`OS1018`). A file's
bytes live in object storage; the `File` value in the content says where and
what they are. On the wire it is the message `File`, with `FileVariant` for its
variants (the codec target emits both when a schema uses `File`):

| Message | Ordinal | Field | Type |
|---|---|---|---|
| `File` | 1 | `objectId` | `uuid`, the storage object of the original |
| | 2 | `name` | `string` |
| | 3 | `mediaType` | `string` |
| | 4 | `size` | `u64`, bytes of the original |
| | 5 | `variants` | `{string: FileVariant}`, by name, e.g. `thumbnail` |
| `FileVariant` | 1 | `objectId` | `uuid` |
| | 2 | `size` | `u64` |

In the descriptor the field's value is `{"kind": "file"}`; the message layout is
built into the runtime. `@neoworks.title` and `@neoworks.searchable` on a `File`
field mean its `name`. Validation decorators do not apply to a `File`.

```openschema
@neoworks.node("item")
model Photo {
  @neoworks.title
  1 image: File
  2 picture: File?
  @neoworks.searchable
  3 attachments: [File]
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
| `OSD007` | `@neoworks.searchable` on a field that is not `string`, `[string]`, `File` or `[File]` |
| `OSD008` | invalid `@neoworks.timeRange` |
| `OSD009` | invalid validation decorator |
| `OSD010` | `@neoworks.title` not on exactly one single `string` or `File` field |
