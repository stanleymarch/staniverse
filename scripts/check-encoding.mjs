/**
 * Document-encoding gate.
 *
 * The whole site is Cyrillic. When a document carries non-ASCII bytes but does
 * not declare its encoding within the first 1024 bytes, a browser falls back to
 * a legacy encoding and every Russian character turns into mojibake — a failure
 * the build never notices and only the visitor's browser shows. Documents that
 * are pure ASCII (Astro's `meta refresh` redirect stubs) have no encoding to
 * guess, so they are exempt rather than flagged.
 *
 * Usage: node scripts/check-encoding.mjs [distDir]
 */
import { readdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? process.env.DIST_DIR ?? "dist");
/** HTML requires the declaration to be found within the first 1024 bytes. */
const WINDOW = 1024;
const CHARSET = /<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>/i;

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return htmlFiles(path);
    return item.name.endsWith(".html") ? [path] : [];
  });
}

function readRange(path, length, position = 0) {
  const size = Math.min(length, statSync(path).size - position);
  if (size <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(size);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, size, position);
  } finally {
    closeSync(fd);
  }
  return buffer;
}

const isAscii = (buffer) => !buffer.some((byte) => byte > 0x7f);

const pages = htmlFiles(distDir);
const broken = pages.filter((page) => {
  if (CHARSET.test(readRange(page, WINDOW).toString("utf8"))) return false;
  // No declaration: only safe when the document has nothing to mis-read.
  return !isAscii(readRange(page, statSync(page).size));
});

if (broken.length) {
  console.error(`check-encoding: ${broken.length} of ${pages.length} pages carry non-ASCII bytes without <meta charset="UTF-8"> in the first ${WINDOW} bytes:`);
  for (const page of broken.slice(0, 10)) console.error(`  ${page.slice(distDir.length + 1)}`);
  if (broken.length > 10) console.error(`  … and ${broken.length - 10} more`);
  process.exit(1);
}
console.log(`check-encoding: ${pages.length} pages are encoding-safe.`);
