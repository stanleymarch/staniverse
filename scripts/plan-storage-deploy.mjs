import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, link, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(process.env.DEPLOY_ROOT ?? "dist");
const previousPath = resolve(process.env.DEPLOY_PREVIOUS_MANIFEST ?? "tmp/storage-manifest.prev.json");
const inventoryPath = process.env.DEPLOY_REMOTE_INVENTORY ? resolve(process.env.DEPLOY_REMOTE_INVENTORY) : undefined;
const output = resolve(process.env.DEPLOY_OUTPUT ?? "tmp/storage-deploy");
const uploadRoot = join(output, "upload");
const deleteRoot = join(output, "delete");
const manifestPath = join(output, "manifest.json");

const profiles = {
  html: "public, max-age=0, must-revalidate",
  immutable: "public, max-age=31536000, immutable",
  media: "public, max-age=2592000, must-revalidate",
  other: "public, max-age=86400, must-revalidate",
};

const toKey = (path) => relative(root, path).split(sep).join("/");
const isOwned = (key) => key !== ".deploy-manifest.json" && (!key.startsWith("lab/") || key === "lab/index.html");
const profileFor = (key) => key.endsWith(".html") ? "html" : key.startsWith("_astro/") ? "immutable" : key.startsWith("media/") ? "media" : "other";

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function hashes(path) {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => { sha256.update(chunk); md5.update(chunk); });
    stream.on("error", rejectStream);
    stream.on("end", resolveStream);
  });
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return undefined; }
}

await rm(output, { recursive: true, force: true });
for (const profile of Object.keys(profiles)) await mkdir(join(uploadRoot, profile), { recursive: true });
await mkdir(deleteRoot, { recursive: true });

const files = (await walk(root)).sort((a, b) => toKey(a).localeCompare(toKey(b), "en"));
const current = {};
const localMd5 = new Map();
for (const path of files) {
  const key = toKey(path);
  if (!isOwned(key)) continue;
  const info = await stat(path);
  const digest = await hashes(path);
  const profile = profileFor(key);
  current[key] = { sha256: digest.sha256, size: info.size, cacheControl: profiles[profile] };
  localMd5.set(key, digest.md5);
}

let previous = await readJson(previousPath);
let bootstrappedFromInventory = false;
if (!previous?.files && inventoryPath) {
  const inventory = await readJson(inventoryPath);
  if (inventory?.Contents) {
    const synthetic = {};
    for (const object of inventory.Contents) {
      const key = String(object.Key ?? "");
      if (!key || !isOwned(key)) continue;
      const etag = String(object.ETag ?? "").replaceAll('"', "");
      const size = Number(object.Size ?? -1);
      const record = current[key];
      /* Yandex uses MD5 ETags for single-part objects. Multipart ETags contain
         a dash; for the one-time bootstrap, equal size is sufficient for those
         large media files because the old workflow already synced this build. */
      const matches = Boolean(record && size === record.size && (etag === localMd5.get(key) || (key.startsWith("media/") && etag.includes("-"))));
      synthetic[key] = matches
        ? record
        : { sha256: `remote:${etag || "unknown"}`, size, cacheControl: record?.cacheControl ?? "unknown" };
    }
    previous = { version: 1, files: synthetic };
    bootstrappedFromInventory = true;
  }
}
if (!previous?.files) previous = { version: 1, files: {} };

const changed = [];
for (const [key, record] of Object.entries(current)) {
  const before = previous.files[key];
  if (!before || before.sha256 !== record.sha256 || before.size !== record.size || before.cacheControl !== record.cacheControl) changed.push(key);
}
const deleted = Object.keys(previous.files).filter((key) => isOwned(key) && !current[key]).sort((a, b) => a.localeCompare(b, "en"));

const counts = { html: 0, immutable: 0, media: 0, other: 0 };
for (const key of changed) {
  const profile = profileFor(key);
  counts[profile] += 1;
  const source = join(root, ...key.split("/"));
  const target = join(uploadRoot, profile, ...key.split("/"));
  await mkdir(dirname(target), { recursive: true });
  try { await link(source, target); }
  catch { await copyFile(source, target); }
}

for (let offset = 0, index = 0; offset < deleted.length; offset += 1000, index += 1) {
  const chunk = deleted.slice(offset, offset + 1000);
  await writeFile(join(deleteRoot, `${String(index).padStart(3, "0")}.json`), JSON.stringify({ Objects: chunk.map((Key) => ({ Key })), Quiet: true }));
}

const manifest = { version: 1, files: current };
const manifestJson = `${JSON.stringify(manifest)}\n`;
await writeFile(manifestPath, manifestJson);
const previousCanonical = `${JSON.stringify({ version: 1, files: previous.files })}\n`;
const manifestChanged = bootstrappedFromInventory || manifestJson !== previousCanonical;
const plan = {
  total: Object.keys(current).length,
  changed: changed.length,
  deleted: deleted.length,
  counts,
  manifestChanged,
  bootstrappedFromInventory,
};
await writeFile(join(output, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    ...Object.entries(counts).map(([profile, count]) => `${profile}=${count}`),
    `deleted=${deleted.length}`,
    `manifest_changed=${manifestChanged}`,
    `total=${plan.total}`,
    `changed=${plan.changed}`,
    `bootstrapped=${bootstrappedFromInventory}`,
    "",
  ].join("\n"));
}

console.log(JSON.stringify(plan, null, 2));
