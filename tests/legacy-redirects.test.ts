import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyRedirects } from "../src/lib/legacy-redirects";

const TELEGRAM_ROOT = "src/content/publications/telegram";
const telegramFiles = readdirSync(TELEGRAM_ROOT).filter((name) => /^tg-\d+\.md$/.test(name));
const telegramPages = new Set(telegramFiles.map((name) => name.slice(3, -3)));
const telegramThreads = telegramFiles.map((name) => ({
  sourceId: name.slice(3, -3),
  threadIds: [...(readFileSync(join(TELEGRAM_ROOT, name), "utf8").match(/^threadIds:\s*\[(.*?)\]\s*$/m)?.[1] ?? "").matchAll(/"(\d+)"/g)].map((match) => match[1]),
}));

/** Works merged into another entity keep both their Quartz alias and their own work URL. */
const MERGED_WORK_REDIRECTS = {
  "works/cases/avtomaticheskiy-kanal-dlya-proekta-chertezhi": "/works/chertezhi-tekhdiplomy/",
  "works/avtomaticheskiy-kanal-dlya-proekta-chertezhi": "/works/chertezhi-tekhdiplomy/",
  "works/cases/prodakshn-dlya-staniverse": "/projects/staniverse/",
  "works/prodakshn-dlya-staniverse": "/projects/staniverse/",
};

const REMOVED_WORK_ROUTES = ["/works/avtomaticheskiy-kanal-dlya-proekta-chertezhi/", "/works/prodakshn-dlya-staniverse/"];

test("former URLs of merged works redirect to the entity that absorbed them", () => {
  for (const [from, to] of Object.entries(MERGED_WORK_REDIRECTS)) assert.equal(legacyRedirects.get(from), to, from);
});

test("no legacy URL still redirects to a removed work route", () => {
  for (const [from, to] of legacyRedirects) assert.ok(!REMOVED_WORK_ROUTES.includes(to), `${from} -> ${to}`);
});

test("every legacy redirect into the catalogue lands on a published entry", () => {
  const published = new Set(["works", "projects", "articles"].flatMap((section) =>
    readdirSync(`src/content/${section}`).filter((name) => name.endsWith(".md")).map((name) => `${section}/${name.slice(0, -3)}`)));
  const catalogueRedirects = [...legacyRedirects].flatMap(([from, to]) => {
    const match = to.match(/^\/(works|projects|articles)\/([^/?#]+)\/$/);
    return match ? [[from, to, `${match[1]}/${match[2]}`] as const] : [];
  });
  assert.ok(catalogueRedirects.length > 30, `only ${catalogueRedirects.length} catalogue redirects checked`);
  for (const [from, to, target] of catalogueRedirects) assert.ok(published.has(target), `${from} -> ${to}`);
});

test("every Telegram id absorbed by an album keeps a route to its album page", () => {
  const absorbed = telegramThreads.flatMap(({ sourceId, threadIds }) =>
    threadIds.filter((id) => id !== sourceId).map((id) => [id, sourceId] as const));
  assert.ok(absorbed.length > 100, `only ${absorbed.length} absorbed ids checked`);
  for (const [id, sourceId] of absorbed) {
    if (telegramPages.has(id)) continue;
    assert.equal(legacyRedirects.get(`garden/telegram/tg-${id}`), `/garden/telegram/tg-${sourceId}/`, `tg-${id}`);
  }
});

test("every Telegram publication redirect lands on a published page", () => {
  const telegramRedirects = [...legacyRedirects].filter(([from]) => from.startsWith("garden/telegram/tg-"));
  assert.ok(telegramRedirects.length > 200, `only ${telegramRedirects.length} publication redirects checked`);
  for (const [from, to] of telegramRedirects) {
    const target = to.match(/^\/garden\/telegram\/tg-(\d+)\/$/)?.[1];
    assert.ok(target, `${from} -> ${to}`);
    assert.ok(telegramPages.has(target!), `${from} -> ${to} is not a published page`);
    assert.notEqual(target, from.slice("garden/telegram/tg-".length), `${from} redirects to itself`);
  }
});

test("the tg-326 album publishes its images once under the caption message", () => {
  const album = telegramThreads.find((entry) => entry.sourceId === "326");
  assert.deepEqual(album?.threadIds, ["326", "327", "328", "329", "330"]);
  for (const id of ["327", "328", "329", "330"]) {
    assert.equal(telegramPages.has(id), false, `tg-${id} must not be its own publication`);
    assert.equal(legacyRedirects.get(`garden/telegram/tg-${id}`), "/garden/telegram/tg-326/");
  }
});
