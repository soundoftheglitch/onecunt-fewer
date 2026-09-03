"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CompactReader, validateManifest, validatePointer } = require("../search/compact-reader.js");

const pointer = {
  format: "ntforum-compact-search-pointer", schemaVersion: 1,
  watermark: "2026-08-31T08:55:24Z",
  generationTag: "search-compact-v1-20260831T085524-abcdef123456",
  manifestUrl: "https://github.com/example/repo/releases/download/generation/manifest.json",
  signatureUrl: "https://github.com/example/repo/releases/download/generation/manifest.sig",
  assetBaseUrl: "https://github.com/example/repo/releases/download/generation",
  manifestBytes: 100, manifestSha256: "a".repeat(64), publicKeySha256: "b".repeat(64)
};

const manifest = {
  format: "ntforum-compact-search", schemaVersion: 1, watermark: pointer.watermark,
  documentCount: 2, termCount: 3, bytes: 500, compressedBytes: 100,
  sha256: "c".repeat(64), payloadSha256: "d".repeat(64), compressedSha256: "e".repeat(64),
  chunkBytesLimit: 100, chunks: [{ name: "ntforum-search-v1-0000.gz.part", bytes: 100, sha256: "f".repeat(64) }],
  privacy: { emails: false, blockedAuthors: ["monkeybutler", "soulisdead"] }
};

test("default fetch remains bound to the worker global", async () => {
  const originalFetch = global.fetch;
  let receiver;
  global.fetch = async function () {
    "use strict";
    receiver = this;
    return { ok: true };
  };
  try {
    const reader = new CompactReader({
      pointerUrl: "https://github.com/example/latest.json",
      publicKeyUrl: "https://github.com/example/public.pem",
      cachesImpl: {}, storageManager: {}, cryptoImpl: {},
    });
    await reader.fetchOk(reader.pointerUrl);
    assert.equal(receiver, globalThis);
  } finally {
    global.fetch = originalFetch;
  }
});

test("accepts only the signed compact GitHub pointer contract", () => {
  assert.equal(validatePointer(pointer), pointer);
  assert.equal(validatePointer({ ...pointer, generationTag: "search-compact-editable-v1-20260831T085524-abcdef123456" }).generationTag,
    "search-compact-editable-v1-20260831T085524-abcdef123456");
  assert.throws(() => validatePointer({ ...pointer, manifestUrl: "http://example.invalid/index" }), /Invalid compact asset URL/);
  assert.throws(() => validatePointer({ ...pointer, schemaVersion: 2 }), /Invalid compact index pointer/);
});

test("fails closed for privacy, chunk, count and watermark mismatches", () => {
  assert.equal(validateManifest(manifest, pointer), manifest);
  assert.throws(() => validateManifest({ ...manifest, privacy: { emails: true } }, pointer), /Invalid compact manifest/);
  assert.throws(() => validateManifest({ ...manifest, watermark: "older" }, pointer), /Invalid compact manifest/);
  assert.throws(() => validateManifest({ ...manifest, compressedBytes: 99 }, pointer), /Compact chunk sizes disagree/);
  assert.throws(() => validateManifest({ ...manifest, chunks: [{ ...manifest.chunks[0], bytes: 101 }] }, pointer), /Invalid compact chunk declaration/);
});
