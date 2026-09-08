(function (root, factory) {
  const contract = typeof module === "object" && module.exports
    ? require("./persistent-index-contract.js") : root.FewerCuntsPersistentIndexContract;
  const api = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsPersistentIndexManager = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  class PersistentIndexManager {
    constructor({ storage, reader, downloader, now = () => new Date().toISOString() } = {}) {
      if (!storage || !reader || !downloader) throw new Error("Persistent index manager dependencies are required");
      this.storage = storage; this.reader = reader; this.downloader = downloader; this.now = now;
      this.state = { phase: "idle", active: null, error: null, recovered: false };
      this.operation = null;
    }
    status() { return { ...this.state, freshness: this.freshness || null }; }
    reset() { this.state = { phase: "idle", active: null, error: null, recovered: false }; }
    async openGeneration(generationId, recovered = false) {
      const opened = await this.reader.open(generationId);
      this.state = { phase: "ready", active: opened, error: null, recovered };
      return this.status();
    }
    async startup() {
      if (this.operation) return this.operation;
      if (this.state.phase === "ready" && this.state.active) return this.status();
      if (!this.starting) this.starting = this.restore().finally(() => { this.starting = null; });
      return this.starting;
    }
    async restore() {
      this.state = { ...this.state, phase: "recovering", error: null };
      this.freshness = await this.storage.readCheck?.().catch(() => null);
      await this.storage.cleanupAbandoned();
      const pointer = await this.storage.activePointer().catch(() => null);
      if (pointer) {
        try { return await this.openGeneration(pointer.generationId, false); }
        catch (_) { await this.storage.clearActivePointer().catch(() => {}); }
      }
      for (const generation of await this.storage.completeGenerations()) {
        try {
          const opened = await this.reader.open(generation.generationId);
          await this.storage.activateGeneration(generation.generationId);
          this.state = { phase: "ready", active: opened, error: null, recovered: true };
          return this.status();
        } catch (_) {}
      }
      this.state = { phase: "empty", active: null, error: null, recovered: Boolean(pointer) };
      return this.status();
    }
    async check({ intervalMs = 15 * 60_000 } = {}) {
      await this.startup();
      const attempted = Date.parse(this.freshness?.attemptedUtc || "");
      if (this.state.active && Number.isFinite(attempted) && Date.parse(this.now()) - attempted < intervalMs)
        return { result: "debounced", ...this.status() };
      return this.install();
    }
    async install({ force = false } = {}) {
      if (this.operation) return this.operation;
      if (!this.state.active) await this.startup();
      if (this.operation) return this.operation;
      this.operation = this.installOnce(force).finally(() => { this.operation = null; });
      return this.operation;
    }
    async installOnce(force) {
      const previousId = this.state.active?.generationId || null;
      try {
        this.state = { ...this.state, phase: "checking", error: null };
        this.freshness = { ...this.freshness, attemptedUtc: this.now(), error: null };
        await this.storage.writeCheck?.(this.freshness);
        const pointer = await this.downloader.fetchPointer();
        this.freshness = { ...this.freshness, checkedUtc: this.now(),
          publishedWatermark: pointer.watermark, publishedGenerationId: contract.generationId(pointer.manifestSha256) };
        await this.storage.writeCheck?.(this.freshness);
        if (!force && this.state.active?.generationId === contract.generationId(pointer.manifestSha256)) {
          this.state = { ...this.state, phase: "ready" };
          return { result: "unchanged", ...this.status() };
        }
        this.state = { ...this.state, phase: "downloading", candidateWatermark: pointer.watermark };
        const { manifest, raw } = await this.downloader.download(pointer);
        const generationId = contract.generationId(pointer.manifestSha256);
        let active;
        if (await this.storage.hasGeneration(generationId)) {
          active = await this.reader.open(generationId);
        } else {
          this.state = { ...this.state, phase: "staging" };
          await this.storage.writeGeneration({ manifestSha256: pointer.manifestSha256,
            watermark: manifest.watermark, bytes: manifest.bytes, sha256: manifest.sha256,
            documentCount: manifest.documentCount, termCount: manifest.termCount,
            source: { generationTag: pointer.generationTag, manifestUrl: pointer.manifestUrl } }, raw.stream());
          this.state = { ...this.state, phase: "validating" };
          active = await this.reader.open(generationId);
        }
        await this.storage.activateGeneration(generationId);
        this.state = { phase: "ready", active, error: null, recovered: false,
          installedUtc: this.now() };
        this.storage.cleanupAbandoned({ keepGenerationIds: [generationId, previousId].filter(Boolean) })
          .catch(() => {});
        return { result: previousId === generationId ? "unchanged" : "installed", ...this.status() };
      } catch (error) {
        this.freshness = { ...this.freshness, error: String(error.message || error) };
        await this.storage.writeCheck?.(this.freshness).catch(() => {});
        if (previousId) {
          try { await this.openGeneration(previousId, true); }
          catch (_) { this.state.active = null; }
        }
        this.state = { ...this.state, phase: this.state.active ? "ready" : "error",
          error: { message: String(error.message || error), code: error.code || null,
            recoverable: error.recoverable !== false }, previousAvailable: Boolean(this.state.active) };
        throw error;
      }
    }
  }

  return { PersistentIndexManager };
});
