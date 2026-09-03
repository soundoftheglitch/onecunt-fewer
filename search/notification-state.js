(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsNotificationState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-notification-state";
  const DB_VERSION = 1;
  const MAX_RECORDS = 1000;
  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Notification transaction aborted"));
  }); }
  function username(value) { return String(value || "").trim().toLocaleLowerCase(); }
  function notification(document, detectedUtc = new Date().toISOString()) {
    if (!document || !/^r:\d+$/.test(String(document.docKey || ""))) throw new TypeError("Invalid reply notification");
    return { docKey: document.docKey, threadId: Number(document.threadId), postId: Number(document.postId),
      parentPostId: Number(document.parentPostId) || null, username: String(document.username || ""),
      title: String(document.threadTitle || document.title || "Reply").slice(0, 300),
      snippet: String(document.body || "").replace(/\s+/g, " ").trim().slice(0, 240),
      createdUtc: String(document.createdUtc || ""), canonicalUrl: String(document.canonicalUrl || ""),
      detectedUtc, read: false, dismissed: false };
  }
  function candidates(documents, ownUsername) {
    const wanted = username(ownUsername); if (!wanted) return [];
    const values = [...documents].filter(Boolean); const ownPosts = new Set(); const ownThreads = new Set();
    for (const document of values) if (username(document.username) === wanted) {
      ownPosts.add(String(document.docKey)); if (document.kind === "t") ownThreads.add(Number(document.threadId));
    }
    return values.filter(document => document.kind === "r" && username(document.username) !== wanted
      && (ownThreads.has(Number(document.threadId)) || ownPosts.has(`r:${Number(document.parentPostId)}`)))
      .sort((a, b) => String(b.createdUtc || "").localeCompare(String(a.createdUtc || ""))
        || String(b.docKey).localeCompare(String(a.docKey)));
  }

  class NotificationRepository {
    constructor(indexedDb = indexedDB, maximum = MAX_RECORDS) { this.indexedDb = indexedDb; this.maximum = maximum; this.promise = null; }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const records = request.result.createObjectStore("records", { keyPath: "docKey" });
          records.createIndex("createdUtc", "createdUtc", { unique: false });
          request.result.createObjectStore("settings", { keyPath: "name" });
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      }); return this.promise;
    }
    async settings(value) {
      const database = await this.db();
      if (value) {
        const record = { name: "config", enabled: value.enabled === true, username: username(value.username),
          browser: value.browser === true };
        const transaction = database.transaction("settings", "readwrite"); transaction.objectStore("settings").put(record);
        await transactionDone(transaction); return { enabled: record.enabled, username: record.username, browser: record.browser };
      }
      const record = await requestResult(database.transaction("settings", "readonly").objectStore("settings").get("config"));
      return record ? { enabled: record.enabled === true, username: username(record.username), browser: record.browser === true }
        : { enabled: false, username: "", browser: false };
    }
    async reconcile(documents, { baseline = false } = {}) {
      const config = await this.settings(); if (!config.enabled || !config.username) return { created: [], total: 0 };
      const database = await this.db(); const existing = new Set((await requestResult(
        database.transaction("records", "readonly").objectStore("records").getAllKeys())).map(String));
      const fresh = candidates(documents, config.username).filter(document => !existing.has(document.docKey));
      const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      for (const document of fresh) store.put({ ...notification(document), read: baseline, dismissed: baseline });
      await transactionDone(transaction); await this.trim();
      return { created: baseline ? [] : fresh.map(document => document.docKey), total: baseline ? 0 : fresh.length };
    }
    async trim() {
      const database = await this.db(); const records = await requestResult(
        database.transaction("records", "readonly").objectStore("records").getAll());
      records.sort((a, b) => String(b.createdUtc).localeCompare(String(a.createdUtc)) || b.docKey.localeCompare(a.docKey));
      const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      for (const record of records.slice(this.maximum)) store.delete(record.docKey); await transactionDone(transaction);
    }
    async list({ includeDismissed = false } = {}) {
      const database = await this.db(); const records = await requestResult(
        database.transaction("records", "readonly").objectStore("records").getAll());
      return records.filter(record => includeDismissed || !record.dismissed)
        .sort((a, b) => String(b.createdUtc).localeCompare(String(a.createdUtc)) || b.docKey.localeCompare(a.docKey));
    }
    async update(docKey, changes) {
      const database = await this.db(); const transaction = database.transaction("records", "readwrite"); const store = transaction.objectStore("records");
      const record = await requestResult(store.get(String(docKey))); if (record) store.put({ ...record,
        read: changes.read == null ? record.read : changes.read === true,
        dismissed: changes.dismissed == null ? record.dismissed : changes.dismissed === true });
      await transactionDone(transaction); return Boolean(record);
    }
    async get(docKey) { const database = await this.db(); return requestResult(
      database.transaction("records", "readonly").objectStore("records").get(String(docKey))); }
  }
  return { DB_NAME, DB_VERSION, MAX_RECORDS, NotificationRepository, candidates, notification, username };
});
