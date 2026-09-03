"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("the extension never handles or relays login passwords", () => {
  const ui = fs.readFileSync(path.join(root, "search/ui.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const packaged = `${ui}\n${main}`;

  assert.doesNotMatch(packaged, /fewercunts:account-action/);
  assert.doesNotMatch(packaged, /current-password/);
  assert.doesNotMatch(packaged, /accountLogin\s*\(/);
  assert.doesNotMatch(packaged, /\.service\(\)\.login\s*\(/);
  assert.doesNotMatch(packaged, /detail\.password/);
  assert.doesNotMatch(packaged, /authorization\s*:/i);
  assert.doesNotMatch(packaged, /document\.cookie/i);
  assert.doesNotMatch(packaged, /chrome\.cookies|browser\.cookies/);
  assert.doesNotMatch(packaged, /fewercunts:draft-(?:request|result)/);
});
