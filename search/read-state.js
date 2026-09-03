(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsReadState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-read-state";
  const DB_VERSION = 1;
  const MAX_RECORDS = 5000;

  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Read-state transaction aborted"));
  }); }
  function fingerprint(document) {
    return JSON.stringify([document.docKey, document.threadId, document.parentPostId ?? null,
      document.username || "", document.title || "", document.body || "", document.createdUtc || ""]);
  }
  function item(document, unread) {
    return { docKey: document.docKey, threadId: document.threadId,
      postId: document.kind === "r" ? document.postId : null, kind: document.kind,
      parentPostId: document.parentPostId ?? null, title: document.title || "Untitled post",
      threadTitle: document.threadTitle || document.title || "Untitled thread",
      username: document.username || "", createdUtc: document.createdUtc || "",
      canonicalUrl: document.canonicalUrl, snippet: String(document.body || "").replace(/\s+/g, " ").trim().slice(0, 240),
      replyCount: Number(document.replyCount) || 0, unread: Boolean(unread) };
  }

  class ReadStateRepository {
    constructor(indexedDb = indexedDB, maximum = MAX_RECORDS) {
      this.indexedDb = indexedDb; this.maximum = maximum; this.promise = null;
    }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const database = request.result;
          const records = database.createObjectStore("records", { keyPath: "docKey" });
          records.createIndex("threadId", "threadId", { unique: false });
          records.createIndex("createdUtc", "createdUtc", { unique: false });
          database.createObjectStore("meta", { keyPath: "name" });
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async refresh(documents) {
      const ordered = [...documents].filter(value => value && /^[tr]:\d+$/.test(String(value.docKey || "")))
        .sort((a, b) => String(b.createdUtc || "").localeCompare(String(a.createdUtc || ""))
          || String(b.docKey).localeCompare(String(a.docKey))).slice(0, this.maximum);
      const database = await this.db();
      const initialized = await requestResult(database.transaction("meta", "readonly").objectStore("meta").get("initialized"));
      const prior = new Map((await requestResult(database.transaction("records", "readonly")
        .objectStore("records").getAll())).map(value => [value.docKey, value]));
      const keep = new Set(); const transaction = database.transaction(["records", "meta"], "readwrite");
      const records = transaction.objectStore("records");
      for (const document of ordered) {
        const currentFingerprint = fingerprint(document); const old = prior.get(document.docKey); keep.add(document.docKey);
        records.put({ ...item(document, false), source: "activity", currentFingerprint,
          readFingerprint: old ? old.readFingerprint : (initialized ? null : currentFingerprint) });
      }
      for (const [key, record] of prior) if (!keep.has(key) && record.source !== "presented") records.delete(key);
      if (!initialized) transaction.objectStore("meta").put({ name: "initialized", enabledUtc: new Date().toISOString() });
      await transactionDone(transaction);
      return this.summary();
    }
    async upsert(documents) {
      const values = [...documents].filter(value => value && /^[tr]:\d+$/.test(String(value.docKey || "")));
      if (!values.length) return this.summary();
      const database = await this.db();
      const [mode, priorValues] = await Promise.all([
        requestResult(database.transaction("meta", "readonly").objectStore("meta").get("forceUnread")),
        requestResult(database.transaction("records", "readonly").objectStore("records").getAll())
      ]);
      const prior = new Map(priorValues.map(value => [value.docKey, value]));
      const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      for (const document of values) {
        const currentFingerprint = fingerprint(document); const old = prior.get(document.docKey);
        store.put({ ...item(document, false), source: "presented", touchedUtc: new Date().toISOString(), currentFingerprint,
          readFingerprint: old ? old.readFingerprint : (mode?.enabled ? null : currentFingerprint) });
      }
      await transactionDone(transaction);
      const ordered = (await this.records()).sort((a, b) => String(b.touchedUtc || b.createdUtc).localeCompare(String(a.touchedUtc || a.createdUtc))
        || String(b.docKey).localeCompare(String(a.docKey)));
      if (ordered.length > this.maximum) {
        const trim = database.transaction("records", "readwrite");
        for (const record of ordered.slice(this.maximum)) trim.objectStore("records").delete(record.docKey);
        await transactionDone(trim);
      }
      return this.summary();
    }
    async records() { const database = await this.db(); return requestResult(
      database.transaction("records", "readonly").objectStore("records").getAll()); }
    async summary() {
      const records = await this.records(); const threads = new Map(); let total = 0;
      for (const record of records) {
        const unread = record.readFingerprint !== record.currentFingerprint;
        if (unread) total += 1;
        const state = threads.get(record.threadId) || { threadId: record.threadId, unreadCount: 0, totalCount: 0 };
        state.totalCount += 1; if (unread) state.unreadCount += 1; threads.set(record.threadId, state);
      }
      const database = await this.db();
      const mode = await requestResult(database.transaction("meta", "readonly").objectStore("meta").get("forceUnread"));
      return { total, allUnread: Boolean(mode?.enabled), threads: [...threads.values()], unreadDocKeys: records
        .filter(record => record.readFingerprint !== record.currentFingerprint).map(record => record.docKey),
        readDocKeys: records.filter(record => record.readFingerprint === record.currentFingerprint).map(record => record.docKey) };
    }
    async unread(offset = 0, limit = 25) {
      const records = (await this.records()).filter(record => record.readFingerprint !== record.currentFingerprint)
        .sort((a, b) => String(b.createdUtc).localeCompare(String(a.createdUtc)) || b.docKey.localeCompare(a.docKey));
      const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
      return { total: records.length, firstUnread: records.length ? { ...records[records.length - 1], unread: true } : null,
        items: records.slice(start, start + size).map(record => ({ ...record, unread: true })) };
    }
    async mark({ docKeys = [], threadId = null, all = false } = {}) {
      const database = await this.db(); const transaction = database.transaction(all ? ["records", "meta"] : "records", "readwrite");
      const store = transaction.objectStore("records"); let records;
      if (all) { records = await requestResult(store.getAll());
        transaction.objectStore("meta").put({ name: "forceUnread", enabled: false, changedUtc: new Date().toISOString() }); }
      else if (threadId !== null && threadId !== undefined && Number.isSafeInteger(Number(threadId))) {
        records = await requestResult(store.index("threadId").getAll(Number(threadId)));
      }
      else records = (await Promise.all([...new Set(docKeys)].map(key => requestResult(store.get(String(key)))))).filter(Boolean);
      for (const record of records) store.put({ ...record, touchedUtc: new Date().toISOString(), readFingerprint: record.currentFingerprint });
      await transactionDone(transaction); return this.summary();
    }
    async markAllUnread(docKeys = []) {
      const database = await this.db(); const transaction = database.transaction(["records", "meta"], "readwrite");
      const store = transaction.objectStore("records");
      const records = (await Promise.all([...new Set(docKeys)].map(key => requestResult(store.get(String(key)))))).filter(Boolean);
      for (const record of records) store.put({ ...record, readFingerprint: null });
      transaction.objectStore("meta").put({ name: "forceUnread", enabled: true, changedUtc: new Date().toISOString() });
      await transactionDone(transaction); return { ...await this.summary(), marked: records.length };
    }
  }

  return { DB_NAME, DB_VERSION, MAX_RECORDS, ReadStateRepository, fingerprint, item };
});
