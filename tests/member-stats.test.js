"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MemberStatistics, normalise } = require("../search/member-stats.js");

const doc = (kind, username, createdUtc) => ({ kind, username, createdUtc });

test("aggregates case-insensitive identities with exact topic, reply and activity fields", () => {
  const stats = new MemberStatistics();
  stats.replaceThread(1, [doc("t", " Alice ", "2026-08-01T10:00:00Z"),
    doc("r", "ALICE", "2026-08-03T10:00:00Z"), doc("r", "Bob", "2026-08-02T10:00:00Z")]);
  stats.replaceThread(2, [doc("t", "Álice", "2026-08-04T10:00:00Z"),
    doc("r", "bob", "2026-08-05T10:00:00Z")]);
  assert.deepEqual(stats.snapshot(), [{ username: "bob", normalisedUsername: "bob", topicCount: 0, replyCount: 2,
    latestTopicUtc: "", latestReplyUtc: "2026-08-05T10:00:00Z", lastActiveUtc: "2026-08-05T10:00:00Z" },
  { username: "Álice", normalisedUsername: "alice", topicCount: 2, replyCount: 1,
    latestTopicUtc: "2026-08-04T10:00:00Z", latestReplyUtc: "2026-08-03T10:00:00Z",
    lastActiveUtc: "2026-08-04T10:00:00Z" }]);
  assert.equal(normalise(" Dög Hát "), "dog hat");
});

test("thread edits and deletions replace only affected contributions and blocked members stay filtered", () => {
  const stats = new MemberStatistics();
  stats.replaceThread(1, [doc("t", "Alice", "2026-08-01T00:00:00Z"), doc("r", "Bob", "2026-08-02T00:00:00Z")]);
  stats.replaceThread(2, [doc("t", "Alice", "2026-08-03T00:00:00Z")]);
  stats.replaceThread(1, [doc("t", "Carol", "2026-08-04T00:00:00Z")]);
  assert.deepEqual(stats.snapshot().map(value => [value.normalisedUsername, value.topicCount, value.replyCount]),
    [["carol", 1, 0], ["alice", 1, 0]]);
  assert.deepEqual(stats.snapshot([" CAROL "]).map(value => value.normalisedUsername), ["alice"]);
  stats.deleteThread(2); assert.deepEqual(stats.snapshot().map(value => value.normalisedUsername), ["carol"]);
});

test("a cloned persistent base accepts bounded delta overrides and tombstones without mutating the base", () => {
  const base = new MemberStatistics();
  base.replaceThread(1, [doc("t", "Alice", "2026-01-01T00:00:00Z"), doc("r", "Bob", "2026-01-02T00:00:00Z")]);
  base.replaceThread(2, [doc("t", "Carol", "2026-01-03T00:00:00Z")]);
  const merged = base.clone();
  merged.replaceThread(1, [doc("t", "Alice", "2026-01-01T00:00:00Z"), doc("r", "Dave", "2026-02-01T00:00:00Z")]);
  merged.deleteThread(2);
  assert.deepEqual(merged.snapshot().map(value => value.normalisedUsername), ["dave", "alice"]);
  assert.deepEqual(base.snapshot().map(value => value.normalisedUsername), ["carol", "bob", "alice"]);
});
