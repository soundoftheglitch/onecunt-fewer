"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { candidates, notification } = require("../search/notification-state.js");

const doc = (key, threadId, author, parent = null) => ({ docKey: key, kind: key[0], threadId,
  postId: Number(key.slice(2)), parentPostId: parent, username: author, title: `Thread ${threadId}`,
  threadTitle: `Thread ${threadId}`, body: `Body ${key}`, createdUtc: `2026-09-01T00:00:${String(Number(key.slice(2))).padStart(2, "0")}Z`,
  canonicalUrl: `https://ntforum.net/thread/${threadId}${key[0] === "r" ? `/reply/${key.slice(2)}` : ""}` });

test("detects deduplicable exact replies to the user's threads and posts", () => {
  const documents = [doc("t:1", 1, " Dog Hat "), doc("r:2", 1, "alice", 1),
    doc("t:3", 3, "alice"), doc("r:4", 3, "dog hat", 3), doc("r:5", 3, "bob", 4),
    doc("r:6", 3, "carol", 3), doc("r:7", 1, "dog hat", 2)];
  assert.deepEqual(candidates(documents, "dog hat").map(value => value.docKey), ["r:5", "r:2"]);
});

test("notification records expose bounded public metadata only", () => {
  const record = notification({ ...doc("r:42", 7, "alice", 6), body: "x".repeat(500), email: "private@example.test", token: "secret" });
  assert.deepEqual(Object.keys(record), ["docKey", "threadId", "postId", "parentPostId", "username", "title", "snippet",
    "createdUtc", "canonicalUrl", "detectedUtc", "read", "dismissed"]);
  assert.equal(record.snippet.length, 240); assert.equal(JSON.stringify(record).includes("private@example.test"), false);
  assert.equal(JSON.stringify(record).includes("secret"), false);
});
