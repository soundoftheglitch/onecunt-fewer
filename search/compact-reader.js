(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FewerCuntsCompactReader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT = "ntforum-compact-search-pointer";
  const SCHEMA_VERSION = 1;
  const CACHE_NAME = "fewercunts-compact-search-v1";
  const ACTIVE_KEY = "https://fewercunts.invalid/compact/active";
  const GENERATION_PREFIX = "https://fewercunts.invalid/compact/generation/";
  const MAGIC = [78, 84, 70, 83, 73, 68, 88, 0];

  function hex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(value, cryptoImpl = crypto) {
    const bytes = value instanceof ArrayBuffer ? value : await value.arrayBuffer();
    return hex(await cryptoImpl.subtle.digest("SHA-256", bytes));
  }

  function pemBytes(pem) {
    const encoded = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const binary = atob(encoded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function verifyManifest(manifestBytes, signatureBytes, publicKeyPem, cryptoImpl = crypto) {
    const key = await cryptoImpl.subtle.importKey("spki", pemBytes(publicKeyPem), { name: "Ed25519" }, false, ["verify"]);
    if (!await cryptoImpl.subtle.verify("Ed25519", key, signatureBytes, manifestBytes)) {
      throw new Error("Compact manifest signature mismatch");
    }
  }

  function validatePointer(pointer) {
    if (!pointer || pointer.format !== FORMAT || pointer.schemaVersion !== SCHEMA_VERSION
        || typeof pointer.watermark !== "string" || !pointer.watermark
        || typeof pointer.generationTag !== "string" || !/^search-compact(?:-editable)?-v1-[a-zA-Z0-9-]+$/.test(pointer.generationTag)
        || !Number.isSafeInteger(pointer.manifestBytes) || pointer.manifestBytes < 1
        || !/^[a-f0-9]{64}$/.test(pointer.manifestSha256 || "")
        || !/^[a-f0-9]{64}$/.test(pointer.publicKeySha256 || "")) {
      throw new Error("Invalid compact index pointer");
    }
    for (const name of ["manifestUrl", "signatureUrl", "assetBaseUrl"]) {
      const url = new URL(pointer[name]);
      if (url.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com"].includes(url.hostname)) {
        throw new Error("Invalid compact asset URL");
      }
    }
    return pointer;
  }

  function validateManifest(manifest, pointer) {
    if (!manifest || manifest.format !== "ntforum-compact-search" || manifest.schemaVersion !== SCHEMA_VERSION
        || manifest.watermark !== pointer.watermark || !Number.isSafeInteger(manifest.documentCount)
        || !Number.isSafeInteger(manifest.termCount) || !Number.isSafeInteger(manifest.bytes)
        || !Number.isSafeInteger(manifest.compressedBytes) || !Array.isArray(manifest.chunks) || !manifest.chunks.length
        || !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") || !/^[a-f0-9]{64}$/.test(manifest.payloadSha256 || "")
        || !/^[a-f0-9]{64}$/.test(manifest.compressedSha256 || "")
        || manifest.privacy?.emails !== false) throw new Error("Invalid compact manifest");
    let compressed = 0;
    for (const chunk of manifest.chunks) {
      if (!/^ntforum-search-v1-\d{4}\.gz\.part$/.test(chunk.name || "")
          || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1
          || chunk.bytes > manifest.chunkBytesLimit || !/^[a-f0-9]{64}$/.test(chunk.sha256 || "")) {
        throw new Error("Invalid compact chunk declaration");
      }
      compressed += chunk.bytes;
    }
    if (compressed !== manifest.compressedBytes) throw new Error("Compact chunk sizes disagree");
    return manifest;
  }

  async function validateBinary(blob, manifest, cryptoImpl = crypto) {
    if (blob.size !== manifest.bytes) throw new Error("Compact binary size mismatch");
    const binary = await blob.arrayBuffer();
    if (await sha256(binary, cryptoImpl) !== manifest.sha256) throw new Error("Compact binary checksum mismatch");
    const bytes = new Uint8Array(binary);
    if (MAGIC.some((value, index) => bytes[index] !== value)) throw new Error("Compact binary magic mismatch");
    const view = new DataView(binary);
    if (view.getUint16(8, true) !== SCHEMA_VERSION || view.getUint16(10, true) !== 0
        || view.getUint32(12, true) !== manifest.documentCount || view.getUint32(16, true) !== manifest.termCount) {
      throw new Error("Compact binary header mismatch");
    }
    const footer = binary.slice(binary.byteLength - 32);
    if (hex(footer) !== manifest.payloadSha256
        || await sha256(binary.slice(0, binary.byteLength - 32), cryptoImpl) !== manifest.payloadSha256) {
      throw new Error("Compact binary payload checksum mismatch");
    }
    return blob;
  }

  class CompactReader {
    constructor({ pointerUrl, publicKeyUrl, fetchImpl = (...arguments_) => globalThis.fetch(...arguments_), cachesImpl = caches,
      storageManager = navigator.storage, cryptoImpl = crypto }) {
      this.pointerUrl = pointerUrl;
      this.publicKeyUrl = publicKeyUrl;
      this.fetchImpl = fetchImpl;
      this.caches = cachesImpl;
      this.storageManager = storageManager;
      this.crypto = cryptoImpl;
    }
    async fetchOk(url) {
      const response = await this.fetchImpl(url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`Compact asset returned ${response.status}`);
      return response;
    }
    async cache() { return this.caches.open(CACHE_NAME); }
    async active() {
      const response = await (await this.cache()).match(ACTIVE_KEY);
      return response ? response.json() : null;
    }
    async status() {
      const [active, estimate] = await Promise.all([this.active(), this.storageManager?.estimate?.() || {}]);
      return { active, usage: Number(estimate.usage) || 0, quota: Number(estimate.quota) || 0 };
    }
    async fetchPointer() { return validatePointer(await (await this.fetchOk(this.pointerUrl)).json()); }
    async download(pointer = null) {
      pointer = pointer ? validatePointer(pointer) : await this.fetchPointer();
      const publicKeyResponse = await this.fetchOk(this.publicKeyUrl);
      const publicKeyBytes = await publicKeyResponse.arrayBuffer();
      if (await sha256(publicKeyBytes, this.crypto) !== pointer.publicKeySha256) throw new Error("Compact public key mismatch");
      const [manifestResponse, signatureResponse] = await Promise.all([
        this.fetchOk(pointer.manifestUrl), this.fetchOk(pointer.signatureUrl)
      ]);
      const manifestBytes = await manifestResponse.arrayBuffer();
      const signatureBytes = await signatureResponse.arrayBuffer();
      if (manifestBytes.byteLength !== pointer.manifestBytes
          || await sha256(manifestBytes, this.crypto) !== pointer.manifestSha256) throw new Error("Compact manifest checksum mismatch");
      await verifyManifest(manifestBytes, signatureBytes, new TextDecoder().decode(publicKeyBytes), this.crypto);
      const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), pointer);
      const chunks = [];
      for (const expected of manifest.chunks) {
        const response = await this.fetchOk(`${pointer.assetBaseUrl}/${expected.name}`);
        const data = await response.arrayBuffer();
        if (data.byteLength !== expected.bytes || await sha256(data, this.crypto) !== expected.sha256) {
          throw new Error(`Compact chunk checksum mismatch: ${expected.name}`);
        }
        chunks.push(data);
      }
      const compressed = new Blob(chunks);
      if (compressed.size !== manifest.compressedBytes || await sha256(await compressed.arrayBuffer(), this.crypto) !== manifest.compressedSha256) {
        throw new Error("Compact compressed asset mismatch");
      }
      const raw = await new Response(compressed.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
      await validateBinary(raw, manifest, this.crypto);
      return { pointer, manifest, manifestBytes, raw };
    }
    async install() {
      const pointer = await this.fetchPointer();
      const current = await this.active();
      if (current && current.schemaVersion === SCHEMA_VERSION && current.watermark >= pointer.watermark) {
        return { result: "unchanged", active: current };
      }
      const { manifest, raw } = await this.download(pointer);
      const estimate = await (this.storageManager?.estimate?.() || {});
      const available = Number(estimate.quota) - Number(estimate.usage);
      if (Number.isFinite(available) && available < manifest.bytes * 1.15) throw new Error("Insufficient storage for compact search index");
      const cache = await this.cache();
      const generationKey = GENERATION_PREFIX + encodeURIComponent(pointer.generationTag);
      await cache.put(generationKey, new Response(raw, { headers: { "content-type": "application/octet-stream" } }));
      const active = { generationTag: pointer.generationTag, generationKey, schemaVersion: SCHEMA_VERSION,
        watermark: pointer.watermark, documentCount: manifest.documentCount, termCount: manifest.termCount,
        bytes: manifest.bytes, installedUtc: new Date().toISOString(), manifest };
      await cache.put(ACTIVE_KEY, new Response(JSON.stringify(active), { headers: { "content-type": "application/json" } }));
      for (const request of await cache.keys()) {
        if (request.url.startsWith(GENERATION_PREFIX) && request.url !== generationKey) await cache.delete(request);
      }
      return { result: "installed", active };
    }
    async read(offset, length) {
      const active = await this.active();
      if (!active) throw new Error("No complete compact index is installed");
      const start = Number(offset); const size = Number(length);
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(size) || size < 0
          || start + size > active.bytes) throw new Error("Compact read outside generation");
      const response = await (await this.cache()).match(active.generationKey);
      if (!response) throw new Error("Active compact generation is missing");
      return (await response.blob()).slice(start, start + size).arrayBuffer();
    }
  }

  return { ACTIVE_KEY, CACHE_NAME, CompactReader, GENERATION_PREFIX, sha256, validateBinary,
    validateManifest, validatePointer, verifyManifest };
});
