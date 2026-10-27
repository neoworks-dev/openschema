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

function stubRegistry(status: number, body: unknown): void {
  globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
}

test("publish posts the version to the schema's versions endpoint", async () => {
  let requestedUrl = "";
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requestedUrl = url;
    sentBody = JSON.parse(String(init.body));
    return Response.json({}, { status: 201 });
  }) as unknown as typeof fetch;
  await publish("https://api.example/", "token", payload);
  expect(requestedUrl).toBe("https://api.example/api/v1/schemas/example/songs/versions");
  expect(sentBody.version).toBe("0.2.0");
  expect(sentBody.scope).toBeUndefined();
  expect(sentBody.name).toBeUndefined();
});

test("a 409 with violations throws them", async () => {
  const violations = [{ rule: "field_ordinal_reused", path: "models.Song.fields[2]", message: "field number 2 was \"artist\" and is now \"performer\"" }];
  stubRegistry(409, { error: "incompatible_schema", message: "the schema version is incompatible with earlier versions", violations });
  const failure = await publish("https://api.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(IncompatibleSchemaError);
  expect(failure.violations).toEqual(violations);
});

test("other failures keep their message", async () => {
  stubRegistry(409, { error: "version_exists", message: "that version is already published and cannot change" });
  await expect(publish("https://api.example", "token", payload)).rejects.toThrow("that version is already published and cannot change");
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
  stubRegistry(403, { error: "missing_permission", message: "this needs the schemas.publish permission", permission: "schemas.publish" });
  const failure = await publish("https://api.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.status).toBe(403);
  expect(failure.code).toBe("missing_permission");
  expect(failure.message).toBe("you may not publish into @example: it needs the schemas.publish permission for the owner of @example");
});

test("a 404 says the scope is not a handle yet", async () => {
  stubRegistry(404, { error: "not_found", message: "not found" });
  const failure = await publish("https://api.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.message).toContain("@example is not a handle");
});

test("a 409 for an archived organization is not mistaken for an existing version", async () => {
  stubRegistry(409, { error: "archived", message: "the organization is archived" });
  const failure = await publish("https://api.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.message).toBe("@example belongs to an archived organization; nobody can publish into it");
});

test("a 401 asks for a login", async () => {
  stubRegistry(401, { error: "unauthorized", message: "authentication required" });
  await expect(publish("https://api.example", "token", payload)).rejects.toThrow("run `openschema login`");
});

test("a refusal with a null body still explains the status", async () => {
  stubRegistry(500, null);
  const failure = await publish("https://api.example", "token", payload).catch((error) => error);
  expect(failure).toBeInstanceOf(PublishRefusedError);
  expect(failure.message).toBe("publish failed (500)");
});
