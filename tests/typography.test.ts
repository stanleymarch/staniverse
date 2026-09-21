import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutTrailingStop } from "../src/lib/typography";

test("display copy drops a closing sentence stop", () => {
  assert.equal(withoutTrailingStop("Делаю XR-пространства, архивы и медиа."), "Делаю XR-пространства, архивы и медиа");
  assert.equal(withoutTrailingStop("Первое предложение. И второе."), "Первое предложение. И второе");
  assert.equal(withoutTrailingStop("A space has a script, not only geometry."), "A space has a script, not only geometry");
});

test("a stop that closes an abbreviation or an ellipsis stays", () => {
  assert.equal(withoutTrailingStop("Плагины, модели и т. д."), "Плагины, модели и т. д.");
  assert.equal(withoutTrailingStop("Собираю данные сам и др."), "Собираю данные сам и др.");
  assert.equal(withoutTrailingStop("Смотри рис."), "Смотри рис.");
  assert.equal(withoutTrailingStop("Он сделал всё…"), "Он сделал всё…");
  assert.equal(withoutTrailingStop("Вариант Б."), "Вариант Б.");
});

test("text that ends without a stop is returned as is", () => {
  assert.equal(withoutTrailingStop("WebXR, Unity, Blender"), "WebXR, Unity, Blender");
  assert.equal(withoutTrailingStop("Маршрут по местам с картой и GPX."), "Маршрут по местам с картой и GPX");
  assert.equal(withoutTrailingStop(""), "");
});
