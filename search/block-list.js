(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsBlockList = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-block-list";
  const DB_VERSION = 1;
  const DEFAULT_USERNAMES = Object.freeze(["Soulisdead", "monkeybutler"]);
  const MAX_USERNAMES = 64;
  const MAX_USERNAME_LENGTH = 64;

  function normalise(value) {
    return String(value == null ? "" : value).normalize("NFKC").trim().toLocaleLowerCase();
  }

  function cleanUsername(value) {
    const display = String(value == null ? "" : value).normalize("NFKC").trim();
    if (!display || Array.from(display).length > MAX_USERNAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(display)) {
      throw new Error("Username must be 1–64 visible characters");
    }
    return display;
  }

  function validate(usernames) {
    if (!Array.isArray(usernames) || usernames.length > MAX_USERNAMES) throw new Error("Invalid blocked-user list");
    const values = []; const seen = new Set();
    for (const raw of usernames) {
      const display = cleanUsername(raw); const key = normalise(display);
      if (seen.has(key)) continue;
      seen.add(key); values.push(display);
    }
    return values;
  }

  function defaults() { return [...DEFAULT_USERNAMES]; }

  function visibleDocuments(documents, usernames) {
    const blocked = new Set(validate(usernames).map(normalise));
    const byKey = new Map(documents.map(item => [item.docKey, item])); const memo = new Map();
    const visible = document => {
      if (!document || blocked.has(normalise(document.username))) return false;
      if (!document.parentPostId) return true;
      if (memo.has(document.docKey)) return memo.get(document.docKey);
      const value = visible(byKey.get(`r:${document.parentPostId}`)); memo.set(document.docKey, value); return value;
    };
    return documents.filter(visible);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Block-list database request failed"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Block-list transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("Block-list transaction aborted"));
    });
  }

  class BlockListRepository {
    constructor(indexedDb = indexedDB) { this.indexedDb = indexedDb; this.promise = null; }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.result.createObjectStore("settings", { keyPath: "name" });
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async get() {
      const database = await this.db();
      const record = await requestResult(database.transaction("settings", "readonly").objectStore("settings").get("blocked-users"));
      if (!record) return { usernames: defaults(), source: "defaults" };
      try { return { usernames: validate(record.usernames), source: "custom" }; }
      catch (_error) { return { usernames: defaults(), source: "recovered-defaults" }; }
    }
    async set(usernames) {
      const values = validate(usernames); const database = await this.db();
      const transaction = database.transaction("settings", "readwrite");
      transaction.objectStore("settings").put({ name: "blocked-users", usernames: values, updatedUtc: new Date().toISOString() });
      await transactionDone(transaction); return { usernames: values, source: "custom" };
    }
    async reset() {
      const database = await this.db(); const transaction = database.transaction("settings", "readwrite");
      transaction.objectStore("settings").delete("blocked-users"); await transactionDone(transaction);
      return { usernames: defaults(), source: "defaults" };
    }
  }

  return { BlockListRepository, DB_NAME, DB_VERSION, DEFAULT_USERNAMES, MAX_USERNAMES,
    MAX_USERNAME_LENGTH, cleanUsername, defaults, normalise, validate, visibleDocuments };
});
