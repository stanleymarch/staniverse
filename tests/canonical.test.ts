import assert from "node:assert/strict";
import test from "node:test";
import { isCommissionedWork } from "../src/lib/canonical";

function work(client?: string) {
  return { data: { client } } as Parameters<typeof isCommissionedWork>[0];
}

test("owned project chapters do not enter commissioned work", () => {
  assert.equal(isCommissionedWork(work("Проект: Staniverse")), false);
  assert.equal(isCommissionedWork(work("Проект: я.ты.город")), false);
  assert.equal(isCommissionedWork(work("Проект:")), false);
});

test("external clients remain commissioned work", () => {
  assert.equal(isCommissionedWork(work("ВятГУ")), true);
  assert.equal(isCommissionedWork(work("Антон Окулов")), true);
  assert.equal(isCommissionedWork(work("ArtMasters")), true);
});
