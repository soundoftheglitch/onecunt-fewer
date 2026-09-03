(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsIndexMigration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-index-control";
  const DB_VERSION = 1;
  const STATE_KEY = "migration";

  function requestResult(request) { return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Migration transaction aborted"));
  }); }

  class MigrationStateRepository {
    constructor(indexedDb = indexedDB) { this.indexedDb = indexedDb; this.promise = null; }
    db() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DB_NAME, DB_VERSION); request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.result.createObjectStore("state", { keyPath: "name" });
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      });
      return this.promise;
    }
    async get() { const db = await this.db(); return (await requestResult(
      db.transaction("state", "readonly").objectStore("state").get(STATE_KEY))) ||
      { name: STATE_KEY, phase: "pending", cleared: false, pendingThreadIds: [] }; }
    async put(value) { const db = await this.db(); const transaction = db.transaction("state", "readwrite");
      transaction.objectStore("state").put({ ...value, name: STATE_KEY }); await transactionDone(transaction);
      return this.get(); }
  }

  class LegacyProfileInspector {
    constructor(indexedDb = indexedDB, databaseName = "fewercunts-search-v2") {
      this.indexedDb = indexedDb; this.databaseName = databaseName;
    }
    async database() {
      if (typeof this.indexedDb.databases === "function") {
        const databases = await this.indexedDb.databases();
        if (!databases.some(item => item.name === this.databaseName)) return null;
      }
      return new Promise((resolve, reject) => {
        const request = this.indexedDb.open(this.databaseName);
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
      });
    }
    async record(storeName, key) {
      const db = await this.database();
      if (!db || !db.objectStoreNames.contains(storeName)) { if (db) db.close(); return null; }
      try { return await requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key)); }
      finally { db.close(); }
    }
    async getSync() { return this.record("sync", "initial-import"); }
    async getSettings() { return { enabled: true, refreshMinutes: 15,
      ...await this.record("settings", "search-settings") }; }
  }

  class IndexMigrationCoordinator {
    constructor({ state, legacy, profile = legacy, compactManager, compiledQuery, delta, now = () => new Date().toISOString() } = {}) {
      if (!state || !legacy || !compactManager || !compiledQuery || !delta) throw new Error("Index migration dependencies are required");
      this.state = state; this.legacy = legacy; this.profile = profile; this.compactManager = compactManager;
      this.compiledQuery = compiledQuery; this.delta = delta; this.now = now; this.operation = null;
      this.pauseRequested = false;
    }
    run(options = {}) {
      if (!this.operation) this.operation = this.runOnce(options).finally(() => { this.operation = null; });
      return this.operation;
    }
    async runOnce({ force = false } = {}) {
      let migration = await this.state.get();
      if (migration.cleared && !force) return { ...migration, phase: "cleared" };
      if (migration.phase === "complete" && migration.activeGenerationId) {
        const reopened = await this.compactManager.startup();
        if (reopened.phase === "ready" && reopened.active?.generationId === migration.activeGenerationId) return migration;
      }
      const [legacyStatus, settings] = await Promise.all([this.profile.getSync(), this.profile.getSettings()]);
      if (!force && (settings.enabled === false || legacyStatus?.cancelled || legacyStatus?.phase === "paused")) {
        return this.state.put({ ...migration, phase: "paused", pausedUtc: this.now(),
          legacySchemaVersion: legacyStatus?.schemaVersion || null });
      }
      migration = await this.state.put({ ...migration, phase: "installing-base", cleared: false,
        legacySchemaVersion: legacyStatus?.schemaVersion || null, settings });
      let compact = await this.compactManager.startup();
      if (compact.phase !== "ready") compact = await this.compactManager.install({ force: false });
      if (!compact.active?.generationId || !compact.active?.watermark) throw new Error("Compiled base did not become searchable");
      if (this.pauseRequested) return this.pause();

      migration = await this.state.put({ ...migration, phase: "smoke-testing",
        candidateGenerationId: compact.active.generationId, baseWatermark: compact.active.watermark });
      // Use a stable rare corpus term: a stop word would force a full high-frequency posting scan
      // precisely when the first-run gate should only prove that the compiled index is queryable.
      const smoke = await this.compiledQuery.search("artisinal", 1, undefined, 0);
      if (!smoke || !Array.isArray(smoke.items) || !Number.isFinite(smoke.total) || smoke.total < 1) {
        throw new Error("Compiled base query smoke test failed");
      }
      if (this.pauseRequested) return this.pause();

      migration = await this.state.put({ ...migration, phase: "copying-delta",
        candidateGenerationId: compact.active.generationId, baseWatermark: compact.active.watermark });
      if (!migration.pendingThreadIds?.length) {
        const snapshot = await this.legacy.migrationSnapshot(compact.active.watermark);
        migration = await this.state.put({ ...migration, pendingThreadIds: snapshot.map(item => item.thread.threadId) });
      }
      while (migration.pendingThreadIds.length) {
        if (this.pauseRequested) return this.pause();
        const threadId = migration.pendingThreadIds[0];
        const item = await this.legacy.migrationThread(threadId);
        if (item) await this.delta.replaceThread(item.thread, item.replies);
        migration = await this.state.put({ ...migration, pendingThreadIds: migration.pendingThreadIds.slice(1) });
      }
      if (this.pauseRequested) return this.pause();
      await this.legacy.retireSearchPostings();
      if (this.pauseRequested) return this.pause();
      return this.state.put({ ...migration, phase: "complete", completedUtc: this.now(),
        activeGenerationId: compact.active.generationId, smokeTotal: smoke.total, pendingThreadIds: [] });
    }
    async pause() { this.pauseRequested = true; const current = await this.state.get();
      return this.state.put({ ...current, phase: "paused", pausedUtc: this.now() }); }
    async clear() { const current = await this.state.get(); return this.state.put({ ...current, phase: "cleared",
      cleared: true, clearedUtc: this.now(), pendingThreadIds: [] }); }
    async resume() { this.pauseRequested = false; const current = await this.state.get(); await this.state.put({ ...current, cleared: false, phase: "pending" });
      return this.run({ force: true }); }
  }

  return { DB_NAME, DB_VERSION, IndexMigrationCoordinator, LegacyProfileInspector, MigrationStateRepository, STATE_KEY };
});
