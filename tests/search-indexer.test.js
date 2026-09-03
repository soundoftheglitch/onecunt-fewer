"use strict";

const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const fixture = require("./fixtures/forum-api.json");
const { BootstrapImporter, InitialImporter, IncrementalSynchronizer, isArchivedRoot, sanitiseBootstrapTerm, sanitiseBootstrapThread, sanitiseThread, flattenReplies, makeNavigationPayload, makeSnippet, parseQuery, postingsForDocument, scoreDocument, selectBackfillThreads, selectUnlovedThreads, tokenise } = require("../search/indexer.js");
globalThis.crypto ||= webcrypto;

class MemoryRepository {
  constructor() { this.sync = null; this.update = null; this.settings = { enabled: true, refreshMinutes: 15, fullReconcileDays: 7, replyReconcileDays: 30 }; this.documents = new Map(); this.threads = new Map(); this.terms = new Map(); }
  async getSync() { return this.sync && structuredClone(this.sync); }
  async putSync(state) { this.sync = structuredClone(state); }
  async commitThread(thread, replies, state) {
    for (const [key, doc] of this.documents) if (doc.threadId === thread.threadId) this.documents.delete(key);
    for (const doc of [thread.root, ...replies]) this.documents.set(doc.docKey, structuredClone(doc));
    this.threads.set(thread.threadId, { threadId: thread.threadId, lastPostUtc: thread.lastPostUtc, advertisedPostCount: thread.advertisedPostCount, importedPostCount: replies.length + 1, rootSignature: JSON.stringify([thread.root.username, thread.root.title, thread.root.body, thread.root.createdUtc]) });
    await this.putSync(state);
  }
  async getUpdate() { return this.update && structuredClone(this.update); }
  async putUpdate(state) { this.update = structuredClone(state); }
  async getSettings() { return structuredClone(this.settings); }
  async putSettings(settings) { this.settings = { ...this.settings, ...settings }; return this.getSettings(); }
  async threadMetadata(id) { return structuredClone(this.threads.get(id)); }
  async allThreadIds() { return [...this.threads.keys()]; }
  async latestPostUtc() { return [...this.threads.values()].map(item => item.lastPostUtc).sort().at(-1) || null; }
  async deleteThread(id) { this.threads.delete(id); for (const [key, doc] of this.documents) if (doc.threadId === id) this.documents.delete(key); }
  async clear() { this.sync = null; this.documents.clear(); this.threads.clear(); }
  async stats() { return { documents: this.documents.size, threads: this.threads.size }; }
  async commitBootstrapRecord(record, state) {
    const item = sanitiseBootstrapThread(record);
    await this.commitThread(item, item.replies, state);
    return item.replies.length + 1;
  }
  async commitBootstrapBatch(records, state) {
    let documents = 0;
    for (const record of records) documents += await this.commitBootstrapRecord(record, state);
    return documents;
  }
  async resetBootstrap(state) { this.documents.clear(); this.threads.clear(); this.terms.clear(); await this.putSync(state); }
  async commitBootstrapTerms(records) {
    for (const record of records) {
      const shard = sanitiseBootstrapTerm(record);
      this.terms.set(`${shard.field}:${shard.prefix}`, shard.postings);
    }
    return records.length;
  }
}

function assertSafeLocalFields(value) {
  const serialised = JSON.stringify(value);
  assert.doesNotMatch(serialised, /authentication|password|token/i);
}

