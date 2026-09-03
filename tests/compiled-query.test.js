"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CompiledQueryEngine, phraseMatches } = require("../search/compiled-query.js");

class FixtureReader {
  constructor() {
    this.documents = new Map([
      [1, { id: 1, threadId: 1, parentId: null, kind: "thread", username: "maker",
        title: "Artisinal bread", body: "slow craft bread", createdUtc: "2026-08-30T10:00:00Z", canonicalUrl: "/thread/1", replyCount: 999 }],
      [2, { id: 2, threadId: 1, parentId: 1, kind: "reply", username: "reader",
        title: "Re: Artisinal bread", body: "artisinal bread is excellent", createdUtc: "2026-08-31T10:00:00Z", canonicalUrl: "/thread/1/reply/2" }],
      [3, { id: 3, threadId: 3, parentId: null, kind: "thread", username: "artisan",
        title: "Factory bread", body: "bread", createdUtc: "2026-08-31T11:00:00Z", canonicalUrl: "/thread/3", replyCount: 998 }]
    ]);
    this.data = new Map();
    this.add("title", "artisinal", [[1, [0]], [2, [1]]]);
    this.add("title", "bread", [[1, [1]], [2, [2]], [3, [1]]]);
    this.add("title", "factory", [[3, [0]]]);
    this.add("body", "artisinal", [[2, [0]]]);
    this.add("body", "bread", [[1, [2]], [2, [1]], [3, [0]]]);
    this.add("body", "slow", [[1, [0]]]); this.add("body", "craft", [[1, [1]]]);
    this.add("user", "maker", [[1, [0]]]); this.add("user", "reader", [[2, [0]]]);
    this.add("user", "artisan", [[3, [0]]]);
  }
  add(field, term, values) { this.data.set(`${field}\0${term}`, { field, term,
    documentFrequency: values.length, values: values.map(([documentId, positions]) =>
      ({ documentId, termFrequency: positions.length, positions })) }); }
  requireOpen() { return { generation: { documentCount: this.documents.size } }; }
  termInfo(field, term) { return this.data.get(`${field}\0${term}`) || null; }
  terms(field, prefix, limit) { const values = [...this.data.values()].filter(item => item.field === field && item.term.startsWith(prefix));
    if (values.length > limit) throw new Error("too broad"); return values; }
  async *postingEntries(field, term) { for (const value of this.termInfo(field, term)?.values || []) yield value; }
  async document(id) { return this.documents.get(id) || null; }
}

test("whole-word, field, phrase and prefix queries are deterministic", async () => {
  const engine = new CompiledQueryEngine({ reader: new FixtureReader() });
  const ordinary = await engine.search("artisinal", 25, ["user", "post", "replies"]);
  assert.deepEqual(ordinary.items.map(item => item.postId || item.threadId), [2, 1]);
  assert.deepEqual(ordinary.items.map(item => item.archived), [true, true]);
  assert.equal(ordinary.total, 2);
  const postsOnly = await engine.search("artisinal", 25, ["user", "post", "replies"], 0, [], [], false,
    { resultKind: "t" });
  const repliesOnly = await engine.search("artisinal", 25, ["user", "post", "replies"], 0, [], [], false,
    { resultKind: "r" });
  assert.deepEqual(postsOnly.items.map(item => item.docKey), ["t:1"]);
  assert.deepEqual(repliesOnly.items.map(item => item.docKey), ["r:2"]);
  assert.equal((await engine.navigationTarget("r:2")).targetPostId, 2);
  engine.navigationCache.clear();
  assert.equal((await engine.navigationTarget("r:2")).targetPostId, 2,
    "navigation must reconstruct from persistent compiled documents after cache loss or worker restart");
  const field = await engine.search("user:artisan", 25, ["user", "post"]);
  assert.deepEqual(field.items.map(item => item.threadId), [3]);
  assert.equal(field.items[0].archived, false);
  const phrase = await engine.search('body:"slow craft"', 25, ["post"]);
  assert.deepEqual(phrase.items.map(item => item.threadId), [1]);
  const prefix = await engine.search("title:fact*", 25, ["post"]);
  assert.deepEqual(prefix.items.map(item => item.threadId), [3]);
});

test("scope, paging, phrase positions and candidate bounds are enforced", async () => {
  const reader = new FixtureReader(); const engine = new CompiledQueryEngine({ reader, candidateLimit: 1, documentLoadLimit: 1 });
  const replies = await engine.search("bread", 1, ["replies"]);
  assert.equal(replies.items.length <= 1, true); assert.equal(replies.truncated, true);
  assert.equal(replies.items.every(item => item.kind === "r"), true);
  assert.equal(phraseMatches([[1, 8], [2, 9]]), true);
  assert.equal(phraseMatches([[1], [3]]), false);
  await assert.rejects(engine.search("a*", 25, ["post"]), /at least two/);
});

test("dynamic author filtering removes blocked roots, blocked replies and their descendants", async () => {
  const reader = new FixtureReader();
  reader.documents.set(4, { id: 4, threadId: 1, parentId: 2, kind: "reply", username: "innocent",
    title: "Bread child", body: "bread", createdUtc: "2026-08-31T12:00:00Z", canonicalUrl: "/thread/1/reply/4" });
  reader.add("body", "bread", [[1, [2]], [2, [1]], [3, [0]], [4, [0]]]);
  const engine = new CompiledQueryEngine({ reader });
  const blockedRoot = await engine.search("bread", 25, ["post", "replies"], 0, [" MAKER "]);
  assert.deepEqual(blockedRoot.items.map(item => item.threadId), [3]);
  const blockedReply = await engine.search("bread", 25, ["post", "replies"], 0, ["reader"]);
  assert.equal(blockedReply.items.some(item => item.postId === 2 || item.postId === 4), false);
  const unblocked = await engine.search("bread", 25, ["post", "replies"], 0, []);
  assert.equal(unblocked.items.some(item => item.postId === 4), true);
});

test("dynamic muted-thread filtering hides every hit and reveal bypasses without changing the set", async () => {
  const engine = new CompiledQueryEngine({ reader: new FixtureReader() });
  const hidden = await engine.search("bread", 25, ["post", "replies"], 0, [], [1], false);
  assert.deepEqual(hidden.items.map(item => item.threadId), [3]);
  const revealed = await engine.search("bread", 25, ["post", "replies"], 0, ["maker"], [1, 3], true);
  assert.deepEqual(new Set(revealed.items.map(item => item.threadId)), new Set([1, 3]));
});

test("delta overrides and tombstones are suppressed before compiled totals and paging", async () => {
  const engine = new CompiledQueryEngine({ reader: new FixtureReader() });
  const result = await engine.search("bread", 25, ["post", "replies"], 0, [], [], false,
    { docKeys: ["r:2"], threadIds: [3] });
  assert.deepEqual(result.items.map(item => item.docKey), ["t:1"]);
  assert.equal(result.total, 1);
});
