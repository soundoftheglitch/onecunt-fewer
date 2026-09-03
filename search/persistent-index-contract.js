(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FewerCuntsPersistentIndexContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_FORMAT = "fewercunts-persisted-compact-index";
  const STORAGE_SCHEMA_VERSION = 1;
  const SOURCE_FORMAT = "ntforum-compact-search";
  const SOURCE_SCHEMA_VERSION = 1;
  const RAW_CHUNK_BYTES = 8 * 1024 * 1024;
  const MAX_RAW_CHUNKS = 32;
  const MAX_READ_BYTES = 1024 * 1024;
  const SHA256 = /^[a-f0-9]{64}$/;
  const GENERATION_ID = /^v1-[a-f0-9]{64}$/;
  const RAW_CHUNK_NAME = /^raw-([0-9]{4})\.bin$/;

  function generationId(manifestSha256) {
    if (!SHA256.test(manifestSha256 || "")) throw new Error("Invalid manifest checksum");
    return `v1-${manifestSha256}`;
  }

  function rawChunkName(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_RAW_CHUNKS) {
      throw new Error("Invalid raw chunk index");
    }
    return `raw-${String(index).padStart(4, "0")}.bin`;
  }

  function validateGeneration(record) {
    if (!record || record.storageFormat !== STORAGE_FORMAT
        || record.storageSchemaVersion !== STORAGE_SCHEMA_VERSION
        || record.sourceFormat !== SOURCE_FORMAT || record.sourceSchemaVersion !== SOURCE_SCHEMA_VERSION
        || !GENERATION_ID.test(record.generationId || "")
        || record.generationId !== generationId(record.manifestSha256)
        || !["staging", "complete"].includes(record.state)
        || typeof record.watermark !== "string" || !record.watermark
        || !Number.isSafeInteger(record.bytes) || record.bytes < 1
        || !Number.isSafeInteger(record.documentCount) || record.documentCount < 1
        || !Number.isSafeInteger(record.termCount) || record.termCount < 1
        || !SHA256.test(record.sha256 || "")
        || !Number.isSafeInteger(record.chunkBytes) || record.chunkBytes !== RAW_CHUNK_BYTES
        || !Array.isArray(record.chunks) || record.chunks.length < 1
        || record.chunks.length > MAX_RAW_CHUNKS
        || typeof record.createdUtc !== "string" || !Number.isFinite(Date.parse(record.createdUtc))
        || (record.state === "complete" && (typeof record.completedUtc !== "string"
          || !Number.isFinite(Date.parse(record.completedUtc))))
        || !record.source || typeof record.source.generationTag !== "string" || !record.source.generationTag
        || typeof record.source.manifestUrl !== "string") throw new Error("Invalid persisted generation");
    let manifestUrl;
    try { manifestUrl = new URL(record.source.manifestUrl); } catch (_) { throw new Error("Invalid persisted generation"); }
    if (manifestUrl.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com"].includes(manifestUrl.hostname)) {
      throw new Error("Invalid persisted generation");
    }
    let offset = 0;
    record.chunks.forEach((chunk, index) => {
      const match = RAW_CHUNK_NAME.exec(chunk?.name || "");
      const expectedBytes = Math.min(RAW_CHUNK_BYTES, record.bytes - offset);
      if (!match || Number(match[1]) !== index || chunk.name !== rawChunkName(index)
          || chunk.offset !== offset || chunk.bytes !== expectedBytes || chunk.bytes < 1
          || !SHA256.test(chunk.sha256 || "")) throw new Error("Invalid persisted chunk");
      offset += chunk.bytes;
    });
    if (offset !== record.bytes) throw new Error("Persisted chunk coverage mismatch");
    return record;
  }

  function validateActivePointer(pointer) {
    if (!pointer || pointer.storageFormat !== STORAGE_FORMAT
        || pointer.storageSchemaVersion !== STORAGE_SCHEMA_VERSION
        || !GENERATION_ID.test(pointer.generationId || "")
        || typeof pointer.activatedUtc !== "string" || !Number.isFinite(Date.parse(pointer.activatedUtc))) {
      throw new Error("Invalid active-generation pointer");
    }
    return pointer;
  }

  function validateRead(offset, length, generationBytes) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1
        || length > MAX_READ_BYTES || !Number.isSafeInteger(generationBytes) || generationBytes < 1
        || offset > generationBytes - length) throw new Error("Persistent index read outside bounds");
    const firstChunk = Math.floor(offset / RAW_CHUNK_BYTES);
    const lastChunk = Math.floor((offset + length - 1) / RAW_CHUNK_BYTES);
    return { firstChunk, lastChunk };
  }

  return { MAX_RAW_CHUNKS, MAX_READ_BYTES, RAW_CHUNK_BYTES, SOURCE_FORMAT,
    SOURCE_SCHEMA_VERSION, STORAGE_FORMAT, STORAGE_SCHEMA_VERSION, generationId,
    rawChunkName, validateActivePointer, validateGeneration, validateRead };
});
