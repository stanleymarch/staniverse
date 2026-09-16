/**
 * Subpath integrity gate for non-root deployments (GitHub Pages project sites).
 *
 * Astro only rewrites the URLs it generates itself (bundled assets, and anything
 * derived from `Astro.site`). Every hand-written root-absolute reference —
 * navigation, public/ scripts, Telegram media paths, legacy redirect maps,
 * search/graph payloads, sitemap and robots.txt — resolves against the
 * deployment origin root, so under a subpath it would 404.
 * scripts/rewrite-pages-base.mjs rewrites those references in the built dist/
 * before this gate runs; the gate independently verifies that the rewriter left
 * nothing unresolved, and fails the deploy instead of publishing a preview that
 * is visibly broken.
 *
 * Usage: BASE_PATH=/staniverse SITE_URL=https://user.github.io/repo \
 *          node scripts/check-pages-base.mjs [distDir]
 * Exits 0 when the artifact is subpath-clean, or when the deployment is
 * root-based (nothing to verify). Exits 1 listing every offending reference.
 */
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? process.env.DIST_DIR ?? "dist");

/** Deployment is root-based unless BASE_PATH names a subpath. */
const trimmedBase = (process.env.BASE_PATH ?? "").trim();
const base = trimmedBase && trimmedBase !== "/" ? `/${trimmedBase.replace(/^\/+|\/+$/g, "")}` : "";

let origin = "";
let sitePath = "";
try {
  const site = new URL((process.env.SITE_URL ?? "").trim());
  origin = site.origin;
  sitePath = site.pathname.replace(/\/+$/, "");
} catch {
  origin = "";
}

if (!base) {
  console.log("check-pages-base: root-based deployment (BASE_PATH empty), nothing to verify.");
  process.exit(0);
}

const TEXT_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".svg", ".webmanifest"]);
const findings = new Map();

/** A single unscoped origin-root-absolute path or absolute preview URL. */
function inspect(rule, file, value) {
  const rooted = value.startsWith("/") && !value.startsWith("//");
  if (rooted) {
    if (value !== base && !value.startsWith(`${base}/`)) add(rule, file, value);
    return;
  }
  if (!origin || !value.startsWith(origin)) return;
  const path = value.slice(origin.length);
  if (sitePath && path !== sitePath && !path.startsWith(`${sitePath}/`) && !path.startsWith(`${sitePath}#`) && !path.startsWith(`${sitePath}?`)) {
    add(`${rule} [absolute URL missing base]`, file, value);
  }
}

function add(rule, file, value) {
  const entry = findings.get(rule) ?? { count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 5) entry.examples.push(`${file}  ->  ${value}`);
  findings.set(rule, entry);
}

/** Root-absolute or preview-origin absolute strings in JS/CSS/inline code. */
const inspectLiterals = (rule, file, source) => {
  for (const [, value] of source.matchAll(/["'`](\/[A-Za-z][^"'`\s]*)["'`]/g)) inspect(rule, file, value);
  for (const [, value] of source.matchAll(/url\(\s*["']?(\/[^"')]+)["']?\s*\)/g)) inspect(rule, file, value);
};

function inspectHtml(file, html) {
  for (const [, , value] of html.matchAll(/\b(?:href|src|action|poster|content)\s*=\s*(["'])(.*?)\1/gi)) inspect("HTML attribute", file, value);
  for (const [, , value] of html.matchAll(/\bcontent\s*=\s*(["'])[^"']*?\burl=([^"';\s]+)/gi)) inspect("HTML meta refresh", file, value);
  for (const [, value] of html.matchAll(/<loc>\s*([^<\s]+)/gi)) inspect("XML loc", file, value);
  for (const [, body] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) inspectLiterals("inline style", file, body);

  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/application\/ld\+json/i.test(attrs)) {
      try {
        walkJson("JSON-LD", file, JSON.parse(body.trim()));
      } catch {
        inspectLiterals("JSON-LD (unparsed)", file, body);
      }
      continue;
    }
    inspectLiterals("inline script", file, body);
  }
}

function walkJson(rule, file, value) {
  if (typeof value === "string") {
    inspect(rule, file, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJson(rule, file, item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkJson(rule, file, item);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const file = relative(distDir, full).replace(/\\/g, "/");
    const text = readFileSync(full, "utf8");
    if (ext === ".html" || ext === ".htm" || ext === ".xml" || ext === ".svg") inspectHtml(file, text);
    else if (ext === ".json" || ext === ".webmanifest") {
      try {
        walkJson("JSON payload", file, JSON.parse(text));
      } catch {
        inspectLiterals("JSON payload (unparsed)", file, text);
      }
    } else if (ext === ".txt") {
      for (const [, value] of text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) inspect("robots.txt sitemap", file, value);
      inspectLiterals("plain text", file, text);
    } else inspectLiterals(`${ext} asset`, file, text);
  }
}

walk(distDir);

const total = [...findings.values()].reduce((sum, entry) => sum + entry.count, 0);
if (total === 0) {
  console.log(`check-pages-base: dist/ is subpath-clean for ${base}.`);
  process.exit(0);
}

console.error(`check-pages-base: ${total} reference(s) in dist/ cannot resolve under ${base}.\n`);
for (const [rule, { count, examples }] of findings) {
  console.error(`${rule}: ${count}`);
  for (const item of examples) console.error(`  ${item}`);
  console.error("");
}
console.error(`
Refusing to deploy: this artifact would publish a visibly broken preview.
The references above survived scripts/rewrite-pages-base.mjs. Extend that
rewriter to cover the mechanisms listed here, then re-run it and this gate.
`);
process.exit(1);
