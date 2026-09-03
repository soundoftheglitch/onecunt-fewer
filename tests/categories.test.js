const test = require("node:test");
const assert = require("node:assert/strict");
const categories = require("../search/categories.js");

test("sports use bare women-first categories and never contain a womens suffix", () => {
  const values = categories.TAXONOMY.flat();
  assert.equal(values.some(value => /women/i.test(value)), false);
  assert.equal(categories.resolve("Sports › Football"), "sports/football");
  assert.equal(categories.resolve("Sports › Football › Men's"), "sports/football/mens");
  assert.equal(categories.resolve("sports/tennis/mixed"), "sports/tennis/mixed");
});

test("unknown categories and malformed document keys fail closed", () => {
  assert.equal(categories.resolve("sports/football/womens"), null);
  assert.equal(categories.validDocKey("t:1"), true);
  assert.equal(categories.validDocKey("r:99"), true);
  assert.equal(categories.validDocKey("reply:99"), false);
});
