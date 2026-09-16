/**
 * Post-build subpath rewriter for the GitHub Pages preview.
 *
 * The site is authored entirely with root-absolute URLs, which is correct for
 * staniverse.xyz and stays untouched: this script rewrites only the built
 * `dist/` artifact of a subpath deployment, after `astro build` and before
 * scripts/check-pages-base.mjs verifies the result. No source or content file
 * is modified, and a root-based deployment (BASE_PATH empty) is a no-op.
 *
 * What it prefixes with the base, exactly once:
 *  - HTML attributes (href/src/action/poster/content) holding site-internal paths
 *  - <meta http-equiv="refresh"> destinations
 *  - quoted string literals in inline scripts, public/ scripts and JSON payloads
 *  - CSS url() references (stylesheets and inline style attributes)
 *  - <loc> entries in sitemap.xml and unquoted same-origin absolute URLs
 *  - same-origin absolute URLs that Astro resolved from `new URL("/…", Astro.site)`
 *    (canonical, og:*, JSON-LD ids) so they point under SITE_URL + BASE_PATH
 *  - the Sitemap: line of robots.txt, pointed at the preview sitemap
 *
 * Deliberately untouched: external URLs (Telegram, YouTube, staniverse.xyz links
 * inside content) and public/llms.txt, which describes the production site.
 *
 * Usage: BASE_PATH=/staniverse SITE_URL=https://user.github.io/repo \
 *          node scripts/rewrite-pages-base.mjs [distDir]
 * Idempotent: every rewrite checks for an existing base prefix first.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? process.env.DIST_DIR ?? "dist");

/** Deployment is root-based unless BASE_PATH names a subpath. */
const trimmedBase = (process.env.BASE_PATH ?? "").trim();
const base = trimmedBase && trimmedBase !== "/" ? `/${trimmedBase.replace(/^\/+|\/+$/g, "")}` : "";

let origin = "";
try {
  origin = new URL((process.env.SITE_URL ?? "").trim()).origin;
} catch {
  origin = "";
}

if (!base) {
  console.log("rewrite-pages-base: root-based deployment (BASE_PATH empty), nothing to rewrite.");
  process.exit(0);
}

const kinds = new Map();
const bump = (kind) => kinds.set(kind, (kinds.get(kind) ?? 0) + 1);

const hasBase = (value) =>
  value === base || value.startsWith(`${base}/`) || value.startsWith(`${base}?`) || value.startsWith(`${base}#`);

/** Site-internal path: `/works/`, `/media/x.webp`, `/#anchor`, `/universe/?focus=x`.
 * Query and fragment may carry anything; the path itself must be URL-path only. */
const isRootPath = (value) => {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  const [path] = value.split(/[?#]/);
  return /^[A-Za-z0-9._~/-]*$/.test(path);
};

/** Returns the rebased value, or the input unchanged when it is external,
 * already based, or not a path. `rootAlone` keeps bare "/" untouched in JS,
 * where site-search.js compares it as a keyboard shortcut. */
function rewriteValue(value, { rootAlone }) {
  if (isRootPath(value) && !hasBase(value)) {
    if (value === "/" && !rootAlone) return value;
    bump("path prefix");
    return base + value;
  }
  if (origin && value.startsWith(origin)) {
    const rest = value.slice(origin.length);
    if ((rest === "" || /^[/?#]/.test(rest)) && !hasBase(rest)) {
      bump("absolute rebase");
      return `${origin}${base}${rest}`;
    }
  }
  return value;
}

/** Quoted literals: HTML/JSON attribute values, JS strings, inline JSON records. */
function rewriteLiterals(text, rootAlone) {
  return text.replace(/(["'`])(\/[^"'`\s]*)\1/g, (whole, quote, value) => {
    const next = rewriteValue(value, { rootAlone });
    return next === value ? whole : `${quote}${next}${quote}`;
  });
}

/** CSS url() references, in stylesheets and inline style attributes. */
function rewriteCssUrls(text) {
  return text.replace(/url\(\s*(["']?)(\/[^"')\s]+)\1\s*\)/gi, (whole, quote, value) => {
    const next = rewriteValue(value, { rootAlone: true });
    return next === value ? whole : `url(${quote}${next}${quote})`;
  });
}

/** <meta http-equiv="refresh" content="0;url=/projects/metavyatka/"> */
function rewriteMetaRefresh(text) {
  return text.replace(/(\bcontent\s*=\s*["'][^"']*?\burl=)([^"'\s;]+)(["'])/gi, (whole, head, value, tail) => {
    const next = rewriteValue(value, { rootAlone: true });
    return next === value ? whole : `${head}${next}${tail}`;
  });
}

/** Unquoted same-origin absolute URLs (sitemap <loc> entries). */
function rewriteBareOrigin(text) {
  if (!origin) return text;
  const pattern = new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/[^\\s"'<>]*)`, "g");
  return text.replace(pattern, (whole, rest) => {
    const next = rewriteValue(`${origin}${rest}`, { rootAlone: true });
    return next === whole ? whole : next;
  });
}

/** robots.txt must advertise the preview sitemap, not the production one. */
const rewriteRobots = (text) =>
  text.replace(/^(\s*Sitemap:\s*)\S+\s*$/gim, (whole, head) => `${head}${origin}${base}/sitemap.xml`);

const TEXT_EXTENSIONS = new Set([".html", ".htm", ".svg", ".js", ".mjs", ".css", ".json", ".webmanifest", ".xml"]);
let scanned = 0;
let rewritten = 0;

function processFile(full) {
  const file = relative(distDir, full).replace(/\\/g, "/");
  const ext = extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && file !== "robots.txt") return;
  scanned += 1;
  const before = readFileSync(full, "utf8");
  let after = before;

  if (ext === ".html" || ext === ".htm" || ext === ".svg") {
    after = rewriteBareOrigin(rewriteCssUrls(rewriteLiterals(rewriteMetaRefresh(before), true)));
  } else if (ext === ".js" || ext === ".mjs") {
    after = rewriteBareOrigin(rewriteCssUrls(rewriteLiterals(before, false)));
  } else if (ext === ".css") {
    after = rewriteCssUrls(before);
  } else if (ext === ".json" || ext === ".webmanifest") {
    after = rewriteLiterals(before, true);
    try {
      JSON.parse(after);
    } catch (error) {
      console.error(`rewrite-pages-base: ${file} is no longer valid JSON after rewriting: ${error.message}`);
      process.exit(1);
    }
  } else if (ext === ".xml") {
    after = rewriteBareOrigin(before);
  } else if (file === "robots.txt") {
    after = rewriteRobots(before);
  }

  if (after !== before) {
    writeFileSync(full, after);
    rewritten += 1;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name));
    else processFile(join(dir, entry.name));
  }
}

walk(distDir);

for (const [kind, count] of kinds) console.log(`rewrite-pages-base: ${kind}: ${count}`);
console.log(`rewrite-pages-base: ${rewritten} of ${scanned} file(s) rewritten under ${base}.`);
