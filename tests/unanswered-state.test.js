"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConversationBranches, ConversationCatalogue, classifyThread, summariseThread } = require("../search/unanswered-state.js");

const doc = (kind, id, threadId, author, parent, second) => ({ docKey: `${kind}:${id}`, kind, postId: id,
  threadId, parentPostId: parent, username: author, title: `Thread ${threadId}`, body: `Body ${id}`,
  createdUtc: `2026-09-01T00:00:${String(second).padStart(2, "0")}Z`,
  canonicalUrl: `https://ntforum.net/thread/${threadId}${kind === "r" ? `/reply/${id}` : ""}` });

test("classifies exact incoming topic and reply branches and open/resolved transitions", () => {
  const values = [doc("t", 1, 1, " Dög Hat ", null, 1), doc("r", 2, 1, "Alice", null, 2),
    doc("r", 3, 1, "dog hat", 2, 3), doc("r", 4, 1, "Bob", 3, 4),
    doc("r", 5, 1, "Carol", 4, 5), doc("r", 6, 1, "DOG HAT", 5, 6)];
  const result = classifyThread(values, "dog hat");
  assert.deepEqual(result.map(item => [item.docKey, item.type, item.answered]),
    [["r:4", "replies", true], ["r:2", "posts", true]]);
  assert.equal(JSON.stringify(result).includes("email"), false);
});

test("logout, missing parents, self replies and blocked subtrees are excluded deterministically", () => {
  const values = [doc("t", 10, 10, "dog hat", null, 1), doc("r", 11, 10, "dog hat", null, 2),
    doc("r", 12, 10, "Blocked", null, 3), doc("r", 13, 10, "Alice", 12, 4),
    doc("r", 14, 10, "Alice", 999, 5), doc("r", 15, 10, "Alice", null, 6)];
  assert.deepEqual(classifyThread(values, "", ["blocked"]), []);
  assert.deepEqual(classifyThread(values, "DOG HAT", [" blocked "]).map(item => item.docKey), ["r:15"]);
});

test("changed and deleted threads converge by recomputing only the affected thread", () => {
  const model = new ConversationBranches({ ownUsername: "dog hat" });
  model.replaceThreads([[1, [doc("t", 1, 1, "dog hat", null, 1), doc("r", 2, 1, "Alice", null, 2)]],
    [20, [doc("t", 20, 20, "Else", null, 1)]]]);
  let state = model.replaceThread(1, [doc("t", 1, 1, "dog hat", null, 1), doc("r", 2, 1, "Alice", null, 2),
    doc("r", 3, 1, "dog hat", 2, 3)]);
  assert.deepEqual(state.posts.map(item => [item.docKey, item.answered]), [["r:2", true]]);
  assert.deepEqual(state.metrics, { recomputedThreads: 1, scannedDocuments: 3 });
  state = model.deleteThread(1); assert.deepEqual(state.posts, []);
  model.replaceThread(1, [doc("t", 1, 1, "dog hat", null, 1), doc("r", 2, 1, "Alice", null, 2)]);
  assert.deepEqual(model.setIdentity("").posts, []);
});

test("identity-independent public summaries overlay changed and deleted threads privately", () => {
  const first = [doc("t", 1, 1, "dog hat", null, 1), doc("r", 2, 1, "Alice", null, 2),
    doc("r", 3, 1, "Bob", 2, 3), doc("r", 4, 1, "dog hat", 3, 4)];
  const catalogue = new ConversationCatalogue([[1, summariseThread(first)]]);
  assert.deepEqual(catalogue.snapshot(" DOG HAT ").posts.map(item => [item.docKey, item.answered]), [["r:2", true]]);
  assert.deepEqual(catalogue.snapshot("dog hat", ["alice"]).posts, []);
  const copy = catalogue.clone().replaceThread(1, first.slice(0, 2));
  assert.deepEqual(copy.snapshot("dog hat").posts.map(item => [item.docKey, item.answered]), [["r:2", false]]);
  copy.deleteThread(1); assert.deepEqual(copy.snapshot("dog hat"), { posts: [], replies: [] });
  assert.equal(JSON.stringify(catalogue.snapshot("dog hat")).includes("recipient"), false);
});
