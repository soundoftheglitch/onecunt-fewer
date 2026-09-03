"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const block = require("../search/block-list.js");

test("block-list validation is bounded, Unicode-normalised, case-insensitive and permits empty", () => {
  assert.deepEqual(block.validate([" Soulisdead ", "Ｓｏｕｌｉｓｄｅａｄ", "Alice"]), ["Soulisdead", "Alice"]);
  assert.deepEqual(block.validate([]), []);
  assert.throws(() => block.validate(["line\nbreak"]), /visible characters/);
  assert.throws(() => block.validate(Array.from({ length: 65 }, (_, index) => `user${index}`)), /Invalid/);
  assert.throws(() => block.validate(["x".repeat(65)]), /1–64/);
});

test("visible documents remove blocked roots, replies and complete descendant subtrees", () => {
  const documents = [
    { docKey: "t:1", username: "Alice", parentPostId: null },
    { docKey: "r:2", username: "Blocked", parentPostId: null },
    { docKey: "r:3", username: "Innocent", parentPostId: 2 },
    { docKey: "r:4", username: "Visible", parentPostId: null },
  ];
  assert.deepEqual(block.visibleDocuments(documents, [" blocked "]).map(item => item.docKey), ["t:1", "r:4"]);
  assert.deepEqual(block.visibleDocuments(documents, []).map(item => item.docKey), ["t:1", "r:2", "r:3", "r:4"]);
});
