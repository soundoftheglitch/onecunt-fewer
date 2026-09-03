(function () {
  "use strict";
  const EMPTY_KEY = "fewercunts-unread-reset-empty";
  const RESET_KEY = "fewercunts-unread-reset-done";
  const summary = () => {
    if (localStorage.getItem(EMPTY_KEY) === "true") return { total: 0, unreadDocKeys: [], threads: [] };
    const reset = localStorage.getItem(RESET_KEY) === "true";
    return { total: reset ? 3 : 1, unreadDocKeys: reset ? ["t:101", "r:102", "t:202"] : ["r:102"],
      threads: [{ threadId: 101, totalCount: 2, unreadCount: reset ? 2 : 1 },
        { threadId: 202, totalCount: 1, unreadCount: reset ? 1 : 0 }] };
  };
  const values = message => {
    switch (message.type) {
      case "fewercunts-search:unread-summary": return summary();
      case "fewercunts-search:mark-all-unread":
        if (message.confirmed !== true) throw new Error("confirmation missing");
        localStorage.setItem(RESET_KEY, "true");
        document.documentElement.dataset.unreadResetCalls = String(
          Number(document.documentElement.dataset.unreadResetCalls || 0) + 1);
        return { marked: 3, ...summary() };
      case "fewercunts-search:block-list": return { usernames: ["Soulisdead"], source: "defaults" };
      case "fewercunts-search:saved-ids":
      case "fewercunts-search:muted-ids": return [];
      case "fewercunts-search:settings": return { enabled: false, refreshMinutes: 15,
        fullReconcileDays: 7, replyReconcileDays: 30 };
      default: return {};
    }
  };
  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => {
    try { callback({ ok: true, value: values(message) }); }
    catch (error) { callback({ ok: false, error: error.message }); }
  });
})();
