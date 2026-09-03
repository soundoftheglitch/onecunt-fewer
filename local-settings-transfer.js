(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsSettingsTransfer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA = "fewercunts-local-settings";
  const VERSION = 3;
  const MAX_BYTES = 64 * 1024;
  const PAGINATION_MODES = new Set(["incremental", "pages"]);
  const ROWS = new Set([5, 10, 15, 20, 25, 50]);

  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
    return value;
  }

  function integer(value, minimum, maximum, label) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${label}`);
    return value;
  }

  function validateBlocked(usernames) {
    if (!Array.isArray(usernames) || usernames.length > 64) throw new Error("Invalid blocked-user list");
    const result = []; const seen = new Set();
    for (const raw of usernames) {
      if (typeof raw !== "string") throw new Error("Invalid blocked username");
      const value = raw.normalize("NFKC").trim();
      if (!value || Array.from(value).length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid blocked username");
      const key = value.toLocaleLowerCase();
      if (!seen.has(key)) { seen.add(key); result.push(value); }
    }
    return result;
  }

  function validateSettings(raw) {
    const settings = object(raw, "settings");
    const pagination = object(settings.pagination, "pagination settings");
    const rows = pagination.rows === "auto" ? "auto" : integer(pagination.rows, 5, 50, "Rows preference");
    if (rows !== "auto" && !ROWS.has(rows)) throw new Error("Invalid Rows preference");
    if (!PAGINATION_MODES.has(pagination.mode)) throw new Error("Unsupported pagination mode");
    const search = object(settings.search, "search settings");
    if (typeof search.autoUpdate !== "boolean") throw new Error("Invalid automatic-update setting");
    return {
      blockedUsernames: validateBlocked(settings.blockedUsernames),
      pagination: { rows, mode: "pages" },
      search: {
        autoUpdate: search.autoUpdate,
        refreshMinutes: integer(search.refreshMinutes, 15, 1440, "refresh interval"),
        fullReconcileDays: integer(search.fullReconcileDays, 1, 30, "full reconciliation interval"),
        replyReconcileDays: integer(search.replyReconcileDays, 7, 90, "reply reconciliation interval")
      }
    };
  }

  function validateMetadata(raw) {
    if (raw == null) return null;
    const metadata = object(raw, "index metadata");
    const text = (value, label, maximum = 160) => {
      if (value == null) return null;
      if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid ${label}`);
      return value;
    };
    return {
      phase: text(metadata.phase, "index phase", 32), source: text(metadata.source, "index source", 32),
      generationId: text(metadata.generationId, "generation identifier"),
      documents: integer(metadata.documents, 0, Number.MAX_SAFE_INTEGER, "document count"),
      threads: integer(metadata.threads, 0, Number.MAX_SAFE_INTEGER, "thread count"),
      lastUpdatedUtc: text(metadata.lastUpdatedUtc, "update timestamp", 40)
    };
  }

  function create(settings, index, now = new Date()) {
    return { schema: SCHEMA, version: VERSION, exportedUtc: now.toISOString(),
      settings: validateSettings(settings), index: validateMetadata(index) };
  }

  function parse(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Settings file is empty or exceeds 64 KiB");
    let raw; try { raw = JSON.parse(text); } catch (_) { throw new Error("Settings file is not valid JSON"); }
    object(raw, "settings file");
    if (raw.schema !== SCHEMA) throw new Error("Unsupported settings schema");
    if (raw.version !== VERSION) throw new Error(`Unsupported settings version: ${String(raw.version)}`);
    return { schema: SCHEMA, version: VERSION, exportedUtc: typeof raw.exportedUtc === "string" ? raw.exportedUtc : null,
      settings: validateSettings(raw.settings), index: validateMetadata(raw.index) };
  }

  function summary(value) {
    const settings = value.settings;
    return `Blocked users: ${settings.blockedUsernames.length}; Rows: ${settings.pagination.rows}; pagination: ${settings.pagination.mode}; automatic index updates: ${settings.search.autoUpdate ? "on" : "off"} (${settings.search.refreshMinutes} minutes). Index metadata is informational and will not replace local index data.`;
  }

  return { MAX_BYTES, SCHEMA, VERSION, create, parse, summary, validateMetadata, validateSettings };
});
