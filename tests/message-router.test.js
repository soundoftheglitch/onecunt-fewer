"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../search/message-router.js");

test("routes exact public message names and normalizes sync and async handlers", async () => {
  const route = create({
    "fewercunts-search:sync": message => message.value + 1,
    "fewercunts-search:async": async message => message.value + 2
  });
  assert.equal(await route({ type: "fewercunts-search:sync", value: 2 }), 3);
  assert.equal(await route({ type: "fewercunts-search:async", value: 2 }), 4);
});

test("ignores unrelated messages and fails closed for unknown or throwing search operations", async () => {
  const route = create({ "fewercunts-search:fail": () => { throw new Error("failure"); } });
  assert.equal(route({ type: "other" }), null);
  await assert.rejects(route({ type: "fewercunts-search:missing" }), /Unknown search operation/);
  await assert.rejects(route({ type: "fewercunts-search:fail" }), /failure/);
});

test("rejects malformed handler tables at composition time", () => {
  assert.throws(() => create({ invalid: () => null }), /Invalid search route/);
  assert.throws(() => create({ "fewercunts-search:bad": true }), /Invalid search route/);
});
