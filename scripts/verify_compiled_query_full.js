#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { webcrypto } = require("node:crypto");
const { CompactReader } = require("../search/compact-reader.js");
const { PersistentIndexStorage } = require("../search/persistent-index-storage.js");
const { PersistentIndexReader } = require("../search/persistent-index-reader.js");
const { CompiledQueryEngine } = require("../search/compiled-query.js");

class MemoryCache {
  constructor() { this.values = new Map(); }
  key(value) { return typeof value === "string" ? value : value.url; }
  async match(value) { const item = this.values.get(this.key(value));
    return item && new Response(item.bytes.slice(0), { headers: item.headers }); }
  async put(key, response) { this.values.set(this.key(key),
    { bytes: await response.arrayBuffer(), headers: [...response.headers] }); }
  async delete(value) { return this.values.delete(this.key(value)); }
  async keys() { return [...this.values.keys()].map(url => new Request(url)); }
}

async function main() {
  const publicKey = await fs.readFile(path.join(__dirname, "../search/index-signing-public.pem"));
  let githubRequests = 0; let ntforumRequests = 0;
  const fetchImpl = async (url, options) => {
    if (url === "extension://index-signing-public.pem") return new Response(publicKey);
    const parsed = new URL(url); if (parsed.hostname === "ntforum.net") ntforumRequests += 1; else githubRequests += 1;
    return fetch(url, options);
  };
  const downloader = new CompactReader({
    pointerUrl: "https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.0/search-latest.json",
    publicKeyUrl: "extension://index-signing-public.pem", fetchImpl,
    cachesImpl: { open: async () => new MemoryCache() },
    storageManager: { estimate: async () => ({ usage: 0, quota: 2_000_000_000 }) }, cryptoImpl: webcrypto
  });
  const pointer = await downloader.fetchPointer(); const downloaded = await downloader.download(pointer);
  process.stderr.write("downloaded\n");
  const cache = new MemoryCache(); const storage = new PersistentIndexStorage({
    cachesImpl: { open: async () => cache }, cryptoImpl: webcrypto,
    storageManager: { estimate: async () => ({ usage: 0, quota: 2_000_000_000 }) }
  });
  const generation = await storage.writeGeneration({ manifestSha256: pointer.manifestSha256,
    watermark: downloaded.manifest.watermark, bytes: downloaded.manifest.bytes,
    sha256: downloaded.manifest.sha256, documentCount: downloaded.manifest.documentCount,
    termCount: downloaded.manifest.termCount,
    source: { generationTag: pointer.generationTag, manifestUrl: pointer.manifestUrl } }, downloaded.raw.stream());
  process.stderr.write("stored\n");
  downloaded.raw = null;
  if (global.gc) global.gc();
  let largestRead = 0; let readCalls = 0; const originalRead = storage.read.bind(storage);
  storage.read = async (...args) => { largestRead = Math.max(largestRead, args[2]); readCalls += 1; return originalRead(...args); };
  const reader = new PersistentIndexReader({ storage, cryptoImpl: webcrypto });
  const openStart = performance.now(); await reader.open(generation.generationId); const openMs = performance.now() - openStart;
  process.stderr.write(`opened ${Math.round(openMs)}ms\n`);
  const engine = new CompiledQueryEngine({ reader });
  const queries = ["artisinal", "GTA", "coffee", 'body:"great power"', "title:artis*"];
  const timings = {};
  for (const query of queries) {
    process.stderr.write(`query ${query}\n`);
    const coldStart = performance.now(); const cold = await engine.search(query, 25); const coldMs = performance.now() - coldStart;
    const warmStart = performance.now(); const warm = await engine.search(query, 25); const warmMs = performance.now() - warmStart;
    if (!Array.isArray(cold.items) || !Array.isArray(warm.items)) throw new Error(`Invalid results for ${query}`);
    if (query === "coffee" && cold.total <= 25) throw new Error("Coffee full-corpus fixture no longer exceeds one result page");
    timings[query] = { coldMs: Math.round(coldMs), warmMs: Math.round(warmMs), total: cold.total,
      returned: cold.items.length, truncated: cold.truncated };
  }
  if (largestRead > 1024 * 1024 || ntforumRequests) throw new Error("Compiled query crossed its local bounded-read boundary");
  console.log(JSON.stringify({ result: "pass", documents: generation.documentCount, terms: generation.termCount,
    rawBytes: generation.bytes, chunks: generation.chunks.length, openMs: Math.round(openMs),
    largestRead, readCalls, githubRequests, ntforumRequests, timings }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
