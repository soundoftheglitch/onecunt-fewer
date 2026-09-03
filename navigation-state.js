(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsNavigationState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "fewercunts.navigation-state.v1";
  const MAX_ENTRIES = 20;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function safeEntries(storage, now = Date.now()) {
    let values = [];
    try { values = JSON.parse(storage.getItem(STORAGE_KEY) || "[]"); } catch (_error) {}
    return Array.isArray(values) ? values.filter(value => value && typeof value.key === "string"
      && typeof value.url === "string" && now - Number(value.savedAt) <= MAX_AGE_MS).slice(0, MAX_ENTRIES) : [];
  }

  function save(storage, snapshot, now = Date.now()) {
    const key = `nav:${now}:${Math.random().toString(36).slice(2, 10)}`;
    const value = { key, url: String(snapshot.url || "/").slice(0, 2048),
      scrollY: Math.max(0, Math.round(Number(snapshot.scrollY) || 0)),
      resultKey: String(snapshot.resultKey || "").slice(0, 128),
      resultIndex: Math.max(0, Math.min(999, Math.round(Number(snapshot.resultIndex) || 0))), savedAt: now };
    const entries = [value, ...safeEntries(storage, now).filter(entry => entry.key !== key)].slice(0, MAX_ENTRIES);
    try { storage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (_error) { return null; }
    return value;
  }

  function get(storage, key, now = Date.now()) {
    return safeEntries(storage, now).find(value => value.key === key) || null;
  }

  function clear(storage) {
    try { storage.removeItem(STORAGE_KEY); return true; } catch (_error) { return false; }
  }

  function capture(options) {
    const { storage, history, location, scrollY, resultKey, resultIndex } = options;
    const snapshot = save(storage, { url: `${location.pathname}${location.search}${location.hash}`,
      scrollY, resultKey, resultIndex });
    if (!snapshot) return null;
    history.replaceState({ ...(history.state || {}), fewercuntsRestoreKey: snapshot.key }, "", snapshot.url);
    return snapshot;
  }

  function restore(options) {
    const snapshot = get(options.storage, options.key);
    if (!snapshot) return false;
    if (snapshot.resultKey && !options.document.querySelector(`[data-fewercunts-doc-key="${CSS.escape(snapshot.resultKey)}"]`)) return false;
    options.window.scrollTo(0, snapshot.scrollY);
    return true;
  }

  return { STORAGE_KEY, MAX_ENTRIES, MAX_AGE_MS, safeEntries, save, get, clear, capture, restore };
});
