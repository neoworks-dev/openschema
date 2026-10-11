import { afterEach, expect, test } from "bun:test";
import { IncompatibleSchemaError, PublishRefusedError, describeViolations, publish, type PublishPayload } from "../src/registry/client";

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

test("a 403 names the scope and the permission it lacks", async () => {
  stubSite(403, { error: "this needs the schemas.publish permission", code: "missing_permission", permission: "schemas.publish" });
  const failure = await publish("https://site.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.status).toBe(403);
  expect(failure.message).toBe("you may not publish into @example: it needs the schemas.publish permission for the owner of @example");
});

test("a 404 says the scope is not a handle yet", async () => {
  stubSite(404, { error: "not found", code: "not_found" });
  const failure = await publish("https://site.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.message).toContain("@example is not a handle");
});

test("a 409 for an archived organization is not mistaken for an existing version", async () => {
  stubSite(409, { error: "the organization is archived", code: "archived" });
  const failure = await publish("https://site.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.message).toBe("@example belongs to an archived organization; nobody can publish into it");
});

test("a 401 asks for a login", async () => {
  stubSite(401, { error: "authentication required" });
  await expect(publish("https://site.example", "token", payload)).rejects.toThrow("run `openschema login`");
});
