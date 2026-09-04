"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const about = require("../about-content.js");

test("bundles a complete private-by-design Readme and patch release history", () => {
  assert.ok(about.README.length >= 5);
  const text = about.README.flatMap(section => [section.heading, ...section.paragraphs]).join(" ");
  for (const phrase of ["Block list", "signed compact forum index", "browser history", "Settings export", "Firefox"]) {
    assert.match(text, new RegExp(phrase, "i"));
  }
  assert.equal(about.HISTORY[0][0], require("../manifest.json").version);
  assert.deepEqual(about.HISTORY.map(entry => entry[0]), ["4.5.2", "4.5.1", "4.5.0"]);
  assert.ok(about.HISTORY.every(entry => entry.length === 3 && entry.every(Boolean)));
});
