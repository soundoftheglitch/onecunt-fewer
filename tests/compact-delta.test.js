"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CompactDeltaSynchronizer, mergedSearch, recentCutoff } = require("../search/compact-delta.js");

const raw = (id, last, count = 1, message = `message ${id}`) => ({ Id: id, Title: `Thread ${id}`, Message: message,
  PostedByUsername: "allowed", PostedByEmailAddress: "private@example.test",
  CreatedDateTimeUtc: last, LastPostDateTimeUtc: last, PostCount: count });

class Repository {
  constructor() { this.status = { phase: "idle", pending: [], pendingRemovals: [] }; this.threads = new Map(); this.deleted = []; }
  async state() { return structuredClone(this.status); }
  async putState(value) { this.status = structuredClone(value); }
  async threadMetadata(id) { return this.threads.get(id)?.metadata || null; }
  async threadIdsSince(cutoff) { return [...this.threads].filter(([, item]) => item.metadata.lastPostUtc >= cutoff).map(([id]) => id); }
  async replaceThread(thread, replies) { this.threads.set(thread.threadId, { metadata: {
    threadId: thread.threadId, lastPostUtc: thread.lastPostUtc, advertisedPostCount: thread.advertisedPostCount,
    rootSignature: JSON.stringify([thread.root.username, thread.root.title, thread.root.body, thread.root.createdUtc]) },
  documents: [thread.root, ...replies] }); }
  async deleteThread(id) { this.threads.delete(id); this.deleted.push(id); }
}

test("Today/Yesterday overlap converges new, edited and deleted threads with bounded requests", async () => {
  const repository = new Repository();
  repository.threads.set(1, { metadata: { threadId: 1, lastPostUtc: "2026-08-31T18:00:00Z",
    advertisedPostCount: 1, rootSignature: "old" }, documents: [] });
  repository.threads.set(9, { metadata: { threadId: 9, lastPostUtc: "2026-08-31T17:00:00Z",
    advertisedPostCount: 1, rootSignature: "deleted" }, documents: [] });
  const calls = []; const fetchJson = async path => { calls.push(path);
    if (path === "/api/forum/threads/page/1") return { Threads: [raw(1, "2026-08-31T18:00:00Z", 2, "edited"),
      raw(2, "2026-08-31T19:00:00Z"), raw(8, "2026-08-30T20:00:00Z")] };
    if (path === "/api/forum/threads/page/2" || path === "/api/forum/threads/page/3") return { Threads: [raw(7, "2026-08-20T00:00:00Z")] };
    return [];
  };
  const sync = new CompactDeltaSynchronizer({ repository, fetchJson,
    now: () => Date.parse("2026-08-31T20:00:00Z"), wait: async () => {}, requestDelayMs: 0 });
  const result = await sync.run({ baseWatermark: "2026-08-30T23:00:00Z" });
  assert.deepEqual({ refreshed: result.refreshed, removed: result.removed, requests: result.requests },
    { refreshed: 2, removed: 1, requests: 5 });
  assert.deepEqual(repository.deleted, [9]); assert.equal(repository.threads.has(2), true);
  assert.equal(calls.includes("/api/forum/thread/8/replies"), false, "base-covered overlap must not be refetched");
  assert.equal(calls.some(path => path.includes("page/4")), false);
  const debounced = await sync.run({ baseWatermark: "2026-08-30T23:00:00Z" });
  assert.equal(debounced.result, "debounced"); assert.equal(debounced.debounced, true);
  assert.equal(debounced.refreshed, 0); assert.equal(debounced.requests, 0);
});

test("offline interruption preserves committed work and resumes without historical crawl", async () => {
  const repository = new Repository(); let fail = true; const calls = [];
  const fetchJson = async path => { calls.push(path);
    if (path.includes("threads/page/1")) return { Threads: [raw(3, "2026-08-31T19:00:00Z")] };
    if (path.includes("threads/page/2") || path.includes("threads/page/3")) return { Threads: [raw(7, "2026-08-20T00:00:00Z")] };
    if (fail) { fail = false; throw new Error("offline"); }
    return [];
  };
  const sync = new CompactDeltaSynchronizer({ repository, fetchJson,
    now: () => Date.parse("2026-08-31T20:00:00Z"), wait: async () => {}, requestDelayMs: 0 });
  await assert.rejects(sync.run({ baseWatermark: "2026-08-30T23:00:00Z" }), /offline/);
  assert.equal((await repository.state()).phase, "offline");
  const resumed = await sync.run({ baseWatermark: "2026-08-30T23:00:00Z", force: true });
  assert.equal(resumed.refreshed, 1); assert.ok(resumed.requests <= 4);
  assert.equal(calls.some(path => /page\/(?:9|10|100)/.test(path)), false);
});

