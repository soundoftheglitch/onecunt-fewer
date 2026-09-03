"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { termsFromQuery } = require("../navigation-highlight.js");

test("highlight terms preserve phrases, prefixes and safe visible fields", () => {
  assert.deepEqual(termsFromQuery('body:"slow craft" title:artis* user:Alice email:secret@example.test'), [
    { value: "slow craft", prefix: false },
    { value: "artis", prefix: true },
    { value: "Alice", prefix: false }
  ]);
});

test("highlight terms are bounded and deduplicated case-insensitively", () => {
  assert.deepEqual(termsFromQuery("GTA gta a x*"), [{ value: "GTA", prefix: false }]);
  assert.equal(termsFromQuery(Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ")).length, 16);
});
