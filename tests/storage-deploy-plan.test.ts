import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const planner = resolve("scripts/plan-storage-deploy.mjs");

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function plan(root: string, output: string, previous?: string, inventory?: string) {
  const result = spawnSync(process.execPath, [planner], {
    env: {
      ...process.env,
      DEPLOY_ROOT: root,
      DEPLOY_OUTPUT: output,
      DEPLOY_PREVIOUS_MANIFEST: previous ?? join(output, "missing.json"),
      ...(inventory ? { DEPLOY_REMOTE_INVENTORY: inventory } : {}),
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(readFileSync(join(output, "plan.json"), "utf8"));
}

test("content manifest makes an identical build zero-PUT and catches same-size changes", (t) => {
  const base = mkdtempSync(join(tmpdir(), "staniverse-deploy-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "dist");
  write(join(root, "index.html"), "one");
  write(join(root, "robots.txt"), "robots");
  write(join(root, "lab", "index.html"), "lab-index");
  write(join(root, "lab", "probe", "index.html"), "owned elsewhere");

  const firstOutput = join(base, "first");
  const first = plan(root, firstOutput);
  assert.equal(first.changed, 3);
  assert.equal(first.total, 3, "nested lab experiment must not enter the production manifest");

  const manifest = join(firstOutput, "manifest.json");
  const second = plan(root, join(base, "second"), manifest);
  assert.deepEqual({ changed: second.changed, deleted: second.deleted, manifestChanged: second.manifestChanged }, { changed: 0, deleted: 0, manifestChanged: false });

  write(join(root, "index.html"), "two"); // same byte length: --size-only would miss it
  unlinkSync(join(root, "robots.txt"));
  const thirdOutput = join(base, "third");
  const third = plan(root, thirdOutput, manifest);
  assert.equal(third.changed, 1);
  assert.equal(third.counts.html, 1);
  assert.equal(third.deleted, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(thirdOutput, "delete", "000.json"), "utf8")).Objects, [{ Key: "robots.txt" }]);
});

test("first manifest bootstraps matching ETags without reuploading or deleting lab apps", (t) => {
  const base = mkdtempSync(join(tmpdir(), "staniverse-bootstrap-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "dist");
  write(join(root, "index.html"), "home");
  write(join(root, "_astro", "app.js"), "asset");
  write(join(root, "lab", "index.html"), "lab-index");

  const contents = ["index.html", "_astro/app.js", "lab/index.html"].map((key) => {
    const body = readFileSync(join(root, ...key.split("/")));
    return { Key: key, ETag: `\"${createHash("md5").update(body).digest("hex")}\"`, Size: body.length };
  });
  contents.push(
    { Key: "old.html", ETag: "\"deadbeef\"", Size: 3 },
    { Key: "lab/keep/index.html", ETag: "\"ignored\"", Size: 7 },
  );
  const inventory = join(base, "inventory.json");
  writeFileSync(inventory, JSON.stringify({ Contents: contents }));

  const output = join(base, "output");
  const result = plan(root, output, undefined, inventory);
  assert.equal(result.bootstrappedFromInventory, true);
  assert.equal(result.changed, 0, "matching remote objects must not be PUT again");
  assert.equal(result.deleted, 1);
  assert.equal(result.manifestChanged, true, "the first deterministic manifest still needs one PUT");
  assert.deepEqual(JSON.parse(readFileSync(join(output, "delete", "000.json"), "utf8")).Objects, [{ Key: "old.html" }]);
});
