(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsMutedThreads = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-muted-threads";
  const DB_VERSION = 1;
  const MAX_RECORDS = 2000;

  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Muted-thread database request failed"));
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Muted-thread transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Muted-thread transaction aborted"));
  }); }

  function normalise(value, now = () => new Date().toISOString()) {
    const threadId = Number(value && value.threadId);
    if (!Number.isSafeInteger(threadId) || threadId < 1) throw new Error("A valid thread is required");
    const url = new URL(String(value.canonicalUrl || `/thread/${threadId}`), "https://ntforum.net");
    if (url.origin !== "https://ntforum.net" || !new RegExp(`^/thread/${threadId}/?$`).test(url.pathname)) {
      throw new Error("Muted thread URL must identify the same NTForum thread");
    }
    const title = Array.from(String(value.title || "Untitled thread").normalize("NFKC").trim()).slice(0, 300).join("");
    const username = Array.from(String(value.username || "").normalize("NFKC").trim()).slice(0, 100).join("");
    if (/[\x00-\x1f\x7f]/u.test(title) || /[\x00-\x1f\x7f]/u.test(username)) {
      throw new Error("Muted thread metadata contains control characters");
    }
    const mutedUtc = String(value.mutedUtc || now());
    if (!Number.isFinite(Date.parse(mutedUtc))) throw new Error("Muted time is invalid");
    return { threadId, docKey: `t:${threadId}`,
      title, username,
      canonicalUrl: `https://ntforum.net/thread/${threadId}`,
      mutedUtc };
  }

  function visibleRecords(records, mutedThreadIds, revealHidden = false) {
    const values = Array.isArray(records) ? records : [];
    if (revealHidden) return values.slice();
    const muted = new Set((Array.isArray(mutedThreadIds) ? mutedThreadIds : []).map(Number));
    return values.filter(record => !muted.has(Number(record && record.threadId)));
  }

  class MutedThreadRepository {
    constructor(indexedDb = indexedDB, maximum = MAX_RECORDS, now = () => new Date().toISOString()) {
      this.indexedDb = indexedDb; this.maximum = Math.max(1, Math.min(MAX_RECORDS, Number(maximum) || MAX_RECORDS)); this.now = now; this.promise = null;
    }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const records = request.result.createObjectStore("records", { keyPath: "threadId" });
          records.createIndex("mutedUtc", "mutedUtc", { unique: false });
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async records() {
      const database = await this.db(); const stored = await requestResult(
        database.transaction("records", "readonly").objectStore("records").getAll());
      const valid = []; const invalid = [];
      for (const value of stored) {
        try { valid.push(normalise(value, this.now)); } catch (_error) { invalid.push(value && value.threadId); }
      }
      if (invalid.length) {
        const transaction = database.transaction("records", "readwrite");
        for (const id of invalid) transaction.objectStore("records").delete(id);
        await transactionDone(transaction);
      }
      return valid;
    }
    async ids() { return (await this.records()).map(item => item.threadId); }
    async list(offset = 0, limit = 25) {
      const records = (await this.records()).sort((a, b) => String(b.mutedUtc).localeCompare(String(a.mutedUtc))
        || b.threadId - a.threadId);
      const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
      return { total: records.length, items: records.slice(start, start + size) };
    }
    async mute(value) {
      const record = normalise(value, this.now); const database = await this.db();
      const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      const old = await requestResult(store.get(record.threadId)); store.put(old ? { ...record, mutedUtc: old.mutedUtc } : record);
      await transactionDone(transaction);
      const records = (await this.records()).sort((a, b) => String(b.mutedUtc).localeCompare(String(a.mutedUtc)));
      if (records.length > this.maximum) {
        const trim = database.transaction("records", "readwrite");
        for (const item of records.slice(this.maximum)) trim.objectStore("records").delete(item.threadId);
        await transactionDone(trim);
      }
      return { muted: true, threadId: record.threadId, ids: await this.ids() };
    }
    async remove(threadId) {
      const id = Number(threadId); if (!Number.isSafeInteger(id) || id < 1) throw new Error("A valid thread is required");
      const database = await this.db(); const transaction = database.transaction("records", "readwrite");
      transaction.objectStore("records").delete(id); await transactionDone(transaction);
      return { muted: false, threadId: id, ids: await this.ids() };
    }
    async toggle(value) { const id = Number(value && value.threadId); return (await this.ids()).includes(id)
      ? this.remove(id) : this.mute(value); }
    async clear() { const database = await this.db(); const transaction = database.transaction("records", "readwrite");
      transaction.objectStore("records").clear(); await transactionDone(transaction); return { ids: [], total: 0 }; }
  }

  return { DB_NAME, DB_VERSION, MAX_RECORDS, MutedThreadRepository, normalise, visibleRecords };
});
