// One-off data repair for the Telegram import (2026-09-19):
//  1. Captionless photo albums got the robotic title "Медиапубликация · <date>"
//     and summary "Публикация без текстовой подписи; … медиафайлов: N." — rewrite
//     to human phrasing ("Фотографии · <date>" / "Фотоальбом · N снимков.").
//  2. Import markers <!--telegram-media:…--> leaked into two summaries; strip
//     both complete comments and importer-truncated marker tails.
// Idempotent: re-running matches nothing after the first pass.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = join(process.cwd(), "src/content/publications/telegram");
const files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
let retitled = 0;
let resummarized = 0;
let unmarked = 0;

for (const name of files) {
  const path = join(dir, name);
  const source = await readFile(path, "utf8");
  let text = source;

  const titleMatch = text.match(/^title: "Медиапубликация · ([^"]+)"$/m);
  if (titleMatch) {
    text = text.replace(titleMatch[0], `title: "Фотографии · ${titleMatch[1]}"`);
    retitled += 1;
  }

  const summaryAlbum = text.match(/^summary: "Публикация без текстовой подписи; в архиве сохранено медиафайлов: (\d+)\."$/m);
  if (summaryAlbum) {
    text = text.replace(summaryAlbum[0], `summary: "Фотоальбом · ${summaryAlbum[1]} снимков без подписи."`);
    resummarized += 1;
  }

  if (/^summary: ".*<!--/m.test(text)) {
    text = text.replace(/^(summary: ")([^"]*)(")$/m, (_all, open, body, close) => {
      const cleaned = body
        .replace(/<!--telegram-media:[\s\S]*$/g, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/ […]$/u, "…");
      return `${open}${cleaned}${close}`;
    });
    unmarked += 1;
  }

  if (text !== source) await writeFile(path, text, "utf8");
}

console.log(`titles: ${retitled}, album summaries: ${resummarized}, markers stripped: ${unmarked}, scanned: ${files.length}`);
