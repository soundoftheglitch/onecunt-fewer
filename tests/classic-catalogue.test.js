"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const indexer = require("../search/indexer.js");

const root = (id, title, username, lastPostUtc, replies = 0) => ({ kind: "t", docKey: `t:${id}`,
  threadId: id, title, username, body: `body ${id}`, createdUtc: "2026-01-01T00:00:00Z",
  lastPostUtc, replyCount: replies });

test("classic catalogue overlays recent roots and tombstones before true paging", () => {
  const base = [root(1, "Old", "Alice", "2026-08-01T00:00:00Z"), root(2, "Changed", "Bob", "2026-08-02T00:00:00Z"), root(3, "Deleted", "Cara", "2026-08-03T00:00:00Z")];
  const delta = [root(2, "Changed today", "Bob", "2026-09-01T10:00:00Z", 9), root(4, "New", "Dana", "2026-09-01T09:00:00Z")];
  assert.deepEqual(indexer.selectClassicThreads(base, delta, [3], "datedesc", 0, 2), {
    total: 3, items: [
      { threadId: 2, title: "Changed today", username: "Bob", body: "body 2", createdUtc: "2026-01-01T00:00:00Z", lastPostUtc: "2026-09-01T10:00:00Z", replyCount: 9, canonicalUrl: "https://ntforum.net/thread/2" },
      { threadId: 4, title: "New", username: "Dana", body: "body 4", createdUtc: "2026-01-01T00:00:00Z", lastPostUtc: "2026-09-01T09:00:00Z", replyCount: 0, canonicalUrl: "https://ntforum.net/thread/4" }
    ]
  });
  assert.equal(indexer.selectClassicThreads(base, delta, [3], "datedesc", 2, 2).items[0].threadId, 1);
});

test("classic catalogue honors all native sort directions", () => {
  const rows = [root(1, "Zulu", "bob", "2026-08-01T00:00:00Z", 4), root(2, "Alpha", "Alice", "2026-08-02T00:00:00Z", 1)];
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "subject", 0, 10).items.map(item => item.threadId), [2, 1]);
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "subjectdesc", 0, 10).items.map(item => item.threadId), [1, 2]);
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "size", 0, 10).items.map(item => item.threadId), [2, 1]);
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "sizedesc", 0, 10).items.map(item => item.threadId), [1, 2]);
});

test("classic latest view pins the real Welcome to godMode thread without duplicate pages", () => {
  const rows = [
    root(1, "Old", "Alice", "2026-08-29T00:00:00Z"),
    root(15249, "Welcome to godMode", "dog hat", "2026-08-30T00:00:00Z"),
    root(3, "Newest", "Bob", "2026-08-31T00:00:00Z")
  ];
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "datedesc", 0, 2).items.map(item => item.threadId), [15249, 3]);
  assert.deepEqual(indexer.selectClassicThreads(rows, [], [], "datedesc", 2, 2).items.map(item => item.threadId), [1]);
});

test("username suggestions are local, prefix-first, unique, bounded and omit blocked users", () => {
  const base = [
    { username: "Alice" }, { username: "alice" }, { username: "Alison" },
    { username: "Bob" }, { username: "Soulisdead" }, { username: "Álvaro" }
  ];
  const delta = [{ username: "Albatross" }, { username: "ALICE" }, { username: "Alex" }];
  assert.deepEqual(indexer.selectUsernames(base, delta, "al", ["Alison", "soulisdead"], 20),
    ["Albatross", "Alex", "Alice", "Álvaro"]);
  assert.deepEqual(indexer.selectUsernames(base, delta, "", ["Bob"], 2), ["Albatross", "Alex"]);
  assert.deepEqual(indexer.selectUsernames(base, delta, "nobody", [], 20), []);
});
