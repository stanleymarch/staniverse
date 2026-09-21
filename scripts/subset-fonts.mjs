/**
 * Re-encodes the self-hosted faces in the built `dist/fonts/` for the characters
 * this build actually renders, and narrows each variable font's `wght` axis to
 * the range its `@font-face` already declares.
 *
 * Why here rather than in `public/fonts/`: the character set depends on content,
 * and content changes with every post. Scanning the finished artifact means a new
 * Telegram post, article or English page that introduces a character (an en dash,
 * a currency sign, an accented name) automatically widens the subset on the next
 * build — nothing to regenerate by hand. The masters in `public/fonts/` stay
 * untouched, so `astro dev` keeps serving complete faces.
 *
 * Both languages are covered by construction: the set is the union over every
 * built page, and it is closed under case mapping because the stylesheets
 * uppercase labels the corpus may only contain in lower case.
 *
 * Usage: node scripts/subset-fonts.mjs [distDir]   (runs from `npm run build`)
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? process.env.DIST_DIR ?? "dist");
const sourceDir = resolve(process.env.FONT_SOURCE_DIR ?? "public/fonts");
const cssPath = resolve("src/styles/global.css");

/** Faces are read from the stylesheet so the axis range can never drift from it. */
async function facesFromCss() {
  const css = await readFile(cssPath, "utf8");
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap(([, body]) => {
    const name = /url\("(?:\/fonts\/)?([^"/]+\.woff2)"\)/.exec(body)?.[1];
    const weight = /font-weight:\s*([\d.]+)(?:\s+([\d.]+))?/.exec(body);
    if (!name || !weight) return [];
    return [{
      name,
      family: /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? "?",
      axis: { min: Number(weight[1]), max: Number(weight[2] ?? weight[1]) },
    }];
  });
}

/** Characters every built page can put on screen: markup, feeds, API payloads and
 * the stylesheets/scripts that may generate glyphs via `content` or insert text. */
async function renderedText(dir) {
  const characters = new Set();
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(html|json|xml|css|js|mjs)$/.test(entry.name)) continue;
      for (const character of await readFile(full, "utf8")) characters.add(character);
    }
  };
  await walk(dir);
  /* Uppercasing a label and lowercasing a brand are stylesheet decisions: the
     corpus may hold one case while the page renders the other. */
  const needed = new Set();
  for (const character of characters) {
    needed.add(character);
    for (const mapped of [character.toUpperCase(), character.toLowerCase()]) {
      if (mapped.length === 1) needed.add(mapped);
    }
  }
  for (let code = 0x20; code <= 0x7e; code += 1) needed.add(String.fromCodePoint(code));
  needed.add("\u00A0");
  return [...needed].join("");
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}K`;
const relativeToCwd = (path) => {
  const shown = relative(process.cwd(), path);
  return !shown || shown.startsWith("..") ? path : shown;
};

const { default: subsetFont } = await import("subset-font");
const faces = await facesFromCss();
if (faces.length === 0) {
  console.warn("subset-fonts: no @font-face rules found in src/styles/global.css; keeping fonts as built.");
  process.exit(0);
}
const text = await renderedText(distDir);
const distinct = new Set(text).size;

let before = 0;
let after = 0;
for (const face of faces) {
  const source = await readFile(join(sourceDir, face.name));
  before += source.length;
  let subset;
  try {
    subset = await subsetFont(source, text, {
      targetFormat: "woff2",
      variationAxes: { wght: { min: face.axis.min, max: face.axis.max } },
    });
  } catch (error) {
    console.warn(`subset-fonts: ${face.name} failed (${error.message}); keeping the built file.`);
    after += source.length;
    continue;
  }
  /* A subset that grows or empties means the encoder disagreed with the master:
     ship the master rather than a font that might miss a glyph. */
  if (subset.length === 0 || subset.length >= source.length) {
    console.warn(`subset-fonts: ${face.name} did not shrink (${kb(source.length)} → ${kb(subset.length)}); keeping the built file.`);
    after += source.length;
    continue;
  }
  await writeFile(join(distDir, "fonts", face.name), subset);
  after += subset.length;
  console.log(`${face.name.padEnd(28)} ${kb(source.length).padStart(7)} → ${kb(subset.length).padStart(7)}  ${face.family} wght ${face.axis.min}–${face.axis.max}`);
}
console.log(`subset-fonts: ${faces.length} faces, ${distinct} characters from ${relativeToCwd(distDir)} — ${kb(before)} → ${kb(after)}`);
