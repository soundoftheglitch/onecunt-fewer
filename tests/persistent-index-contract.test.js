"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../search/persistent-index-contract.js");

const hash = character => character.repeat(64);
const generation = {
  storageFormat: contract.STORAGE_FORMAT, storageSchemaVersion: contract.STORAGE_SCHEMA_VERSION,
  sourceFormat: contract.SOURCE_FORMAT, sourceSchemaVersion: contract.SOURCE_SCHEMA_VERSION,
  generationId: `v1-${hash("a")}`, manifestSha256: hash("a"), state: "complete",
  watermark: "2026-08-31T08:55:24Z", bytes: contract.RAW_CHUNK_BYTES + 7,
  documentCount: 2, termCount: 3, sha256: hash("b"), chunkBytes: contract.RAW_CHUNK_BYTES,
  createdUtc: "2026-08-31T19:59:00Z", completedUtc: "2026-08-31T20:00:00Z",
  source: { generationTag: "search-compact-v1-fixture", manifestUrl: "https://github.com/example/repo/releases/download/fixture/manifest.json" },
  chunks: [
    { name: "raw-0000.bin", offset: 0, bytes: contract.RAW_CHUNK_BYTES, sha256: hash("c") },
    { name: "raw-0001.bin", offset: contract.RAW_CHUNK_BYTES, bytes: 7, sha256: hash("d") }
  ]
};

test("accepts a deterministic contiguous generation", () => {
  assert.equal(contract.validateGeneration(generation), generation);
  assert.equal(contract.generationId(hash("a")), generation.generationId);
  assert.equal(contract.rawChunkName(7), "raw-0007.bin");
});

test("rejects schema, identity, gaps, checksums and chunk-count overflow", () => {
  assert.throws(() => contract.validateGeneration({ ...generation, storageSchemaVersion: 2 }), /Invalid persisted generation/);
  assert.throws(() => contract.validateGeneration({ ...generation, generationId: `v1-${hash("e")}` }), /Invalid persisted generation/);
  assert.throws(() => contract.validateGeneration({ ...generation, chunks: [generation.chunks[1]] }), /Invalid persisted chunk/);
  assert.throws(() => contract.validateGeneration({ ...generation, chunks: [{ ...generation.chunks[0], sha256: "bad" }, generation.chunks[1]] }), /Invalid persisted chunk/);
  assert.throws(() => contract.validateGeneration({ ...generation, chunks: Array(contract.MAX_RAW_CHUNKS + 1).fill(generation.chunks[0]) }), /Invalid persisted generation/);
});

test("bounds reads and resolves them to no more than two chunks", () => {
  assert.deepEqual(contract.validateRead(contract.RAW_CHUNK_BYTES - 4, 8, generation.bytes), { firstChunk: 0, lastChunk: 1 });
  assert.deepEqual(contract.validateRead(2, 10, generation.bytes), { firstChunk: 0, lastChunk: 0 });
  assert.throws(() => contract.validateRead(0, contract.MAX_READ_BYTES + 1, generation.bytes), /outside bounds/);
  assert.throws(() => contract.validateRead(generation.bytes - 2, 3, generation.bytes), /outside bounds/);
});

test("active pointer names only a structurally valid complete-generation identity", () => {
  const pointer = { storageFormat: contract.STORAGE_FORMAT, storageSchemaVersion: 1,
    generationId: generation.generationId, activatedUtc: "2026-08-31T20:00:00Z" };
  assert.equal(contract.validateActivePointer(pointer), pointer);
  assert.throws(() => contract.validateActivePointer({ ...pointer, activatedUtc: "later" }), /Invalid active-generation pointer/);
});
