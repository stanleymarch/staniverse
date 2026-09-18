/**
 * A dash ends a line, it never starts one. This pass binds every em dash to the
 * word before it with a non-breaking space in the built pages, so a wrap can only
 * happen after the dash — in prose written in Markdown and in the hand-written
 * layouts alike, which no Markdown plugin can reach.
 *
 * Only text between tags is touched: markup, attributes, scripts, styles and code
 * blocks stay byte-identical, so nothing here can break a page's behaviour.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");

const collect = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
};

const pages = await collect(root);
const bind = (html) =>
  html.replace(/(<(?:script|style|pre)\b[\s\S]*?<\/(?:script|style|pre)>)|>([^<]+)</g, (match, verbatim, text) =>
    verbatim ? match : `>${text.replace(/(\S) — /g, "$1\u00A0— ")}<`,
  );

let rewritten = 0;
await Promise.all(pages.map(async (page) => {
  const html = await readFile(page, "utf8");
  const next = bind(html);
  if (next === html) return;
  await writeFile(page, next, "utf8");
  rewritten += 1;
}));
console.log(`dash binding: ${rewritten} of ${pages.length} pages rewritten in ${root}`);
