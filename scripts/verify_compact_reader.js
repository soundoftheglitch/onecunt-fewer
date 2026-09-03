#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const { CompactReader } = require("../search/compact-reader.js");

class MemoryCache {
  constructor() { this.values = new Map(); }
  key(value) { return typeof value === "string" ? value : value.url; }
  async match(value) { const found = this.values.get(this.key(value)); return found && new Response(found.bytes.slice(0), { headers: found.headers }); }
  async put(key, response) { this.values.set(this.key(key), { bytes: await response.arrayBuffer(), headers: [...response.headers] }); }
  async delete(value) { return this.values.delete(this.key(value)); }
  async keys() { return [...this.values.keys()].map(url => new Request(url)); }
}

async function main() {
  const cache = new MemoryCache();
  let generationRequests = 0;
  const publicKey = await fs.readFile(path.join(__dirname, "../search/index-signing-public.pem"));
  const fetchImpl = async (url, options) => {
    if (url === "extension://index-signing-public.pem") return new Response(publicKey);
    if (String(url).includes("search-compact-v1-")) generationRequests += 1;
    return fetch(url, options);
  };
  const reader = new CompactReader({
    pointerUrl: "https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.0/search-latest.json",
    publicKeyUrl: "extension://index-signing-public.pem", fetchImpl,
    cachesImpl: { open: async () => cache }, storageManager: { estimate: async () => ({ usage: 0, quota: 2_000_000_000 }) },
    cryptoImpl: webcrypto
  });
  const pointer = await reader.fetchPointer();
  const installed = await reader.install();
  if (installed.result !== "installed" || installed.active.documentCount < 300000
      || installed.active.generationTag !== pointer.generationTag) throw new Error("Public generation was not installed");
  const header = new Uint8Array(await reader.read(0, 8));
  if (Buffer.from(header).toString("binary") !== "NTFSIDX\0") throw new Error("Bounded read returned the wrong generation");
  const before = generationRequests;
  const unchanged = await reader.install();
  if (unchanged.result !== "unchanged" || generationRequests !== before) throw new Error("Unchanged pointer downloaded generation assets");
  console.log(JSON.stringify({ result: "pass", generation: installed.active.generationTag,
    documents: installed.active.documentCount, bytes: installed.active.bytes,
    boundedRead: true, unchangedRequests: generationRequests - before }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
