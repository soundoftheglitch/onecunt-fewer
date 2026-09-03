(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsSavedState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-saved-threads";
  const DB_VERSION = 1;
  const MAX_RECORDS = 2000;

  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Saved-thread transaction aborted"));
  }); }
  function normalise(value, now = () => new Date().toISOString()) {
    const threadId = Number(value && value.threadId);
    if (!Number.isSafeInteger(threadId) || threadId < 1) throw new Error("A valid thread is required");
    const canonicalUrl = new URL(String(value.canonicalUrl || `/thread/${threadId}`), "https://ntforum.net");
    if (canonicalUrl.origin !== "https://ntforum.net") throw new Error("Saved thread URL must belong to NTForum");
    return { threadId, docKey: `t:${threadId}`, title: String(value.title || "Untitled thread").trim().slice(0, 300),
      username: String(value.username || "").trim().slice(0, 100), createdUtc: String(value.createdUtc || ""),
      canonicalUrl: `https://ntforum.net/thread/${threadId}`, savedUtc: String(value.savedUtc || now()) };
  }

  class SavedThreadRepository {
    constructor(indexedDb = indexedDB, maximum = MAX_RECORDS, now = () => new Date().toISOString()) {
      this.indexedDb = indexedDb; this.maximum = maximum; this.now = now; this.promise = null;
    }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const records = request.result.createObjectStore("records", { keyPath: "threadId" });
          records.createIndex("savedUtc", "savedUtc", { unique: false });
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async records() { const database = await this.db(); return requestResult(
      database.transaction("records", "readonly").objectStore("records").getAll()); }
    async ids() { return (await this.records()).map(record => record.threadId); }
    async list(offset = 0, limit = 25) {
      const records = (await this.records()).sort((a, b) => String(b.savedUtc).localeCompare(String(a.savedUtc))
        || b.threadId - a.threadId);
      const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
      return { total: records.length, items: records.slice(start, start + size) };
    }
    async save(value) {
      const record = normalise(value, this.now); const database = await this.db();
      const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      const existing = await requestResult(store.get(record.threadId));
      store.put(existing ? { ...record, savedUtc: existing.savedUtc } : record);
      await transactionDone(transaction);
      const records = (await this.records()).sort((a, b) => String(b.savedUtc).localeCompare(String(a.savedUtc)));
      if (records.length > this.maximum) {
        const trim = database.transaction("records", "readwrite");
        for (const item of records.slice(this.maximum)) trim.objectStore("records").delete(item.threadId);
        await transactionDone(trim);
      }
      return { saved: true, threadId: record.threadId, ids: await this.ids() };
    }
    async remove(threadId) {
      const id = Number(threadId); const database = await this.db(); const transaction = database.transaction("records", "readwrite");
      transaction.objectStore("records").delete(id); await transactionDone(transaction);
      return { saved: false, threadId: id, ids: await this.ids() };
    }
    async toggle(value) {
      const id = Number(value && value.threadId); const database = await this.db();
      const existing = await requestResult(database.transaction("records", "readonly").objectStore("records").get(id));
      return existing ? this.remove(id) : this.save(value);
    }
    async clear() {
      const database = await this.db(); const transaction = database.transaction("records", "readwrite");
      transaction.objectStore("records").clear(); await transactionDone(transaction); return { ids: [], total: 0 };
    }
    async exportRecords() { return (await this.records()).map(({ threadId, docKey, title, username, createdUtc, canonicalUrl, savedUtc }) =>
      ({ threadId, docKey, title, username, createdUtc, canonicalUrl, savedUtc })); }
  }

  return { DB_NAME, DB_VERSION, MAX_RECORDS, SavedThreadRepository, normalise };
});
