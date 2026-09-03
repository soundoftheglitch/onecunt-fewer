"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const contract = require("../search/persistent-index-contract.js");
const { PersistentIndexQuotaError, PersistentIndexStorage } = require("../search/persistent-index-storage.js");

class MemoryCache {
  constructor({ failAtPut = Infinity } = {}) { this.items = new Map(); this.puts = 0; this.failAtPut = failAtPut; }
  key(value) { return value?.url || String(value); }
  async match(key) { const item = this.items.get(this.key(key)); return item?.clone(); }
  async put(key, response) {
    this.puts += 1;
    if (this.puts === this.failAtPut) {
      const error = new DOMException("full", "QuotaExceededError"); error.usage = 91; error.quota = 100; throw error;
    }
    this.items.set(this.key(key), response.clone());
  }
  async delete(key) { return this.items.delete(this.key(key)); }
  async keys() { return Array.from(this.items.keys(), url => new Request(url)); }
}

class MemoryCaches {
  constructor(cache = new MemoryCache()) { this.value = cache; }
  async open() { return this.value; }
}

const hash = character => character.repeat(64);
const metadata = size => ({ manifestSha256: hash("a"), watermark: "2026-08-31T08:55:24Z",
  bytes: size, sha256: hash("b"), documentCount: 2, termCount: 3,
  source: { generationTag: "search-compact-v1-fixture",
    manifestUrl: "https://github.com/example/repo/releases/download/fixture/manifest.json" } });

function storage(cache = new MemoryCache(), estimate = { usage: 10, quota: 1_000_000_000 }) {
  return new PersistentIndexStorage({ cachesImpl: new MemoryCaches(cache), cryptoImpl: webcrypto,
    storageManager: { estimate: async () => estimate }, now: () => "2026-08-31T20:00:00Z" });
}

test("streams deterministic immutable chunks and performs bounded cross-chunk reads", async () => {
  const size = contract.RAW_CHUNK_BYTES + 11;
  const first = new Uint8Array(contract.RAW_CHUNK_BYTES).fill(7);
  const last = new Uint8Array(11).map((_, index) => index);
  const store = storage();
  const record = await store.writeGeneration(metadata(size), (async function *() { yield first; yield last; })());
  assert.equal(record.state, "complete"); assert.equal(record.chunks.length, 2);
  assert.equal(await store.hasGeneration(record.generationId), true);
  assert.deepEqual(Array.from(new Uint8Array(await store.read(record.generationId,
    contract.RAW_CHUNK_BYTES - 3, 8))), [7, 7, 7, 0, 1, 2, 3, 4]);
  await assert.rejects(store.read(record.generationId, 0, contract.MAX_READ_BYTES + 1), /outside bounds/);
  await assert.rejects(store.writeGeneration(metadata(size), first), /immutable/);
});

test("a fresh adapter sees completed generations and existence detects missing chunks", async () => {
  const cache = new MemoryCache(); const first = storage(cache);
  const record = await first.writeGeneration(metadata(4), new Uint8Array([1, 2, 3, 4]));
  const restarted = storage(cache);
  assert.equal((await restarted.generation(record.generationId)).state, "complete");
  assert.deepEqual(Array.from(new Uint8Array(await restarted.readChunk(record.generationId, 0))), [1, 2, 3, 4]);
  const chunkRequest = (await cache.keys()).find(request => request.url.endsWith("raw-0000.bin"));
  await cache.delete(chunkRequest);
  assert.equal(await restarted.hasGeneration(record.generationId), false);
});

test("cleanup removes abandoned staging data but retains complete generations", async () => {
  const cache = new MemoryCache(); const store = storage(cache);
  const complete = await store.writeGeneration(metadata(3), new Uint8Array([1, 2, 3]));
  const abandonedId = contract.generationId(hash("c"));
  await cache.put(`https://fewercunts.invalid/persisted-index/staging/${abandonedId}/progress.json`, new Response("{}"));
  await cache.put(`https://fewercunts.invalid/persisted-index/generations/${abandonedId}/raw-0000.bin`, new Response("x"));
  assert.deepEqual(await store.cleanupAbandoned(), [abandonedId]);
  assert.equal(await store.hasGeneration(complete.generationId), true);
});

test("quota failures retain structured details and remove only failed staging data", async () => {
  const preflight = storage(new MemoryCache(), { usage: 90, quota: 100 });
  await assert.rejects(preflight.writeGeneration(metadata(20), new Uint8Array(20)), error => {
    assert.ok(error instanceof PersistentIndexQuotaError); assert.equal(error.operation, "preflight");
    assert.equal(error.usage, 90); assert.equal(error.quota, 100); assert.equal(error.recoverable, true); return true;
  });
  const cache = new MemoryCache({ failAtPut: 2 }); const write = storage(cache);
  await assert.rejects(write.writeGeneration(metadata(4), new Uint8Array([1, 2, 3, 4])), error => {
    assert.ok(error instanceof PersistentIndexQuotaError); assert.equal(error.operation, "write-chunk");
    assert.equal(error.attemptedBytes, 4); assert.equal(error.usage, 91); assert.equal(error.quota, 100); return true;
  });
  assert.equal((await cache.keys()).some(request => request.url.includes(hash("a"))), false);
});

test("short, oversized and divergent resumed sources fail without completing", async () => {
  await assert.rejects(storage().writeGeneration(metadata(4), new Uint8Array([1, 2])), /shorter/);
  await assert.rejects(storage().writeGeneration(metadata(2), new Uint8Array([1, 2, 3])), /exceeds/);
});
