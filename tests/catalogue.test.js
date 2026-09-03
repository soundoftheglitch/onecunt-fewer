"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const catalogue = require("../search/catalogue.js");

const root = (id, username = "Alice", replies = 0) => ({ kind: "t", docKey: `t:${id}`, threadId: id,
  username, title: `Thread ${id}`, createdUtc: "2026-01-01T00:00:00Z", replyCount: replies });

test("one catalogue projection applies delta replacement, tombstones and canonical URLs", () => {
  const value = catalogue.project([root(1), root(2), root(3)], [root(2, "Bob", 4), root(4)], [3], {});
  assert.deepEqual(value.roots.map(item => item.threadId), [1, 2, 4]);
  assert.equal(value.roots.find(item => item.threadId === 2).replyCount, 4);
  assert.equal(value.roots.find(item => item.threadId === 4).canonicalUrl, "https://ntforum.net/thread/4");
});

test("the shared projection applies normalized block and mute visibility without mutating roots", () => {
  const value = catalogue.project([root(1, "Álice"), root(2, "Bob"), root(3, "Cara")], [], [], {
    blockedUsernames: ["alice"], mutedThreadIds: [2], revealHidden: false
  });
  assert.deepEqual(value.visible.map(item => item.threadId), [3]);
  assert.deepEqual(value.roots.map(item => item.threadId), [1, 2, 3]);
  assert.deepEqual(catalogue.visibleRoots(value.roots, ["alice"], [2], true).map(item => item.threadId), [1, 2, 3]);
});
