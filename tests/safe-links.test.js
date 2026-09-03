"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const links = require("../safe-links.js");

test("linkifies bare and HTML HTTP links while preserving surrounding punctuation", () => {
  assert.deepEqual(links.parts('See https://example.com/path?q=1, then <a class="x" href="/thread/42">forum thread</a>.'), [
    { text: "See " }, { text: "https://example.com/path?q=1", href: "https://example.com/path?q=1" },
    { text: ", then " }, { text: "forum thread", href: "https://ntforum.net/thread/42" }, { text: "." }
  ]);
});

test("never promotes active or non-web schemes and emits no indexed markup", () => {
  assert.deepEqual(links.parts('<a href="javascript:alert(1)"><img src=x onerror=alert(2)>unsafe</a> <b>bold</b>'), [
    { text: "unsafe bold" }
  ]);
  assert.equal(links.safeHref("data:text/html,bad"), null);
  assert.equal(links.safeHref("file:///etc/passwd"), null);
});
