"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fingerprint, item, MAX_RECORDS } = require("../search/read-state.js");
const fs = require("node:fs");
const path = require("node:path");

const document = (key = "r:2", overrides = {}) => ({ docKey: key, threadId: 1, postId: Number(key.split(":")[1]),
  parentPostId: 1, kind: key[0], username: "allowed", title: "Thread", body: "body",
  createdUtc: "2026-09-01T10:00:00Z", canonicalUrl: `https://ntforum.net/thread/1/reply/${key.split(":")[1]}`, ...overrides });

test("fingerprints reopen edited and reparented replies without depending on browser history", () => {
  const original = document();
  assert.notEqual(fingerprint(original), fingerprint({ ...original, body: "edited" }));
  assert.notEqual(fingerprint(original), fingerprint({ ...original, parentPostId: 99 }));
  assert.equal(fingerprint(original), fingerprint({ ...original, fetchedUtc: "later" }));
});

test("read-list items preserve exact nested navigation identity and safe snippets", () => {
  const value = item(document("r:42", { body: " hello\n  world ", parentPostId: 7 }), true);
  assert.deepEqual({ docKey: value.docKey, threadId: value.threadId, postId: value.postId,
    parentPostId: value.parentPostId, unread: value.unread },
  { docKey: "r:42", threadId: 1, postId: 42, parentPostId: 7, unread: true });
  assert.equal(value.snippet, "hello world");
  assert.equal(MAX_RECORDS, 5000);
});

test("semantic unread styling overrides browser-history visited colour", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "starting.css"), "utf8");
  assert.match(css, /a\.link-text\.fewercunts-unread:visited\s*\{\s*color:\s*var\(--secondary-accent-color\)\s*!important/);
  const ui = fs.readFileSync(path.join(__dirname, "..", "search", "ui.js"), "utf8");
  assert.match(ui, /querySelectorAll\("\[data-fewercunts-doc-key\], a\[href\*='\/thread\/'\]"\)/,
    "native, Search, Unloved, Saved and author thread links must share semantic decoration");
  assert.match(ui, /unreadThreads\.get\(threadId\)/,
    "thread links must derive their state from every visible document in the thread");
  assert.match(ui, /const isReplyLink = Boolean\(match\?\.\[2\] \|\| String\(docKey\)\.startsWith\("r:"\)\);/,
    "reply detection must be resolved before choosing per-document or whole-thread unread state");
  assert.match(ui, /let count = isReplyLink \? Number\(unreadDocuments\.has\(docKey\)\) : Number\(unreadThreads\.get\(threadId\) \|\| 0\);/,
    "thread links must not be mistaken for individual root-document links");
});

test("forum-wide unread reset is explicit, local and feeds the shared decoration summary", () => {
  const repository = fs.readFileSync(path.join(__dirname, "..", "search", "read-state.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "search", "ui.js"), "utf8");
  assert.match(repository, /async markAllUnread\(docKeys = \[\]\)/);
  assert.match(repository, /name: "forceUnread", enabled: true/);
  assert.match(repository, /async upsert\(documents\)/);
  assert.match(repository, /readFingerprint: null/);
  assert.match(background, /fewercunts-search:mark-all-unread/);
  assert.match(background, /readState\.markAllUnread\(\[\.\.\.summary\.unreadDocKeys, \.\.\.summary\.readDocKeys\]\)/);
  assert.match(background, /materializeReadDocuments/);
  assert.match(ui, /\["Mark forum unread"/);
  assert.match(ui, /confirm\(`Mark all \$\{indexed\} currently indexed visible forum/);
  assert.match(ui, /type: "fewercunts-search:mark-all-unread", confirmed: true/);
  assert.match(ui, /unreadSummary = result; decorateUnread\(\)/);
  assert.match(ui, /No visible indexed forum activity is available to mark unread\./);
});
