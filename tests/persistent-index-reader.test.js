"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const { PersistentIndexStorage } = require("../search/persistent-index-storage.js");
const { PersistentIndexReader } = require("../search/persistent-index-reader.js");

class MemoryCache {
  constructor() { this.items = new Map(); }
  key(value) { return value?.url || String(value); }
  async match(key) { return this.items.get(this.key(key))?.clone(); }
  async put(key, value) { this.items.set(this.key(key), value.clone()); }
  async delete(key) { return this.items.delete(this.key(key)); }
  async keys() { return Array.from(this.items.keys(), url => new Request(url)); }
}
class MemoryCaches { constructor(cache) { this.cache = cache; } async open() { return this.cache; } }

const varint = value => {
  const result = [];
  while (value >= 128) { result.push((value & 127) | 128); value = Math.floor(value / 128); }
  result.push(value); return Buffer.from(result);
};
const blob = value => { const data = Buffer.from(value); return Buffer.concat([varint(data.length), data]); };
const u64 = value => { const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data; };
const sha = value => createHash("sha256").update(value).digest();

function fixture({ version = 1 } = {}) {
  const watermark = Buffer.from("2026-08-31T20:00:00Z");
  const documents = [
    { delta: 11, thread: 11, parent: 0, kind: 0,
      values: ["maker", "Artisinal work", "craft", "2026-08-31T19:00:00Z", "/thread/11"] },
    { delta: 1, thread: 11, parent: 11, kind: 1,
      values: ["reader", "Re: Artisinal work", "artisinal reply", "2026-08-31T20:00:00Z", "/thread/11/reply/12"] }
  ];
  const metadata = Buffer.concat(documents.flatMap(item => [varint(item.delta), varint(item.thread),
    varint(item.parent), Buffer.from([item.kind]), ...item.values.map(blob)]));
  const artisinalPosting = Buffer.concat([varint(12), varint(1), varint(0)]);
  const craftPosting = Buffer.concat([varint(11), varint(1), varint(0)]);
  const lexicon = Buffer.concat([
    Buffer.from([2, 0]), varint(0), blob("artisinal"), varint(1), varint(0), varint(artisinalPosting.length),
    Buffer.from([2, 0]), varint(0), blob("craft"), varint(1), varint(artisinalPosting.length), varint(craftPosting.length)
  ]);
  const header = Buffer.concat([Buffer.from("NTFSIDX\0"), Buffer.from([version, 0, 0, 0]),
    (() => { const data = Buffer.alloc(16); data.writeUInt32LE(2, 0); data.writeUInt32LE(2, 4);
      data.writeUInt32LE(watermark.length, 8); data.writeUInt32LE(0, 12); return data; })(),
    u64(44 + watermark.length), u64(44 + watermark.length + metadata.length), watermark]);
  const payload = Buffer.concat([header, metadata, lexicon, artisinalPosting, craftPosting]);
  return Buffer.concat([payload, sha(payload)]);
}

async function stored(binary, manifestCharacter = "a") {
  const cache = new MemoryCache();
  const storage = new PersistentIndexStorage({ cachesImpl: new MemoryCaches(cache), cryptoImpl: webcrypto,
    storageManager: { estimate: async () => ({ usage: 0, quota: 1_000_000 }) },
    now: () => "2026-08-31T20:01:00Z" });
  let largestRead = 0;
  const originalRead = storage.read.bind(storage);
  storage.read = async (...args) => { largestRead = Math.max(largestRead, args[2]); return originalRead(...args); };
  const record = await storage.writeGeneration({ manifestSha256: manifestCharacter.repeat(64),
    watermark: "2026-08-31T20:00:00Z", bytes: binary.length,
    sha256: sha(binary).toString("hex"), documentCount: 2, termCount: 2,
    source: { generationTag: "fixture", manifestUrl: "https://github.com/example/repo/releases/fixture.json" } }, binary);
  return { cache, storage, record, largestRead: () => largestRead };
}

test("opens a validated generation and reads only requested postings and documents", async () => {
  const setup = await stored(fixture()); const reader = new PersistentIndexReader({ storage: setup.storage, cryptoImpl: webcrypto });
  assert.deepEqual(await reader.open(setup.record.generationId), { generationId: setup.record.generationId,
    documentCount: 2, threadCount: 1, termCount: 2, watermark: "2026-08-31T20:00:00Z",
    bytes: setup.record.bytes });
  assert.deepEqual(await reader.posting("body", "artisinal"),
    [{ documentId: 12, termFrequency: 1, positions: [0] }]);
  assert.deepEqual(reader.catalogueThreads(), [{ docKey: "t:11", postId: 11, threadId: 11,
    parentPostId: null, kind: "t", username: "maker", title: "Artisinal work", body: "",
    createdUtc: "2026-08-31T19:00:00Z", lastPostUtc: "2026-08-31T20:00:00Z",
    replyCount: 1, canonicalUrl: "/thread/11" }]);
  assert.deepEqual(reader.memberRecords(), [
    { username: "reader", normalisedUsername: "reader", topicCount: 0, replyCount: 1,
      latestTopicUtc: "", latestReplyUtc: "2026-08-31T20:00:00Z", lastActiveUtc: "2026-08-31T20:00:00Z" },
    { username: "maker", normalisedUsername: "maker", topicCount: 1, replyCount: 0,
      latestTopicUtc: "2026-08-31T19:00:00Z", latestReplyUtc: "", lastActiveUtc: "2026-08-31T19:00:00Z" }
  ]);
  assert.deepEqual(reader.memberRecords([" READER "]).map(value => value.normalisedUsername), ["maker"]);
  assert.deepEqual(reader.conversationCatalogue().snapshot("maker").posts.map(item =>
    [item.docKey, item.type, item.answered]), [["r:12", "posts", false]]);
  const restarted = new PersistentIndexReader({ storage: setup.storage, cryptoImpl: webcrypto });
  await restarted.open(setup.record.generationId);
  assert.deepEqual(restarted.memberRecords(), reader.memberRecords());
  assert.deepEqual(restarted.conversationCatalogue().snapshot("maker"),
    reader.conversationCatalogue().snapshot("maker"));
  assert.equal((await reader.document(12)).canonicalUrl, "/thread/11/reply/12");
  assert.equal(await reader.document(999), null);
  assert.ok(setup.largestRead() <= 1024 * 1024);
});

test("fails closed for unsupported headers, missing chunks and checksum mismatches", async () => {
  const unsupported = await stored(fixture({ version: 2 }), "b");
  await assert.rejects(new PersistentIndexReader({ storage: unsupported.storage, cryptoImpl: webcrypto })
    .open(unsupported.record.generationId), /Unsupported|Invalid/);

  const missing = await stored(fixture(), "c");
  const chunk = (await missing.cache.keys()).find(request => request.url.endsWith("raw-0000.bin"));
  await missing.cache.delete(chunk);
  await assert.rejects(new PersistentIndexReader({ storage: missing.storage, cryptoImpl: webcrypto })
    .open(missing.record.generationId), /missing/);

  const corrupt = await stored(fixture(), "d");
  const corruptChunk = (await corrupt.cache.keys()).find(request => request.url.endsWith("raw-0000.bin"));
  const data = new Uint8Array(await (await corrupt.cache.match(corruptChunk)).arrayBuffer()); data[50] ^= 1;
  await corrupt.cache.put(corruptChunk, new Response(data));
  await assert.rejects(new PersistentIndexReader({ storage: corrupt.storage, cryptoImpl: webcrypto })
    .open(corrupt.record.generationId), /checksum mismatch/);
});
