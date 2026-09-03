"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pageNumber } = require("../search/ui-unloved.js");

test("Unloved page numbers fail safely to the first page", () => {
  assert.equal(pageNumber(3), 3);
  assert.equal(pageNumber("4"), 4);
  for (const value of [0, -1, 1.5, "bad", null]) assert.equal(pageNumber(value), 1);
});
