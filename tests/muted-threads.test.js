"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const muted = require("../search/muted-threads.js");

test("muted-thread metadata is bounded, canonical and contains no post body or contact fields", () => {
  const value = muted.normalise({ threadId: 42, title: "x".repeat(400), username: " Alice ",
    canonicalUrl: "https://ntforum.net/thread/42", body: "secret", email: "secret@example.test" }, () => "2026-09-01Z");
  assert.deepEqual(Object.keys(value).sort(), ["canonicalUrl", "docKey", "mutedUtc", "threadId", "title", "username"]);
  assert.equal(value.title.length, 300); assert.equal(value.username, "Alice"); assert.equal(value.docKey, "t:42");
  assert.throws(() => muted.normalise({ threadId: 42, canonicalUrl: "https://ntforum.net/thread/43" }), /same NTForum thread/);
  assert.throws(() => muted.normalise({ threadId: 0 }), /valid thread/);
  assert.throws(() => muted.normalise({ threadId: 42, mutedUtc: "not-a-date" }), /time is invalid/);
  assert.throws(() => muted.normalise({ threadId: 42, title: "bad\u0000title" }), /control characters/);
  assert.equal(muted.MAX_RECORDS, 2000);
});

test("presentation filtering never mutates or deletes read, saved or notification records", () => {
  const records = [{ threadId: 1, state: "read" }, { threadId: 2, state: "saved" }];
  assert.deepEqual(muted.visibleRecords(records, [1]), [records[1]]);
  assert.deepEqual(muted.visibleRecords(records, [1], true), records);
  assert.deepEqual(records, [{ threadId: 1, state: "read" }, { threadId: 2, state: "saved" }]);
});
