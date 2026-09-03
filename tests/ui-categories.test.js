"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isReviewer } = require("../search/ui-categories.js");

test("category review presentation is identity-labelled but not an authorization boundary", () => {
  assert.equal(isReviewer(" dog hat "), true);
  assert.equal(isReviewer("DOG HAT"), true);
  assert.equal(isReviewer("other"), false);
});
