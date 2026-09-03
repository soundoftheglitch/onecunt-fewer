"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { bytes } = require("../search/ui-elements.js");

test("storage sizes remain bounded and human readable", () => {
  assert.equal(bytes(Number.NaN), "storage unavailable");
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(1536), "1.5 KiB");
  assert.equal(bytes(2 * 1024 * 1024), "2.0 MiB");
});
