import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A Telegram album materializes as one publication, anchored on the message that carries
 * the caption; the other members never get a page of their own. Their former routes stay
 * alive here, pointing at the album's page.
 *
 * The absorbed ids come from the materialized frontmatter itself (`sourceId` and
 * `threadIds`), so this map follows the content rather than a hand-written list: an id
 * that gains its own page is dropped, an id that loses one is redirected. Redirecting an
 * id that never had a public page costs one harmless hop.
 */
export function publicationRedirects(contentRoot = "src/content/publications/telegram"): Record<string, string> {
  const files = readdirSync(contentRoot).filter((name) => /^tg-\d+\.md$/.test(name));
  const published = new Set(files.map((name) => name.slice(3, -3)));
  const redirects: Record<string, string> = {};
  for (const name of files) {
    const sourceId = name.slice(3, -3);
    const threadIds = readFileSync(join(contentRoot, name), "utf8").match(/^threadIds:\s*\[(.*?)\]\s*$/m)?.[1] ?? "";
    for (const match of threadIds.matchAll(/"(\d+)"/g)) {
      const id = match[1];
      if (id === sourceId || published.has(id)) continue;
      redirects[`garden/telegram/tg-${id}`] = `/garden/telegram/tg-${sourceId}/`;
    }
  }
  return redirects;
}
