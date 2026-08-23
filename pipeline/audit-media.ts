import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalPublication } from "./telegram/types";

const root = resolve(process.argv[2] ?? "public/media/telegram");
const archivePath = resolve(process.argv[3] ?? "pipeline/telegram/archive/canonical.json");
const maxFileBytes = Number(process.env.MEDIA_MAX_FILE_MB ?? 9.5) * 1024 * 1024;
const maxTotalBytes = Number(process.env.MEDIA_MAX_TOTAL_MB ?? 250) * 1024 * 1024;
const files = await readdir(root);
const sizes = await Promise.all(files.map(async (name) => ({ name, bytes: (await stat(resolve(root, name))).size })));
const totalBytes = sizes.reduce((sum, file) => sum + file.bytes, 0);
const largest = sizes.sort((a, b) => b.bytes - a.bytes)[0];
const oversized = sizes.filter((file) => file.bytes > maxFileBytes);
const archive = JSON.parse(await readFile(archivePath, "utf8")) as { publications: CanonicalPublication[] };
const expected = new Set(archive.publications.flatMap((publication) => publication.media.map((media) => media.publicPath?.split("/").pop()).filter((name): name is string => Boolean(name))));
const actual = new Set(files);
const missing = [...expected].filter((name) => !actual.has(name));
const orphaned = [...actual].filter((name) => !expected.has(name));
const report = {
  files: sizes.length,
  totalMB: Number((totalBytes / 1048576).toFixed(1)),
  largest: largest ? { name: largest.name, MB: Number((largest.bytes / 1048576).toFixed(2)) } : null,
  limits: { fileMB: maxFileBytes / 1048576, totalMB: maxTotalBytes / 1048576 },
  referenced: expected.size,
  missing: missing.length,
  orphaned: orphaned.length,
};
console.log(JSON.stringify(report, null, 2));
if (oversized.length || totalBytes > maxTotalBytes || missing.length || orphaned.length) {
  console.error(JSON.stringify({ oversized: oversized.map((file) => file.name), totalExceeded: totalBytes > maxTotalBytes, missing, orphaned }, null, 2));
  process.exitCode = 1;
}