async function main() {
  assert.equal(isArchivedRoot({ replyCount: 999 }), true);
  for (const replyCount of [998, 1000, "999", null, undefined]) {
    assert.equal(isArchivedRoot({ replyCount }), false, `replyCount ${String(replyCount)} must remain open`);
  }
  const thread = sanitiseThread(fixture.catalogue.Threads[0]);
  const replies = flattenReplies(fixture.replies, thread.threadId);
  const bootstrapThread = sanitiseBootstrapThread({
    type: "thread", threadId: 101, username: "Alice", title: "Bootstrap", body: "Local snapshot",
    createdUtc: "2026-08-01T00:00:00Z", lastPostUtc: "2026-08-02T00:00:00Z",
    advertisedPostCount: 2, canonicalUrl: "https://ntforum.net/thread/101",
    replies: [{ postId: 201, parentPostId: null, username: "Bob", title: "Re: Bootstrap",
      body: "Reply", createdUtc: "2026-08-02T00:00:00Z", canonicalUrl: "https://ntforum.net/thread/101/reply/201" }]
  });
  assert.equal(bootstrapThread.root.email, "", "public bootstrap never contains email addresses");
  assert.equal(bootstrapThread.replies[0].threadId, 101);
  assert.throws(() => sanitiseBootstrapThread({ ...bootstrapThread, type: "thread", replies: [] }), /Invalid bootstrap/);
  const bootstrapLines = [
    JSON.stringify({ type: "header", schemaVersion: 3 }),
    JSON.stringify({ type: "thread", threadId: 101, username: "Alice", title: "Bootstrap", body: "Local snapshot",
      createdUtc: "2026-08-01T00:00:00Z", lastPostUtc: "2026-08-02T00:00:00Z", advertisedPostCount: 2,
      canonicalUrl: "https://ntforum.net/thread/101", replies: [{ postId: 201, parentPostId: null, username: "Bob",
        title: "Re: Bootstrap", body: "Reply", createdUtc: "2026-08-02T00:00:00Z",
        canonicalUrl: "https://ntforum.net/thread/101/reply/201" }] }),
    JSON.stringify({ type: "termShard", field: "title", prefix: "boo", postings: [["bootstrap", ["t:101", "r:201"]]] })
  ].join("\n") + "\n";
  const bootstrapBytes = gzipSync(bootstrapLines, { mtime: 0 });
  const bootstrapManifest = { format: "fewercunts-search-bootstrap", schemaVersion: 3,
    compressedBytes: bootstrapBytes.length, sha256: createHash("sha256").update(bootstrapBytes).digest("hex"),
    url: "https://assets.invalid/snapshot.gz", threadCount: 1, documentCount: 2, termCount: 1, shardCount: 1,
    latestPostUtc: "2026-08-02T00:00:00Z" };
  const bootstrapRepository = new MemoryRepository();
  const bootstrapImporter = new BootstrapImporter({ repository: bootstrapRepository, manifestUrl: "https://manifest.invalid/latest.json",
    fetchImpl: async url => url.includes("manifest")
      ? new Response(JSON.stringify(bootstrapManifest), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(bootstrapBytes, { status: 200 }) });
  const bootstrapped = await bootstrapImporter.run();
  assert.deepEqual({ used: bootstrapped.used, threads: bootstrapped.threads, documents: bootstrapped.documents },
    { used: true, threads: 1, documents: 2 });
  assert.equal(bootstrapRepository.sync.phase, "complete");
  assert.equal(bootstrapRepository.documents.get("t:101").email, "");
  assert.deepEqual(bootstrapRepository.terms.get("title:boo"), [["bootstrap", ["t:101", "r:201"]]]);
  let assetRequests = 0;
  const unchangedBootstrap = new BootstrapImporter({ repository: bootstrapRepository, manifestUrl: "https://manifest.invalid/latest.json",
    fetchImpl: async url => {
      if (!url.includes("manifest")) assetRequests += 1;
      return url.includes("manifest")
        ? new Response(JSON.stringify(bootstrapManifest), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(bootstrapBytes, { status: 200 });
    } });
  const unchanged = await unchangedBootstrap.run({ allowUpdate: true });
  assert.equal(unchanged.reason, "snapshot-not-newer");
  assert.equal(assetRequests, 0, "unchanged GitHub manifest must avoid the snapshot and NTForum bulk work");
  assert.deepEqual(replies.map(item => item.docKey), ["r:201", "r:202"]);
  assert.equal(replies[1].parentPostId, 201);
  assert.equal(thread.root.email, "alice@example.invalid");
  assert.equal(thread.root.replyCount, fixture.catalogue.Threads[0].PostCount - 1);
  assert.equal(thread.root.lastPostUtc, fixture.catalogue.Threads[0].LastPostDateTimeUtc);
  assert.equal(replies[0].email, "carol@example.invalid");
  assertSafeLocalFields({ thread, replies });
  const replyNavigation = makeNavigationPayload(thread.root, replies[0]);
  assert.equal(replyNavigation.thread.Id, thread.threadId);
  assert.equal(replyNavigation.targetPostId, replies[0].postId);
  assert.equal(replyNavigation.thread.PostedByEmailAddress, "", "navigation must not expose stored email to the page");
  assert.equal(makeNavigationPayload(thread.root, thread.root).targetPostId, null);
  assert.throws(() => makeNavigationPayload(thread.root, { ...replies[0], threadId: 999 }), /Invalid navigation target/);
  assert.deepEqual(parseQuery('user:carol title:"poach an egg" soft'), [
    { field: "user", value: "carol", tokens: ["carol"], phrase: false, prefix: false },
    { field: "title", value: "poach an egg", tokens: ["poach", "an", "egg"], phrase: true, prefix: false },
    { field: null, value: "soft", tokens: ["soft"], phrase: false, prefix: false }
  ]);
  assert.ok(scoreDocument(replies[0], parseQuery('user:carol body:"never execute"')) > 0);
  assert.equal(scoreDocument(replies[0], parseQuery("user:alice")), 0);
  assert.ok(scoreDocument(replies[0], parseQuery("email:carol@example.invalid")) > 0);
  assert.equal(scoreDocument(replies[0], parseQuery("carol@example.invalid")), 0, "ordinary search must not inspect email addresses");
  const wordBoundaryDocument = { username: "Alice", title: "The hottest records", body: "A testing ground and a separate test." };
  assert.equal(scoreDocument(wordBoundaryDocument, parseQuery("hot")), 0, "bare terms must not match inside a token");
  assert.equal(scoreDocument(wordBoundaryDocument, parseQuery("test")) > 0, true, "whole tokens should match");
  assert.equal(scoreDocument({ ...wordBoundaryDocument, body: "A testing ground." }, parseQuery("test")), 0, "test must not match testing");
  assert.equal(scoreDocument(wordBoundaryDocument, parseQuery("test*")) > 0, true, "explicit prefix search should match test and testing");
  assert.equal(scoreDocument(wordBoundaryDocument, parseQuery('"separate test"')) > 0, true, "phrases require adjacent tokens");
  assert.equal(scoreDocument(wordBoundaryDocument, parseQuery('"test separate"')), 0, "phrases must preserve token order");
  assert.ok(
    scoreDocument({ username: "Alice", title: "Needle", body: "" }, parseQuery("needle"))
      > scoreDocument({ username: "Alice", title: "", body: "Needle" }, parseQuery("needle")),
    "title matches must rank above body-only matches"
  );
  assert.ok(
    scoreDocument({ username: "Alice", title: "", body: "" }, parseQuery("alice"))
      > scoreDocument({ username: "Alice Cooper", title: "", body: "" }, parseQuery("alice")),
    "exact usernames must rank above partial username-field token matches"
  );
  assert.equal(makeSnippet(replies[0], parseQuery("never")), "A <script>alert('never execute this')</script> reply.", "hostile source remains inert snippet text");
  assert.deepEqual(tokenise("Café—records 日本語"), ["cafe", "records", "日本語"]);
  assert.deepEqual(postingsForDocument({ docKey: "r:7", username: "Café", email: "A@Example.test", title: "Test test", body: "<img src=x onerror=alert(1)> safe" }), [
    { term: "cafe", field: "user", docKey: "r:7", positions: [0], frequency: 1 },
    { term: "test", field: "title", docKey: "r:7", positions: [0, 1], frequency: 2 },
    { term: "img", field: "body", docKey: "r:7", positions: [0], frequency: 1 },
    { term: "src", field: "body", docKey: "r:7", positions: [1], frequency: 1 },
    { term: "x", field: "body", docKey: "r:7", positions: [2], frequency: 1 },
    { term: "onerror", field: "body", docKey: "r:7", positions: [3], frequency: 1 },
    { term: "alert", field: "body", docKey: "r:7", positions: [4], frequency: 1 },
    { term: "1", field: "body", docKey: "r:7", positions: [5], frequency: 1 },
    { term: "safe", field: "body", docKey: "r:7", positions: [6], frequency: 1 },
    { term: "a@example.test", field: "email", docKey: "r:7", positions: [0], frequency: 1 }
  ], "postings retain deterministic positions/frequencies while email remains an explicit exact term");
  const scopedRoot = { kind: "t", username: "Alice", title: "Needle title", body: "Needle opening post" };
  const scopedReply = { kind: "r", username: "Bob", title: "Re: Needle title", body: "Needle reply" };
  assert.ok(scoreDocument(scopedRoot, parseQuery("alice"), ["user"]));
  assert.equal(scoreDocument(scopedRoot, parseQuery("needle"), ["user"]), 0);
  assert.ok(scoreDocument(scopedRoot, parseQuery("needle"), ["post"]));
  assert.equal(scoreDocument(scopedReply, parseQuery("needle"), ["post"]), 0);
  assert.ok(scoreDocument(scopedReply, parseQuery("needle"), ["replies"]));

  const authorDocuments = Array.from({ length: 31 }, (_, index) => ({
    docKey: `t:${index + 1}`, kind: "t", threadId: index + 1,
    username: index === 30 ? "ALICE " : "Alice", title: `<b>Thread ${index + 1}</b>`,
    createdUtc: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    lastPostUtc: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`, replyCount: index
  }));
  authorDocuments.push({ ...authorDocuments[0], docKey: "r:999", kind: "r" });
  authorDocuments.push({ ...authorDocuments[0], docKey: "t:998", username: "Alice2" });
  const unloved = selectUnlovedThreads([
    { ...authorDocuments[0], threadId: 3, docKey: "t:3", replyCount: 0, createdUtc: "2024-01-03T00:00:00Z" },
    { ...authorDocuments[0], threadId: 1, docKey: "t:1", replyCount: 0, createdUtc: "2024-01-01T00:00:00Z" },
    { ...authorDocuments[0], threadId: 2, docKey: "t:2", replyCount: 1, createdUtc: "2024-01-02T00:00:00Z" },
    { ...authorDocuments[0], threadId: 4, docKey: "t:4", replyCount: 0, username: "Soulisdead", createdUtc: "2023-01-01T00:00:00Z" }
  ]);
  assert.deepEqual(unloved.items.map(item => item.threadId), [1, 3], "unloved includes only visible zero-reply threads oldest first");
  assert.deepEqual(selectUnlovedThreads([
    { ...authorDocuments[0], threadId: 1, replyCount: 0 }, { ...authorDocuments[0], threadId: 3, replyCount: 0 }
  ], 0, 25, [], [1]).items.map(item => item.threadId), [3]);
  const backfillDocuments = Array.from({ length: 140 }, (_, index) => ({
    ...authorDocuments[0], docKey: `t:${index + 1}`, threadId: index + 1,
    username: index === 75 ? "monkeybutler" : "Alice", replyCount: index === 90 ? 2 : 0
  }));
  const firstBackfill = selectBackfillThreads(backfillDocuments, "classic:3:datedesc:50,51", 3, [1, 2, 50]);
  const repeatedBackfill = selectBackfillThreads(backfillDocuments, "classic:3:datedesc:50,51", 3, [1, 2, 50]);
  assert.deepEqual(repeatedBackfill, firstBackfill, "backfill selection must remain stable across reload/history");
  assert.equal(firstBackfill.length, 3);
  assert.equal(new Set(firstBackfill.map(item => item.Id)).size, 3, "one request cannot reuse a thread");
  assert.ok(firstBackfill.every(item => item.PostCount === 1 && ![1, 2, 50, 76, 91].includes(item.Id)));
  assert.ok(selectBackfillThreads(backfillDocuments, "muted", 100, [], [], [42])
    .every(item => item.Id !== 42), "backfill must not reinsert a muted thread");
  assert.deepEqual(selectBackfillThreads(backfillDocuments.slice(0, 2), "incomplete", 3, [1, 2]), [],
    "an incomplete index may return fewer rows without inventing content");

  const repository = new MemoryRepository();
  repository.sync = { phase: "paused", page: 1, cancelled: false };
  const repairedStatus = await new InitialImporter({ repository, fetchJson: async () => ({ Threads: [] }), wait: async () => {} }).status();
  assert.deepEqual(repairedStatus.pending, [], "legacy/interrupted sync records without pending arrays must fail safe");
  repository.sync = null;
  const calls = [];
  const fetchJson = async path => {
    calls.push(path);
    if (path === "/api/forum/threads/page/1") return fixture.catalogue;
    if (path === "/api/forum/threads/page/2") return { Threads: [] };
    if (path.endsWith("/101/replies")) return fixture.replies;
    if (path.endsWith("/102/replies")) return [];
    throw new Error(`Unexpected path ${path}`);
  };
  const firstWorker = new InitialImporter({ repository, fetchJson, wait: async () => {}, requestDelayMs: 0 });
  let state = await firstWorker.run({ maxThreads: 1 });
  assert.equal(state.completed, 1);
  assert.equal(state.pending.length, 1);

  const restartedWorker = new InitialImporter({ repository, fetchJson, wait: async () => {}, requestDelayMs: 0 });
  state = await restartedWorker.run();
  assert.equal(state.phase, "complete");
  assert.equal(state.completed, 2);
  assert.equal(state.totalThreads, 2);
  assert.equal(state.catalogued, 2);
  assert.equal(state.skipped, 0);
  assert.equal(repository.documents.size, 4);
  assert.equal(calls.filter(path => path === "/api/forum/threads/page/1").length, 1, "resume must not refetch committed catalogue page");
  assertSafeLocalFields({ sync: repository.sync, documents: [...repository.documents.values()] });

  const interruptedRepository = new MemoryRepository();
  let failOnce = true;
  const flaky = new InitialImporter({
    repository: interruptedRepository,
    wait: async () => {}, requestDelayMs: 0,
    fetchJson: async path => {
      if (path === "/api/forum/threads/page/1") return fixture.catalogue;
      if (path.includes("threads/page")) return { Threads: [] };
      if (failOnce) { failOnce = false; throw new Error("simulated termination"); }
      return path.endsWith("/101/replies") ? fixture.replies : [];
    }
  });
  await assert.rejects(flaky.run(), /simulated termination/);
  assert.equal((await interruptedRepository.getSync()).phase, "paused");
  state = await flaky.run();
  assert.equal(state.phase, "complete");
  assert.equal(state.completed, 2);

  const pausingRepository = new MemoryRepository();
  let releaseFetch;
  const pausingWorker = new InitialImporter({
    repository: pausingRepository, wait: async () => {}, requestDelayMs: 0,
    fetchJson: path => path.includes("threads/page")
      ? Promise.resolve(fixture.catalogue)
      : new Promise(resolve => { releaseFetch = () => resolve(fixture.replies); })
  });
  const pausingRun = pausingWorker.run();
  while (!releaseFetch) await new Promise(resolve => setImmediate(resolve));
  const pauseRequest = pausingWorker.setCancelled(true);
  releaseFetch();
  await pauseRequest;
  state = await pausingRun;
  assert.equal(state.phase, "paused");
  assert.equal(state.completed, 0, "pause during a request must leave the thread pending");
  assert.equal(state.pending.length, 2);

  const incrementalRepository = new MemoryRepository();
  await incrementalRepository.commitThread(thread, replies, { phase: "complete" });
  const changedRaw = structuredClone(fixture.catalogue.Threads[0]);
  changedRaw.PostCount += 1;
  changedRaw.LastPostDateTimeUtc = "2026-08-29T12:00:00Z";
  const newRaw = structuredClone(fixture.catalogue.Threads[1]);
  const incrementalCalls = [];
  let clock = Date.parse("2026-08-29T13:00:00Z");
  const incremental = new IncrementalSynchronizer({
    repository: incrementalRepository, wait: async () => {}, requestDelayMs: 0, now: () => clock,
    fetchJson: async path => {
      incrementalCalls.push(path);
      if (path === "/api/forum/threads/page/1") return { ThreadCount: 2, Threads: [changedRaw, newRaw] };
      if (path === "/api/forum/threads/page/2") return { ThreadCount: 2, Threads: [] };
      if (path.endsWith("/101/replies")) return [{ ...fixture.replies[0], Replies: [] }];
      if (path.endsWith("/102/replies")) return [];
      throw new Error(`Unexpected incremental path ${path}`);
    }
  });
  incrementalRepository.update = { phase: "paused" };
  const repairedUpdate = await incremental.status();
  assert.deepEqual(repairedUpdate.pending, [], "legacy update records without pending arrays must fail safe");
  assert.deepEqual(repairedUpdate.pendingRemovals, []);
  incrementalRepository.update = null;
  state = await incremental.run({ force: true });
  assert.equal(state.refreshed, 2, "new and changed threads refresh their reply trees");
  assert.equal(state.removed, 0);
  assert.equal(incrementalRepository.documents.has("r:202"), false, "removed replies disappear on atomic thread replacement");
  const callCount = incrementalCalls.length;
  state = await incremental.run();
  assert.equal(state.debounced, true);
  assert.equal(incrementalCalls.length, callCount, "searches inside the durable debounce perform no network work");

  clock += 8 * 86_400_000;
  incrementalRepository.threads.set(999, { threadId: 999, lastPostUtc: "2020-01-01T00:00:00Z", advertisedPostCount: 1 });
  incrementalRepository.documents.set("t:999", { docKey: "t:999", threadId: 999 });
  state = await incremental.run();
  assert.equal(state.removed, 1, "periodic full catalogue reconciliation removes vanished threads");
  assert.equal(incrementalRepository.documents.has("t:999"), false);

  clock += 31 * 86_400_000;
  const callsBeforeReplyReconcile = incrementalCalls.length;
  state = await incremental.run();
  assert.equal(state.reconcileReplies, true);
  assert.ok(incrementalCalls.length >= callsBeforeReplyReconcile + 4, "monthly reconciliation refetches unchanged reply trees so in-place edits converge");

  const recoveryRepository = new MemoryRepository();
  recoveryRepository.update = { phase: "paused", pending: [sanitiseThread(changedRaw)], pendingRemovals: [], refreshed: 0, removed: 0, checked: 1 };
  const recovered = new IncrementalSynchronizer({ repository: recoveryRepository, wait: async () => {}, requestDelayMs: 0, now: () => clock, fetchJson: async path => path.endsWith("/101/replies") ? fixture.replies : Promise.reject(new Error("catalogue must not restart")) });
  state = await recovered.run();
  assert.equal(state.phase, "idle");
  assert.equal(state.refreshed, 1, "a new worker resumes its durable changed-thread checkpoint");

  console.log("search indexer: whitelist, nesting, initial/incremental resume, debounce, change and deletion convergence passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
