// tests/helpers/loadCodec.ts
// The codec emitter produces a string. The only honest test is to execute it,
// so this writes the generated file to a temp directory and imports it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "../../src/index";
import { resolve } from "../../src/resolver";
import { getEmitter } from "../../src/emit";

const roots: string[] = [];
let counter = 0;

export function generateCodec(src: string, company: string | null = null): string {
  const schema = resolve(parse(src));
  const files = getEmitter("codec")!.emit({
    schema, company, includePrivate: false, options: {},
  });
  return files[0].contents;
}

/** Emit, write, and import. Each call gets a unique path so imports never alias. */
export async function loadCodec(src: string): Promise<Record<string, any>> {
  const root = mkdtempSync(join(tmpdir(), "openschema-codec-"));
  roots.push(root);

  counter += 1;
  const file = join(root, `codec${counter}.ts`);
  writeFileSync(file, generateCodec(src), "utf8");
  return import(pathToFileURL(file).href) as Promise<Record<string, any>>;
}

export function cleanupCodecs(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  return out;
}
