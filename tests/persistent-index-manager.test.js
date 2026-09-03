"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PersistentIndexManager } = require("../search/persistent-index-manager.js");

const id = character => `v1-${character.repeat(64)}`;
const pointer = (character, watermark) => ({ manifestSha256: character.repeat(64), watermark,
  generationTag: `search-compact-v1-${character}`, manifestUrl: "https://github.com/example/repo/manifest.json" });
const manifest = watermark => ({ watermark, bytes: 4, sha256: "f".repeat(64), documentCount: 2, termCount: 3 });

class FakeStorage {
  constructor() { this.active = null; this.complete = new Map(); this.staging = []; this.activations = []; }
  async cleanupAbandoned() { const removed = [...this.staging]; this.staging = []; return removed; }
  async activePointer() { return this.active ? { generationId: this.active } : null; }
  async clearActivePointer() { this.active = null; }
  async completeGenerations() { return [...this.complete.values()]; }
  async hasGeneration(generationId) { return this.complete.has(generationId); }
  async writeGeneration(metadata) { const generationId = id(metadata.manifestSha256[0]);
    this.complete.set(generationId, { generationId, ...metadata, completedUtc: "2026-09-01T00:00:00Z" }); return this.complete.get(generationId); }
  async activateGeneration(generationId) { if (!this.complete.has(generationId)) throw new Error("incomplete");
    this.active = generationId; this.activations.push(generationId); }
}
class FakeReader {
  constructor(storage) { this.storage = storage; this.fail = new Set(); }
  async open(generationId) { if (this.fail.has(generationId) || !this.storage.complete.has(generationId)) throw new Error("corrupt");
    const item = this.storage.complete.get(generationId); return { generationId, watermark: item.watermark,
      documentCount: item.documentCount, threadCount: 1, termCount: item.termCount }; }
}
const raw = () => new Blob([new Uint8Array([1, 2, 3, 4])]);

test("installs and atomically switches only after the staged reader validates", async () => {
  const storage = new FakeStorage(); const reader = new FakeReader(storage); const next = pointer("b", "2026-09-01T00:00:00Z");
  const manager = new PersistentIndexManager({ storage, reader, downloader: { fetchPointer: async () => next,
    download: async () => ({ manifest: manifest(next.watermark), raw: raw() }) } });
  const result = await manager.install();
  assert.equal(result.result, "installed"); assert.equal(storage.active, id("b"));
  assert.deepEqual(storage.activations, [id("b")]); assert.equal(manager.status().phase, "ready");
});

test("startup reopens active data and recovers a stale pointer without downloading", async () => {
  const storage = new FakeStorage(); storage.complete.set(id("a"), { generationId: id("a"), watermark: "2026-08-31T00:00:00Z",
    documentCount: 2, termCount: 3, completedUtc: "2026-08-31T00:00:00Z" }); storage.active = id("z");
  let requests = 0; const manager = new PersistentIndexManager({ storage, reader: new FakeReader(storage),
    downloader: { fetchPointer: async () => { requests += 1; } } });
  const result = await manager.startup();
  assert.equal(result.recovered, true); assert.equal(storage.active, id("a")); assert.equal(requests, 0);
  assert.equal(result.active.threadCount, 1);
});

test("failed replacement and abandoned staging preserve the prior searchable generation", async () => {
  const storage = new FakeStorage(); storage.staging.push(id("c"));
  storage.complete.set(id("a"), { generationId: id("a"), watermark: "2026-08-31T00:00:00Z",
    documentCount: 2, termCount: 3, completedUtc: "2026-08-31T00:00:00Z" }); storage.active = id("a");
  const reader = new FakeReader(storage); const next = pointer("b", "2026-09-01T00:00:00Z"); reader.fail.add(id("b"));
  const manager = new PersistentIndexManager({ storage, reader, downloader: { fetchPointer: async () => next,
    download: async () => ({ manifest: manifest(next.watermark), raw: raw() }) } });
  await manager.startup();
  await assert.rejects(manager.install(), /corrupt/);
  assert.equal(storage.active, id("a")); assert.equal(manager.status().previousAvailable, true);
  assert.equal(manager.status().active.generationId, id("a")); assert.deepEqual(storage.staging, []);
});

test("an unchanged remote watermark does not download again", async () => {
  const storage = new FakeStorage(); storage.complete.set(id("a"), { generationId: id("a"), watermark: "2026-09-01T00:00:00Z",
    documentCount: 2, termCount: 3, completedUtc: "2026-09-01T00:00:00Z" }); storage.active = id("a");
  let downloads = 0; const manager = new PersistentIndexManager({ storage, reader: new FakeReader(storage),
    downloader: { fetchPointer: async () => pointer("a", "2026-09-01T00:00:00Z"),
      download: async () => { downloads += 1; } } });
  await manager.startup(); const result = await manager.install();
  assert.equal(result.result, "unchanged"); assert.equal(downloads, 0);
});

test("concurrent startup polling joins an active install without cleaning its staging chunks", async () => {
  const storage = new FakeStorage(); let cleanupCalls = 0;
  const cleanup = storage.cleanupAbandoned.bind(storage);
  storage.cleanupAbandoned = async (...args) => { cleanupCalls += 1; return cleanup(...args); };
  let releaseWrite; let writeStarted;
  const started = new Promise(resolve => { writeStarted = resolve; });
  storage.writeGeneration = async metadata => {
    const generationId = id(metadata.manifestSha256[0]); storage.staging.push(generationId); writeStarted();
    await new Promise(resolve => { releaseWrite = resolve; });
    storage.staging = []; storage.complete.set(generationId,
      { generationId, ...metadata, completedUtc: "2026-09-01T00:00:00Z" });
    return storage.complete.get(generationId);
  };
  const next = pointer("b", "2026-09-01T00:00:00Z");
  const manager = new PersistentIndexManager({ storage, reader: new FakeReader(storage),
    downloader: { fetchPointer: async () => next,
      download: async () => ({ manifest: manifest(next.watermark), raw: raw() }) } });
  const installing = manager.install(); await started;
  const polling = manager.startup();
  assert.deepEqual(storage.staging, [id("b")]);
  assert.equal(cleanupCalls, 1, "only the pre-install recovery may clean abandoned data");
  releaseWrite();
  const [installed, observed] = await Promise.all([installing, polling]);
  assert.equal(installed.phase, "ready"); assert.equal(observed.phase, "ready");
  assert.equal(storage.active, id("b"));
  assert.equal(cleanupCalls, 2, "post-activation cleanup may run only after staging completes");
});
