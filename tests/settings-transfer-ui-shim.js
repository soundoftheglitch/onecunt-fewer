(function () {
  "use strict";
  const SETTINGS_KEY = "fewercunts-transfer-fixture-settings";
  const BLOCK_KEY = "fewercunts-transfer-fixture-blocks";
  const defaults = { enabled: true, refreshMinutes: 15, fullReconcileDays: 7, replyReconcileDays: 30 };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
  const write = (key, value) => { localStorage.setItem(key, JSON.stringify(value)); publish(); return value; };
  const publish = () => { document.documentElement.dataset.transferFixture = JSON.stringify({
    settings: read(SETTINGS_KEY, defaults), blocked: read(BLOCK_KEY, ["Soulisdead"])
  }); };
  publish();
  const values = message => {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", privateBody: "must not export" };
      case "fewercunts-search:stats": return { documents: 363276, threads: 15243, source: "compiled",
        generationId: "search-compact-v1", email: "never@example.test" };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T08:00:00.000Z" };
      case "fewercunts-search:settings": {
        if (message.settings) return write(SETTINGS_KEY, { ...read(SETTINGS_KEY, defaults), ...message.settings });
        return { ...read(SETTINGS_KEY, defaults), query: "must not export" };
      }
      case "fewercunts-search:block-list": return { usernames: read(BLOCK_KEY, ["Soulisdead"]), source: "custom" };
      case "fewercunts-search:block-list-set": {
        if ((message.usernames || []).includes("FAIL")) throw new Error("simulated block-list write failure");
        const usernames = write(BLOCK_KEY, message.usernames || []); return { usernames, source: "custom" };
      }
      case "fewercunts-search:unread-summary": return { total: 0, unreadDocKeys: [], threads: [] };
      case "fewercunts-search:saved-ids":
      case "fewercunts-search:muted-ids": return [];
      default: return {};
    }
  };
  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => {
    try { callback({ ok: true, value: values(message) }); }
    catch (error) { callback({ ok: false, error: error.message }); }
  });
})();
