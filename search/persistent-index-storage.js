(function (root, factory) {
  const contract = typeof module === "object" && module.exports
    ? require("./persistent-index-contract.js") : root.FewerCuntsPersistentIndexContract;
  const api = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FewerCuntsPersistentIndexStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  const CACHE_NAME = "fewercunts-persisted-compact-index-v1";
  const KEY_ROOT = "https://fewercunts.invalid/persisted-index/";
  const ACTIVE_KEY = `${KEY_ROOT}meta/active.json`;
  const GENERATION_PREFIX = `${KEY_ROOT}generations/`;
  const STAGING_PREFIX = `${KEY_ROOT}staging/`;

  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError("Persistent index source yielded non-binary data");
  }

  function hex(value) {
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(value, cryptoImpl) {
    const data = bytes(value);
    return hex(await cryptoImpl.subtle.digest("SHA-256", data));
  }

  function generationKey(generationId) {
    return `${GENERATION_PREFIX}${generationId}/generation.json`;
  }

  function chunkKey(generationId, index) {
    return `${GENERATION_PREFIX}${generationId}/${contract.rawChunkName(index)}`;
  }

  function progressKey(generationId) {
    return `${STAGING_PREFIX}${generationId}/progress.json`;
  }

  async function *binaryParts(source) {
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      yield bytes(source);
      return;
    }
    if (typeof Blob !== "undefined" && source instanceof Blob) source = source.stream();
    if (source?.getReader) {
      const reader = source.getReader();
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          yield bytes(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }
    if (source?.[Symbol.asyncIterator] || source?.[Symbol.iterator]) {
      for await (const part of source) yield bytes(part);
      return;
    }
    throw new TypeError("Persistent index source is not binary or streamable");
  }

  function isQuotaError(error) {
    return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
  }

  class PersistentIndexQuotaError extends Error {
    constructor(details, cause) {
      super("Browser quota was exceeded while writing the persistent index", { cause });
      this.name = "PersistentIndexQuotaError";
      this.code = "PERSISTENT_INDEX_QUOTA";
      Object.assign(this, details, { recoverable: true });
    }
  }

  class PersistentIndexStorage {
    constructor({ cachesImpl = caches, storageManager = globalThis.navigator?.storage,
      cryptoImpl = crypto, now = () => new Date().toISOString() } = {}) {
      this.caches = cachesImpl;
      this.storageManager = storageManager;
      this.crypto = cryptoImpl;
      this.now = now;
    }

    async cache() { return this.caches.open(CACHE_NAME); }

    async json(key) {
      const response = await (await this.cache()).match(key);
      if (!response) return null;
      try { return await response.json(); } catch (_) { throw new Error(`Invalid persistent index metadata: ${key}`); }
    }

    async putJson(key, value) {
      await (await this.cache()).put(key, new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" }
      }));
    }

    async generation(generationId) {
      const record = await this.json(generationKey(generationId));
      return record ? contract.validateGeneration(record) : null;
    }

    async hasGeneration(generationId, { complete = true } = {}) {
      try {
        const record = await this.generation(generationId);
        if (!record || (complete && record.state !== "complete")) return false;
        const cache = await this.cache();
        for (let index = 0; index < record.chunks.length; index += 1) {
          if (!await cache.match(chunkKey(generationId, index))) return false;
        }
        return true;
      } catch (_) { return false; }
    }

    async estimateWrite(rawBytes) {
      const estimate = await (this.storageManager?.estimate?.() || {});
      const usage = Number.isFinite(Number(estimate.usage)) ? Number(estimate.usage) : null;
      const quota = Number.isFinite(Number(estimate.quota)) ? Number(estimate.quota) : null;
      const required = Math.ceil(rawBytes * 1.15);
      return { usage, quota, required, sufficient: usage === null || quota === null || quota - usage >= required };
    }

    async writeGeneration(metadata, source) {
      const generationId = contract.generationId(metadata?.manifestSha256);
      const totalBytes = metadata?.bytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 1
          || totalBytes > contract.RAW_CHUNK_BYTES * contract.MAX_RAW_CHUNKS) {
        throw new Error("Persistent index generation exceeds storage bounds");
      }
      const existing = await this.generation(generationId).catch(() => null);
      if (existing?.state === "complete") throw new Error("Complete persistent generation is immutable");
      const estimate = await this.estimateWrite(totalBytes);
      if (!estimate.sufficient) {
        throw new PersistentIndexQuotaError({ operation: "preflight", generationId,
          attemptedBytes: totalBytes, usage: estimate.usage, quota: estimate.quota });
      }
      const priorProgress = await this.json(progressKey(generationId)).catch(() => null);
      if (priorProgress && (priorProgress.generationId !== generationId
          || priorProgress.manifestSha256 !== metadata.manifestSha256
          || priorProgress.bytes !== totalBytes)) {
        throw new Error("Staged persistent generation metadata differs from deterministic source");
      }
      const createdUtc = existing?.createdUtc || priorProgress?.createdUtc || this.now();
      const base = {
        storageFormat: contract.STORAGE_FORMAT, storageSchemaVersion: contract.STORAGE_SCHEMA_VERSION,
        sourceFormat: contract.SOURCE_FORMAT, sourceSchemaVersion: contract.SOURCE_SCHEMA_VERSION,
        generationId, manifestSha256: metadata.manifestSha256, state: "staging",
        watermark: metadata.watermark, bytes: totalBytes, documentCount: metadata.documentCount,
        termCount: metadata.termCount, sha256: metadata.sha256, chunkBytes: contract.RAW_CHUNK_BYTES,
        createdUtc, source: metadata.source, chunks: []
      };
      const cache = await this.cache();
      const put = async (key, response, operation, attemptedBytes = 0) => {
        try { await cache.put(key, response); } catch (error) {
          if (!isQuotaError(error)) throw error;
          const current = await this.estimateWrite(totalBytes);
          throw new PersistentIndexQuotaError({ operation, generationId, attemptedBytes,
            usage: error.usage ?? current.usage, quota: error.quota ?? current.quota }, error);
        }
      };
      const putJson = (key, value, operation) => put(key, new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" }
      }), operation, new TextEncoder().encode(JSON.stringify(value)).byteLength);
      let offset = 0; let index = 0; let fill = 0;
      let buffer = new Uint8Array(Math.min(contract.RAW_CHUNK_BYTES, totalBytes));
      const storedChunks = [];
      const persistChunk = async () => {
        if (!fill) return;
        const data = buffer.slice(0, fill);
        const descriptor = { name: contract.rawChunkName(index), offset, bytes: fill,
          sha256: await sha256(data, this.crypto) };
        const key = chunkKey(generationId, index);
        const prior = await cache.match(key);
        if (prior) {
          const priorData = new Uint8Array(await prior.arrayBuffer());
          if (priorData.byteLength !== fill || await sha256(priorData, this.crypto) !== descriptor.sha256) {
            throw new Error("Staged persistent chunk differs from deterministic source");
          }
        } else {
          try { await put(key, new Response(data, { headers: { "content-type": "application/octet-stream" } }),
            "write-chunk", fill); } catch (error) { if (error instanceof PersistentIndexQuotaError) error.chunkIndex = index; throw error; }
        }
        storedChunks.push(descriptor);
        offset += fill; index += 1; fill = 0;
        await putJson(progressKey(generationId), { generationId, manifestSha256: metadata.manifestSha256,
          bytes: totalBytes, createdUtc, bytesWritten: offset, chunksWritten: index,
          chunks: storedChunks, updatedUtc: this.now() }, "write-progress");
        if (offset < totalBytes) buffer = new Uint8Array(Math.min(contract.RAW_CHUNK_BYTES, totalBytes - offset));
      };
      try {
        await putJson(progressKey(generationId), priorProgress || { generationId,
          manifestSha256: metadata.manifestSha256, bytes: totalBytes, createdUtc,
          bytesWritten: 0, chunksWritten: 0, chunks: [], updatedUtc: this.now() }, "write-progress");
        for await (const part of binaryParts(source)) {
          let position = 0;
          while (position < part.byteLength) {
            if (offset + fill >= totalBytes) throw new Error("Persistent index source exceeds declared size");
            const take = Math.min(buffer.byteLength - fill, part.byteLength - position);
            buffer.set(part.subarray(position, position + take), fill);
            fill += take; position += take;
            if (fill === buffer.byteLength) await persistChunk();
          }
        }
        await persistChunk();
        if (offset !== totalBytes) throw new Error("Persistent index source is shorter than declared size");
        const complete = contract.validateGeneration({ ...base, state: "complete", chunks: storedChunks,
          completedUtc: this.now() });
        await putJson(generationKey(generationId), complete, "complete-generation");
        await cache.delete(progressKey(generationId));
        return complete;
      } catch (error) {
        if (error instanceof PersistentIndexQuotaError) {
          await this.deleteGeneration(generationId, { allowComplete: false }).catch(() => {});
        }
        throw error;
      }
    }

    async readChunk(generationId, index) {
      const record = await this.generation(generationId);
      if (!record || record.state !== "complete" || !record.chunks[index]) throw new Error("Complete persistent generation is unavailable");
      const response = await (await this.cache()).match(chunkKey(generationId, index));
      if (!response) throw new Error("Persistent index chunk is missing");
      const data = await response.arrayBuffer();
      if (data.byteLength !== record.chunks[index].bytes) throw new Error("Persistent index chunk size mismatch");
      return data;
    }

    async read(generationId, offset, length) {
      const record = await this.generation(generationId);
      if (!record || record.state !== "complete") throw new Error("Complete persistent generation is unavailable");
      const range = contract.validateRead(offset, length, record.bytes);
      const output = new Uint8Array(length); let written = 0;
      const cache = await this.cache();
      for (let index = range.firstChunk; index <= range.lastChunk; index += 1) {
        const response = await cache.match(chunkKey(generationId, index));
        if (!response) throw new Error("Persistent index chunk is missing");
        const blob = await response.blob();
        if (blob.size !== record.chunks[index].bytes) throw new Error("Persistent index chunk size mismatch");
        const chunkStart = index * contract.RAW_CHUNK_BYTES;
        const from = Math.max(offset, chunkStart) - chunkStart;
        const to = Math.min(offset + length, chunkStart + blob.size) - chunkStart;
        output.set(new Uint8Array(await blob.slice(from, to).arrayBuffer()), written); written += to - from;
      }
      return output.buffer;
    }

    async activePointer() {
      const pointer = await this.json(ACTIVE_KEY);
      return pointer ? contract.validateActivePointer(pointer) : null;
    }

    async activateGeneration(generationId) {
      const generation = await this.generation(generationId);
      if (!generation || generation.state !== "complete" || !await this.hasGeneration(generationId)) {
        throw new Error("Only a complete persistent generation can become active");
      }
      const pointer = contract.validateActivePointer({ storageFormat: contract.STORAGE_FORMAT,
        storageSchemaVersion: contract.STORAGE_SCHEMA_VERSION, generationId, activatedUtc: this.now() });
      await this.putJson(ACTIVE_KEY, pointer);
      return pointer;
    }

    async clearActivePointer() { return (await this.cache()).delete(ACTIVE_KEY); }

    async completeGenerations() {
      const cache = await this.cache(); const records = [];
      for (const request of await cache.keys()) {
        const url = request.url || String(request);
        if (!url.startsWith(GENERATION_PREFIX) || !url.endsWith("/generation.json")) continue;
        const match = url.match(/\/generations\/(v1-[a-f0-9]{64})\/generation\.json$/);
        if (!match) continue;
        const record = await this.generation(match[1]).catch(() => null);
        if (record?.state === "complete" && await this.hasGeneration(record.generationId)) records.push(record);
      }
      return records.sort((left, right) => right.completedUtc.localeCompare(left.completedUtc));
    }

    async deleteGeneration(generationId, { allowComplete = false } = {}) {
      const cache = await this.cache();
      const active = await this.activePointer().catch(() => null);
      if (active?.generationId === generationId) throw new Error("Cannot delete the active persistent generation");
      const record = await this.generation(generationId).catch(() => null);
      if (record?.state === "complete" && !allowComplete) throw new Error("Cannot delete a complete persistent generation");
      for (const request of await cache.keys()) {
        const url = request.url || String(request);
        if (url.startsWith(`${GENERATION_PREFIX}${generationId}/`) || url === progressKey(generationId)) {
          await cache.delete(request);
        }
      }
    }

    async cleanupAbandoned({ keepGenerationIds = [] } = {}) {
      const keep = new Set(keepGenerationIds);
      const active = await this.activePointer().catch(() => null);
      if (active) keep.add(active.generationId);
      const cache = await this.cache(); const candidates = new Set();
      for (const request of await cache.keys()) {
        const url = request.url || String(request);
        const match = url.match(/\/(?:generations|staging)\/(v1-[a-f0-9]{64})\//);
        if (match) candidates.add(match[1]);
      }
      const removed = [];
      for (const generationId of Array.from(candidates).slice(0, contract.MAX_RAW_CHUNKS)) {
        if (keep.has(generationId)) continue;
        const record = await this.generation(generationId).catch(() => null);
        if (!record || record.state === "staging") {
          await this.deleteGeneration(generationId, { allowComplete: false }); removed.push(generationId);
        }
      }
      return removed;
    }
    async clearAll() {
      const cache = await this.cache();
      for (const request of await cache.keys()) await cache.delete(request);
    }
  }

  return { ACTIVE_KEY, CACHE_NAME, GENERATION_PREFIX, PersistentIndexQuotaError,
    PersistentIndexStorage, STAGING_PREFIX, chunkKey, generationKey, progressKey, sha256 };
});
