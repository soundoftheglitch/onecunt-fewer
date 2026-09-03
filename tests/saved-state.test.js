"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalise, MAX_RECORDS } = require("../search/saved-state.js");

test("saved records contain only bounded public thread metadata", () => {
  const record = normalise({ threadId: 42, title: " Thread ", username: "alice", body: "secret",
    email: "private@example.invalid", canonicalUrl: "https://ntforum.net/thread/42/reply/99" }, () => "2026-09-01T00:00:00Z");
  assert.deepEqual(record, { threadId: 42, docKey: "t:42", title: "Thread", username: "alice", createdUtc: "",
    canonicalUrl: "https://ntforum.net/thread/42", savedUtc: "2026-09-01T00:00:00Z" });
  assert.equal(MAX_RECORDS, 2000);
});

test("saved records reject invalid IDs and external URLs", () => {
  assert.throws(() => normalise({ threadId: 0 }), /valid thread/);
  assert.throws(() => normalise({ threadId: 1, canonicalUrl: "https://example.com/thread/1" }), /NTForum/);
});
