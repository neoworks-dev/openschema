import { afterEach, expect, test } from "bun:test";
import { fetchSchema } from "../src/registry/client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubRegistry(routes: Record<string, unknown>): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = routes[url];
    if (body === undefined) return new Response("{}", { status: 404 });
    return Response.json(body);
  }) as typeof fetch;
  return requested;
}

test("fetchSchema resolves latest and orders files by ordinal", async () => {
  const base = "https://api.example/api/v1/schemas/acme/commerce";
  stubRegistry({
    [base]: { schema: { latestVersion: "1.2.0" } },
    [`${base}/versions/1.2.0`]: {
      files: [
        { path: "b.schema", contents: "b", ordinal: 1 },
        { path: "a.schema", contents: "a", ordinal: 0 },
      ],
    },
  });
  const resolved = await fetchSchema("https://api.example", { scope: "acme", name: "commerce", version: "latest" });
  expect(resolved.version).toBe("1.2.0");
  expect(resolved.files.map((file) => file.path)).toEqual(["a.schema", "b.schema"]);
});

test("fetchSchema reports a missing version", async () => {
  stubRegistry({});
  await expect(
    fetchSchema("https://api.example", { scope: "acme", name: "commerce", version: "9.9.9" }),
  ).rejects.toThrow("version 9.9.9 of @acme/commerce not found");
});
