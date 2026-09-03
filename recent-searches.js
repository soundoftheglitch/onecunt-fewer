(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsRecentSearches = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "fewercunts.recent-searches.v1";
  const MAX_ENTRIES = 10;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const ALLOWED_SCOPES = new Set(["user", "post", "replies"]);

  function scopesOf(scopes) {
    return [...new Set((Array.isArray(scopes) ? scopes : []).map(value => String(value).toLowerCase())
      .filter(value => ALLOWED_SCOPES.has(value)))].sort();
  }

  function queryOf(query) { return String(query || "").trim().slice(0, 512); }
  function identity(query, scopes) { return `${query.toLocaleLowerCase()}\u0000${scopes.join(",")}`; }

  function valid(value, now) {
    if (!value || typeof value !== "object") return null;
    const query = queryOf(value.query); const scopes = scopesOf(value.scopes);
    const savedAt = Number(value.savedAt);
    if (!query || !scopes.length || !Number.isFinite(savedAt) || savedAt < 0 || savedAt > now
        || now - savedAt > MAX_AGE_MS) return null;
    return { id: identity(query, scopes), query, scopes, savedAt };
  }

  function list(storage, now = Date.now()) {
    let values = [];
    try { values = JSON.parse(storage.getItem(STORAGE_KEY) || "[]"); } catch (_error) {}
    if (!Array.isArray(values)) return [];
    const unique = new Map();
    for (const raw of values) {
      const value = valid(raw, now);
      if (value && !unique.has(value.id)) unique.set(value.id, value);
    }
    return [...unique.values()].sort((left, right) => right.savedAt - left.savedAt).slice(0, MAX_ENTRIES);
  }

  function add(storage, query, scopes, now = Date.now()) {
    const value = valid({ query, scopes, savedAt: now }, now);
    if (!value) return list(storage, now);
    const values = [value, ...list(storage, now).filter(item => item.id !== value.id)].slice(0, MAX_ENTRIES);
    try { storage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_error) { return list(storage, now); }
    return values;
  }

  function remove(storage, id, now = Date.now()) {
    const values = list(storage, now).filter(item => item.id !== String(id));
    try { storage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_error) {}
    return values;
  }

  function clear(storage) {
    try { storage.removeItem(STORAGE_KEY); return true; } catch (_error) { return false; }
  }

  return { STORAGE_KEY, MAX_ENTRIES, MAX_AGE_MS, scopesOf, list, add, remove, clear };
});
