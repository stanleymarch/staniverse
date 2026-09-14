import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, scoreEntry, searchEntries } from "../public/scripts/site-search.js";

const entry = (overrides = {}) => ({
  t: "Теледильдоника как вершина IoT-эволюции",
  k: "Telegram-пост",
  h: "/garden/telegram/tg-985/",
  s: "Зашёл тут в vr.раздечат.ком…",
  p: "iot · интим и близость · xr",
  d: "2026-03-01",
  x: "Плюс IoT-слой. Там же крутится какая-то хитрая связка с API для устройств Lovense, которая конвертирует внутреннюю валюту в механическую работу поршня.",
  ...overrides,
});

test("tokenize folds case, ё and punctuation and deduplicates", () => {
  assert.deepEqual(tokenize("Ёлка, ёлка; Lovense-API!"), ["елка", "lovense", "api"]);
  assert.deepEqual(tokenize(""), []);
});

test("scoreEntry requires every token somewhere (AND semantics)", () => {
  assert.notEqual(scoreEntry(entry(), ["lovense"]), null);
  assert.equal(scoreEntry(entry(), ["lovense", "вятка"]), null);
});

test("title hits outrank body-only hits for the same token", () => {
  const titleHit = scoreEntry(entry(), ["теледильдоника"]);
  const bodyOnly = scoreEntry(entry(), ["поршня"]);
  assert.ok(typeof titleHit === "number" && typeof bodyOnly === "number" && titleHit > bodyOnly);
});

test("searchEntries ranks the matching entry and returns a snippet around the hit", () => {
  const results = searchEntries([entry(), entry({ t: "Другое", x: "Просто текст про города", p: "", h: "/garden/telegram/tg-3/" })], "Lovense");
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.h, "/garden/telegram/tg-985/");
  assert.ok(results[0].snippet.includes("Lovense"));
});

test("queries with no usable tokens return nothing", () => {
  assert.deepEqual(searchEntries([entry()], "—?!"), []);
});