test("base and local delta merge deterministically with overrides and tombstones", async () => {
  const baseEngine = { search: async (...args) => {
    assert.deepEqual(args[7], { docKeys: ["t:1", "r:4"], threadIds: [2] });
    return { items: [], total: 0 };
  } };
  const deltaRepository = { search: async () => [
    { docKey: "t:1", threadId: 1, score: 8, createdUtc: "2026-08-31T00:00:00Z" },
    { docKey: "r:4", threadId: 1, score: 5, createdUtc: "2026-08-31T01:00:00Z" }],
  tombstonedThreadIds: async () => [2], documentKeys: async () => ["t:1", "r:4"] };
  const result = await mergedSearch({ baseEngine, deltaRepository, query: "x" });
  assert.deepEqual(result.items.map(item => item.docKey), ["t:1", "r:4"]);
  assert.equal(result.total, 2);
});

test("merged search preserves totals and materialises the requested page beyond its first window", async () => {
  const rows = Array.from({ length: 277 }, (_, index) => ({ docKey: `r:${index + 1}`,
    threadId: index + 1, score: 277 - index, createdUtc: "2026-01-01T00:00:00Z" }));
  const baseEngine = { search: async (_query, limit) => ({ items: rows.slice(0, limit), total: rows.length }) };
  const deltaRepository = { search: async () => [], tombstonedThreadIds: async () => [], documentKeys: async () => [] };
  const result = await mergedSearch({ baseEngine, deltaRepository, query: "coffee", limit: 25, offset: 125 });
  assert.equal(result.total, 277); assert.equal(result.items.length, 25);
  assert.equal(result.items[0].docKey, "r:126"); assert.equal(result.items.at(-1).docKey, "r:150");
});

test("merged search forwards mute and temporary reveal visibility to both generations", async () => {
  const calls = [];
  const baseEngine = { search: async (...args) => { calls.push(["base", args.slice(4)]); return { items: [], total: 0 }; } };
  const deltaRepository = { search: async (...args) => { calls.push(["delta", args.slice(2)]); return []; },
    tombstonedThreadIds: async () => [], documentKeys: async () => [] };
  await mergedSearch({ baseEngine, deltaRepository, query: "x", blockedUsernames: ["blocked"],
    mutedThreadIds: [42], revealHidden: true });
  assert.deepEqual(calls, [["delta", [["blocked"], [42], true]],
    ["base", [["blocked"], [42], true, { docKeys: [], threadIds: [] }]]]);
});

test("merged search forwards an explicit Posts or Replies result kind", async () => {
  const calls = [];
  const baseEngine = { search: async (...args) => { calls.push(["base", args[7]]); return { items: [], total: 0 }; } };
  const deltaRepository = { search: async (...args) => { calls.push(["delta", args[5]]); return []; },
    tombstonedThreadIds: async () => [], documentKeys: async () => [] };
  await mergedSearch({ baseEngine, deltaRepository, query: "coffee", resultKind: "r" });
  assert.deepEqual(calls, [["delta", "r"], ["base", { docKeys: [], threadIds: [], resultKind: "r" }]]);
});

test("merged author search forwards exact identity and excludes non-exact delta usernames", async () => {
  const calls = [];
  const baseEngine = { search: async (...args) => { calls.push(args[7]); return { items: [], total: 2 }; } };
  const deltaRepository = { search: async () => [
    { docKey: "r:1", username: "Alice", score: 2, createdUtc: "2026-01-02T00:00:00Z" },
    { docKey: "r:2", username: "Alice Smith", score: 1, createdUtc: "2026-01-01T00:00:00Z" }
  ], tombstonedThreadIds: async () => [], documentKeys: async () => [] };
  const result = await mergedSearch({ baseEngine, deltaRepository, query: 'user:"Alice"', resultKind: "r", exactUsername: "alice" });
  assert.deepEqual(calls, [{ docKeys: [], threadIds: [], resultKind: "r", exactUsername: "alice" }]);
  assert.deepEqual(result.items.map(item => item.docKey), ["r:1"]);
  assert.equal(result.total, 3);
});

test("cutoff retains a forty-eight-hour boundary around the base", () => {
  assert.equal(recentCutoff("2026-08-30T23:00:00Z", Date.parse("2026-08-31T20:00:00Z")),
    "2026-08-28T23:00:00.000Z");
});

test("the selected refresh frequency controls the current delta debounce", async () => {
  const repository = new Repository(); let clock = Date.parse("2026-09-01T12:00:00Z");
  repository.status.lastSuccessUtc = new Date(clock - 30 * 60_000).toISOString();
  const sync = new CompactDeltaSynchronizer({ repository, fetchJson: async () => ({ Threads: [] }),
    now: () => clock, wait: async () => {}, requestDelayMs: 0 });
  assert.equal(await sync.due(false, 60 * 60_000), false, "hourly must not run after thirty minutes");
  assert.equal(await sync.due(false, 15 * 60_000), true, "fifteen-minute mode must be due after thirty minutes");
  clock += 31 * 60_000;
  assert.equal(await sync.due(false, 60 * 60_000), true, "hourly must become due after sixty-one minutes");
});
