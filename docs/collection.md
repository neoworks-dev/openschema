# Collection target and project setup

A Neoworks app opens a collection with `neoworks.collection()`, which needs the
collection's registry path and its [descriptor](./descriptor.md) text. The
`collection` target writes both as one module, so an app never copies a
descriptor by hand.

## Start a project

```sh
openschema init notes --scope acme
cd notes
openschema notes.schema --target descriptor,codec,collection --out generated
openschema login
openschema publish
```

`init [dir]` writes two files and refuses to overwrite either unless you pass
`--force`:

- `openschema.yaml`, the [manifest](./cli.md#publish-dir) `publish` reads. `--scope`
  is your handle, or the handle of an organization you may publish for; without it
  the file holds the placeholder `your-handle`, which you replace. `--name` defaults
  to the directory name, `--title` and `--description` to text derived from it.
- `<name>.schema`, a small collection with two tables, folders and the notes that
  belong to them. Its header shows the generate command above.

The scope is a handle that already exists: publishing into a scope that is not a
handle is refused. Pick your handle in the developer dashboard first.

## The `collection` target

```sh
openschema notes.schema --target collection --out generated
```

Writes `index.ts`:

```ts
export * from './schema.codec.ts'
import type { Folder, Note } from './schema.codec.ts'

/** Pass to `Neoworks.collection`; the descriptor text is exactly what the registry publishes. */
export const collection = {
	name: '@acme/notes',
	descriptor: "{\n  \"descriptorVersion\": 2, ...",
} as {
	readonly name: '@acme/notes'
	readonly descriptor: string
	readonly tables?: { Folder: Folder; Note: Note }
}

export default collection
```

- `name` is the registry path `@scope/name`, taken from the `openschema.yaml` in the
  schema's directory. Without a manifest the target fails and writes nothing.
- `descriptor` is the text `openschema publish` uploads: the `descriptor` target's
  output with no company overlay and no private fields. The registry serves the same
  bytes by hash, which is how a client verifies the descriptor it bundled.
- The `export * from './schema.codec.ts'` line is written when the `codec` target runs
  in the same command, so apps import the content types and `collection` from one
  module. Run the targets together: `--target descriptor,codec,collection`.
- With the codec, the export is typed: `tables` exists only in the type system and
  gives the content type of every table, so `neoworks.collection()` can return
  typed resources. Without the codec the export is the plain `as const` object and
  the SDK resources are untyped.
- The schema must define `@neoworks.table` models; a schema without tables has no
  descriptor and the target fails.

Regenerate and commit the output whenever the schema changes. The `openschema.lock`
ordinal ledger is kept up to date by the same command, as for every target.

```ts
import schema from './generated/index.ts'

const { folders, notes } = neoworks.collection(schema)
const note = await notes.create({ folder: folderId, title: 'Hello' })
```

## Publishing to a development stack

By default the CLI talks to production (`api.`, `oauth.` and `openschema.` under
`neoworks.dev`). Point it at another stack with the base domain, scheme and port the
services share, mirroring `neoworksUrls()` in the SDK:

| Variable | Flag | Meaning |
|---|---|---|
| `OPENSCHEMA_BASE_DOMAIN` | | base domain, e.g. `neoworks.localhost` |
| `OPENSCHEMA_SCHEME` | | `https` (default) or `http` |
| `OPENSCHEMA_BASE_PORT` | `--base-port` | one port for every service, e.g. `8443` |

The port is left out of the URLs when it is the scheme's default (443 or 80). The flag
exists on `login`, `publish` and `add` and wins over the variable. The per-service
variables `OPENSCHEMA_REGISTRY`, `OPENSCHEMA_OAUTH_URL` and `OPENSCHEMA_SITE_URL` still
override a single URL.

```sh
OPENSCHEMA_BASE_DOMAIN=neoworks.localhost openschema login --base-port 8443
OPENSCHEMA_BASE_DOMAIN=neoworks.localhost openschema publish --base-port 8443
```

A development stack behind a local certificate authority also needs
`NODE_EXTRA_CA_CERTS` pointing at that authority's root certificate.

## When a publish is refused

`publish` explains refusals about the scope and the sign-in, and lists the rules a
version breaks:

| Status | Message |
|---|---|
| 401 | you are not signed in; run `openschema login` |
| 403 | you may not publish into `@scope`: it needs the `schemas.publish` permission for the owner of `@scope` |
| 404 | `@scope` is not a handle: pick it in the developer dashboard first |
| 409 | `@scope` belongs to an archived organization; nobody can publish into it |
| 409 | a version that already exists, or an incompatible schema with the [violations](./compatibility.md) listed |

Nothing is published in any of these cases.
