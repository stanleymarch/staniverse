import test from "node:test";
import assert from "node:assert/strict";
import { decisionFrom, serializeDecision } from "../public/scripts/consent.js";

test("analytics consent stores only explicit versioned decisions", () => {
  assert.equal(decisionFrom(null), null);
  assert.equal(decisionFrom("broken"), null);
  assert.equal(decisionFrom('{"v":1,"decision":"unknown"}'), null);
  assert.equal(decisionFrom('{"v":2,"decision":"granted"}'), null);
  assert.equal(decisionFrom('{"v":1,"decision":"granted"}'), "granted");
  assert.equal(decisionFrom('{"v":1,"decision":"denied"}'), "denied");
});

test("analytics consent serialization is deterministic and inspectable", () => {
  const stored = serializeDecision("granted", new Date("2026-09-18T10:00:00.000Z"));
  assert.deepEqual(JSON.parse(stored), {
    v: 1,
    decision: "granted",
    at: "2026-09-18T10:00:00.000Z",
  });
});
