import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

/** The Sveltia admin regenerates frontmatter from the fields declared in
 * public/admin/config.yml: a key a real page carries but the config does not
 * declare would be silently dropped on the first save. This test keeps the
 * config a complete map of the corpus — it fails on any undeclared key, and on
 * a collection missing the `hidden` kill switch the whole curation flow leans on. */

test("admin config declares every frontmatter key of every collection it edits", async () => {
  const config = YAML.parse(await readFile(resolve("public/admin/config.yml"), "utf8")) as {
    collections: { name: string; label: string; folder: string; fields: { name: string }[] }[];
  };
  assert.ok(config.collections.length >= 7, "expected all content collections in the admin config");
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
        assert.ok(declared.has(key), `${collection.name}/${file}: frontmatter key «${key}» is not declared in public/admin/config.yml — Sveltia would drop it on save`);
      }
    }
  }
});

test("the admin page loads the vendored Sveltia bundle, not a CDN", async () => {
  const page = await readFile(resolve("public/admin/index.html"), "utf8");
  const source = page.match(/src="([^"]+)"/)?.[1];
  assert.equal(source, "/vendor/sveltia-cms.js");
  assert.ok((await stat(resolve("public/vendor/sveltia-cms.js"))).size > 1_000_000, "vendored Sveltia bundle is missing or truncated");
});
