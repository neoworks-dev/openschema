import { afterEach, expect, test } from "bun:test";
import { IncompatibleSchemaError, describeViolations, publish, type PublishPayload } from "../src/registry/client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const payload: PublishPayload = {
  scope: "example", name: "songs", version: "0.2.0", title: "Songs", description: "Songs",
  files: [{ path: "songs.schema", contents: "namespace example.songs" }],
};

function stubSite(status: number, body: unknown): void {
  globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
}

test("publish succeeds on a 2xx", async () => {
  stubSite(200, { ok: true });
  await publish("https://site.example", "token", payload);
});

test("a 409 with violations throws them", async () => {
  const violations = [{ rule: "field_ordinal_reused", path: "models.Song.fields[2]", message: "field number 2 was \"artist\" and is now \"performer\"" }];
  stubSite(409, { error: "the schema version is incompatible with earlier versions", violations });
  const failure = await publish("https://site.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(IncompatibleSchemaError);
  expect(failure.violations).toEqual(violations);
});

test("other failures keep their message", async () => {
  stubSite(409, { error: "that version is already published and cannot change" });
  await expect(publish("https://site.example", "token", payload)).rejects.toThrow("that version is already published and cannot change");
});

test("violations are printed with their rule, path and message", () => {
  const lines = describeViolations(payload, [{ rule: "node_kind_removed", path: "nodes.container", message: "container nodes stored Playlist" }]);
  expect(lines).toEqual([
    "@example/songs@0.2.0 is not compatible with the versions already published:",
    "  node_kind_removed  nodes.container",
    "      container nodes stored Playlist",
  ]);
});
