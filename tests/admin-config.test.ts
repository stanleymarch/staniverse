import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";

/** The Sveltia admin regenerates frontmatter from the fields declared in its
 * config: a key a real page carries but the config does not declare would be
 * silently dropped on the first save. This test keeps the config a complete
 * map of the corpus — it fails on any undeclared key, and on a collection
 * missing the `hidden` kill switch the whole curation flow leans on.
 *
 * The admin lives under an unguessable directory name that must not appear in
 * committed code or logs, so the test discovers the directory at runtime: the
 * one folder in public/ that carries a Sveltia config. */

async function findAdminDir(): Promise<string> {
  for (const entry of await readdir("public", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (await stat(join("public", entry.name, "config.yml")).then(() => true, () => false)) return entry.name;
  }
  throw new Error("no admin directory with config.yml under public/");
}

test("admin config declares every frontmatter key of every collection it edits", async () => {
  const adminDir = await findAdminDir();
  const config = YAML.parse(await readFile(resolve("public", adminDir, "config.yml"), "utf8")) as {
    collections: { name: string; label: string; folder: string; fields: { name: string }[] }[];
  };
  assert.ok(config.collections.length >= 8, "expected all content collections in the admin config");
  for (const collection of config.collections) {
    const declared = new Set(collection.fields.map((field) => field.name));
    assert.ok(declared.has("hidden"), `${collection.name}: the hidden kill switch must stay editable`);
    const files = (await readdir(resolve(collection.folder), { recursive: true })).filter((name) => String(name).endsWith(".md"));
    assert.ok(files.length > 0, `${collection.name}: folder ${collection.folder} has no pages`);
    for (const file of files) {
      const page = (await readFile(resolve(collection.folder, String(file)), "utf8")).replace(/^\uFEFF/, "");
      const frontmatter = page.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter) continue;
      const data = YAML.parse(frontmatter[1]) as Record<string, unknown>;
      for (const key of Object.keys(data)) {
        assert.ok(declared.has(key), `${collection.name}/${file}: frontmatter key «${key}» is not declared in the admin config — Sveltia would drop it on save`);
      }
    }
  }
});

test("the admin page loads its vendored bundle locally, under a neutral name", async () => {
  const adminDir = await findAdminDir();
  const page = await readFile(resolve("public", adminDir, "index.html"), "utf8");
  const source = page.match(/src="([^"]+)"/)?.[1];
  assert.ok(source?.startsWith("/vendor/"), `expected a vendored bundle reference, got ${source}`);
  assert.ok(!source.includes("sveltia"), "the bundle file name must not name the CMS");
  assert.ok((await stat(resolve("public", source.slice(1)))).size > 1_000_000, "vendored CMS bundle is missing or truncated");
});
