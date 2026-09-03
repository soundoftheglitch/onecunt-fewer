(function (root, factory) {
  const indexer = typeof module === "object" && module.exports ? require("./indexer.js") : root.FewerCuntsIndexer;
  const api = factory(indexer);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsCompactDelta = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (indexer) {
  "use strict";

  const DEFAULT_DEBOUNCE_MS = 15 * 60 * 1000;
  const OVERLAP_MS = 48 * 60 * 60 * 1000;
  const MAX_CATALOGUE_PAGES = 8;
  const DB_NAME = "fewercunts-compact-delta";
  const DB_VERSION = 1;

  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Compact delta transaction aborted"));
  }); }

  class CompactDeltaRepository {
    constructor(indexedDb = indexedDB) { this.indexedDb = indexedDb; this.promise = null; }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION); request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const database = request.result;
          const documents = database.createObjectStore("documents", { keyPath: "docKey" });
          documents.createIndex("threadId", "threadId", { unique: false });
          const threads = database.createObjectStore("threads", { keyPath: "threadId" });
          threads.createIndex("lastPostUtc", "lastPostUtc", { unique: false });
          database.createObjectStore("state", { keyPath: "name" });
          database.createObjectStore("tombstones", { keyPath: "threadId" });
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async state() { const database = await this.db(); const value = await requestResult(
      database.transaction("state", "readonly").objectStore("state").get("sync"));
      return value || { name: "sync", phase: "idle", pending: [], pendingRemovals: [] }; }
    async clear() { const database = await this.db(); const transaction = database.transaction(
      ["documents", "threads", "state", "tombstones"], "readwrite");
      for (const name of ["documents", "threads", "state", "tombstones"]) transaction.objectStore(name).clear();
      await transactionDone(transaction); }
    async putState(value) { const database = await this.db(); const transaction = database.transaction("state", "readwrite");
      transaction.objectStore("state").put({ ...value, name: "sync" }); await transactionDone(transaction); }
    async threadMetadata(threadId) { const database = await this.db(); return requestResult(
      database.transaction("threads", "readonly").objectStore("threads").get(Number(threadId))); }
    async threadIdsSince(cutoff) { const database = await this.db(); return requestResult(database.transaction("threads", "readonly")
      .objectStore("threads").index("lastPostUtc").getAllKeys(IDBKeyRange.lowerBound(cutoff))); }
    async replaceThread(thread, replies) {
      const database = await this.db(); const transaction = database.transaction(["documents", "threads", "tombstones"], "readwrite");
      const documents = transaction.objectStore("documents"); const index = documents.index("threadId");
      await new Promise((resolve, reject) => { const cursor = index.openKeyCursor(IDBKeyRange.only(thread.threadId));
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
          if (!cursor.result) return resolve(); documents.delete(cursor.result.primaryKey); cursor.result.continue();
        }; });
      for (const document of [thread.root, ...replies]) documents.put(document);
      transaction.objectStore("threads").put(metadata(thread)); transaction.objectStore("tombstones").delete(thread.threadId);
      await transactionDone(transaction);
    }
    async deleteThread(threadId) {
      const database = await this.db(); const transaction = database.transaction(["documents", "threads", "tombstones"], "readwrite");
      const documents = transaction.objectStore("documents"); const index = documents.index("threadId");
      await new Promise((resolve, reject) => { const cursor = index.openKeyCursor(IDBKeyRange.only(Number(threadId)));
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
          if (!cursor.result) return resolve(); documents.delete(cursor.result.primaryKey); cursor.result.continue();
        }; });
      transaction.objectStore("threads").delete(Number(threadId));
      transaction.objectStore("tombstones").put({ threadId: Number(threadId), deletedUtc: new Date().toISOString() });
      await transactionDone(transaction);
    }
    async documentKeys() { const database = await this.db(); return requestResult(
      database.transaction("documents", "readonly").objectStore("documents").getAllKeys()); }
    async documents() { const database = await this.db(); return requestResult(
      database.transaction("documents", "readonly").objectStore("documents").getAll()); }
    async catalogueThreads() { return (await this.documents()).filter(document => document.kind === "t"); }
    async tombstonedThreadIds() { const database = await this.db(); return requestResult(
      database.transaction("tombstones", "readonly").objectStore("tombstones").getAllKeys()); }
    async search(query, scopes, blockedUsernames = [], mutedThreadIds = [], revealHidden = false, resultKind = "") {
      const clauses = indexer.parseQuery(query); if (!clauses.length) return [];
      const database = await this.db(); const documents = await requestResult(
        database.transaction("documents", "readonly").objectStore("documents").getAll());
      const byKey = new Map(documents.map(document => [document.docKey, document]));
      const blocked = new Set(blockedUsernames.map(value => indexer.normalise(value).trim()).filter(Boolean));
      const muted = new Set(mutedThreadIds.map(Number));
      const visible = document => document && (revealHidden || (!blocked.has(indexer.normalise(document.username).trim())
        && !muted.has(Number(document.threadId))))
        && (!document.parentPostId || visible(byKey.get(`r:${document.parentPostId}`)));
      return documents.filter(document => (!resultKind || document.kind === resultKind) && visible(document))
        .map(document => ({ document, score: indexer.scoreDocument(document, clauses, scopes) }))
        .filter(item => item.score).map(({ document, score }) => ({ docKey: document.docKey,
          threadId: document.threadId, postId: document.kind === "r" ? document.postId : null,
          title: document.title, username: document.username, createdUtc: document.createdUtc,
          lastPostUtc: (byKey.get(`t:${document.threadId}`) || document).lastPostUtc || document.createdUtc,
          replyCount: Math.max(0, Number((byKey.get(`t:${document.threadId}`) || document).replyCount) || 0),
          kind: document.kind, threadTitle: document.title, canonicalUrl: document.canonicalUrl,
          snippet: indexer.makeSnippet(document, clauses), score, archived: indexer.isArchivedRoot(document) }));
    }
    async navigationTarget(docKey) {
      const database = await this.db(); const store = database.transaction("documents", "readonly").objectStore("documents");
      const target = await requestResult(store.get(String(docKey || "")));
      if (!target) throw new Error("Delta post not found");
      const root = target.kind === "t" ? target : await requestResult(store.get(`t:${target.threadId}`));
      return indexer.makeNavigationPayload(root, target);
    }
    async pruneThrough(watermark) {
      const database = await this.db(); const transaction = database.transaction(["documents", "threads", "tombstones"], "readwrite");
      const threads = transaction.objectStore("threads"); const documents = transaction.objectStore("documents");
      await new Promise((resolve, reject) => { const cursor = threads.index("lastPostUtc").openCursor(IDBKeyRange.upperBound(watermark));
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
          const item = cursor.result; if (!item) return resolve(); const threadId = item.value.threadId;
          const keys = documents.index("threadId").openKeyCursor(IDBKeyRange.only(threadId));
          keys.onsuccess = () => { if (keys.result) { documents.delete(keys.result.primaryKey); keys.result.continue(); } };
          item.delete(); item.continue();
        }; });
      const tombstones = transaction.objectStore("tombstones");
      await new Promise((resolve, reject) => { const cursor = tombstones.openCursor();
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
          const item = cursor.result; if (!item) return resolve();
          if (item.value.deletedUtc <= watermark) item.delete(); item.continue();
        }; });
      await transactionDone(transaction);
    }
  }

  function signature(thread) {
    return JSON.stringify([thread.root.username, thread.root.title, thread.root.body, thread.root.createdUtc]);
  }
  function recentCutoff(baseWatermark, now) {
    const base = Date.parse(baseWatermark || ""); const current = Number(now);
    if (!Number.isFinite(base)) throw new Error("Compact delta requires a valid base watermark");
    return new Date(Math.min(base, current) - OVERLAP_MS).toISOString();
  }
  function metadata(thread) { return { threadId: thread.threadId, lastPostUtc: thread.lastPostUtc,
    advertisedPostCount: thread.advertisedPostCount, rootSignature: signature(thread) }; }
  function changed(thread, old) { const next = metadata(thread); return !old || old.lastPostUtc !== next.lastPostUtc
    || old.advertisedPostCount !== next.advertisedPostCount || old.rootSignature !== next.rootSignature; }

  class CompactDeltaSynchronizer {
    constructor({ repository, fetchJson, now = Date.now, wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
      requestDelayMs = 750, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
      if (!repository || !fetchJson) throw new Error("Compact delta dependencies are required");
      this.repository = repository; this.fetchJson = fetchJson; this.now = now; this.wait = wait;
      this.requestDelayMs = requestDelayMs; this.debounceMs = debounceMs; this.active = null;
    }
    async due(force = false, debounceMs = this.debounceMs) { const state = await this.repository.state();
      const interval = Math.max(DEFAULT_DEBOUNCE_MS, Number(debounceMs) || this.debounceMs);
      return force || !state.lastSuccessUtc || this.now() - Date.parse(state.lastSuccessUtc) >= interval; }
    async run({ baseWatermark, force = false, debounceMs = this.debounceMs } = {}) {
      if (this.active) return this.active;
      this.active = this.runOnce({ baseWatermark, force, debounceMs }).finally(() => { this.active = null; }); return this.active;
    }
    async runOnce({ baseWatermark, force, debounceMs }) {
      if (!await this.due(force, debounceMs)) return { ...(await this.repository.state()),
        result: "debounced", debounced: true, refreshed: 0, removed: 0, requests: 0 };
      const cutoff = recentCutoff(baseWatermark, this.now()); const candidates = []; const seen = new Set();
      let page = 1; let oldPages = 0; let requests = 0;
      try {
        await this.repository.putState({ ...(await this.repository.state()), phase: "discovering", baseWatermark,
          cutoff, startedUtc: new Date(this.now()).toISOString(), error: null });
        while (page <= MAX_CATALOGUE_PAGES && oldPages < 2) {
          const payload = await this.fetchJson(`/api/forum/threads/page/${page}`); requests += 1;
          const raw = Array.isArray(payload?.Threads) ? payload.Threads : [];
          if (!raw.length) break;
          let recent = 0;
          for (const item of raw) {
            const thread = indexer.sanitiseThread(item);
            if (thread.lastPostUtc < cutoff) continue;
            recent += 1; seen.add(thread.threadId);
            const old = await this.repository.threadMetadata(thread.threadId);
            if (!old && thread.lastPostUtc <= baseWatermark) continue;
            if (changed(thread, old)) candidates.push(thread);
          }
          oldPages = recent ? 0 : oldPages + 1; page += 1;
        }
        const priorRecent = await this.repository.threadIdsSince(cutoff);
        const removals = priorRecent.filter(id => !seen.has(id));
        await this.repository.putState({ ...(await this.repository.state()), phase: "refreshing",
          pending: candidates, pendingRemovals: removals, requests });
        let refreshed = 0;
        for (const thread of candidates) {
          await this.wait(this.requestDelayMs);
          const payload = await this.fetchJson(`/api/forum/thread/${thread.threadId}/replies`); requests += 1;
          const replies = indexer.flattenReplies(Array.isArray(payload) ? payload : (payload?.Replies || []),
            thread.threadId, null, [], false, []);
          await this.repository.replaceThread(thread, replies); refreshed += 1;
          const state = await this.repository.state();
          await this.repository.putState({ ...state, pending: state.pending.slice(1), refreshed, requests });
        }
        for (const threadId of removals) await this.repository.deleteThread(threadId);
        const completedUtc = new Date(this.now()).toISOString();
        const result = { phase: "idle", baseWatermark, cutoff, lastSuccessUtc: completedUtc,
          pending: [], pendingRemovals: [], refreshed, removed: removals.length, requests, result: "updated" };
        await this.repository.putState(result); return result;
      } catch (error) {
        await this.repository.putState({ ...(await this.repository.state()), phase: "offline",
          error: String(error.message || error), requests });
        throw error;
      }
    }
  }

  async function mergedSearch({ baseEngine, deltaRepository, query, limit = 25, scopes, offset = 0,
    blockedUsernames = [], mutedThreadIds = [], revealHidden = false, resultKind = "", exactUsername = "" }) {
    const [delta, tombstones, overrides] = await Promise.all([
      deltaRepository.search(query, scopes, blockedUsernames, mutedThreadIds, revealHidden,
        ...(resultKind ? [resultKind] : [])),
      deltaRepository.tombstonedThreadIds(), deltaRepository.documentKeys()
    ]);
    const windowSize = Math.max(Number(limit) + Number(offset) + delta.length, 100);
    const base = await baseEngine.search(query, windowSize, scopes, 0, blockedUsernames, mutedThreadIds,
      revealHidden, { docKeys: overrides, threadIds: tombstones, ...(resultKind ? { resultKind } : {}), ...(exactUsername ? { exactUsername } : {}) });
    const wanted = exactUsername ? indexer.normalise(exactUsername).trim() : "";
    const visibleDelta = wanted ? delta.filter(item => indexer.normalise(item.username).trim() === wanted) : delta;
    const items = [...base.items, ...visibleDelta];
    const unique = new Map();
    for (const item of items) { const old = unique.get(item.docKey); if (!old || item.score > old.score) unique.set(item.docKey, item); }
    const ordered = [...unique.values()].sort((a, b) => b.score - a.score
      || b.createdUtc.localeCompare(a.createdUtc) || a.docKey.localeCompare(b.docKey));
    const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(Number(limit) || 25, 100));
    return { items: ordered.slice(start, start + size), total: base.total + visibleDelta.length,
      truncated: Boolean(base.truncated), baseTotal: base.total, deltaTotal: visibleDelta.length };
  }

  return { CompactDeltaRepository, CompactDeltaSynchronizer, DB_NAME, DB_VERSION, DEFAULT_DEBOUNCE_MS,
    MAX_CATALOGUE_PAGES, OVERLAP_MS, changed, mergedSearch, metadata, recentCutoff, signature };
});
