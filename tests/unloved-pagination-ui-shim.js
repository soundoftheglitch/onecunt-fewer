(function () {
  "use strict";

  const TOTAL = 277;
  const requests = [];
  function thread(index) {
    return {
      docKey: `t:${5000 + index}`, threadId: 5000 + index, kind: "t",
      title: `Unloved thread ${index + 1}`, username: index % 2 ? "alice" : "bob",
      createdUtc: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      canonicalUrl: `https://ntforum.net/thread/${5000 + index}`, replyCount: 0
    };
  }

  function value(message) {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: TOTAL, totalThreads: TOTAL };
      case "fewercunts-search:stats": return { documents: TOTAL, threads: TOTAL, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T00:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:unread-summary": return { total: 0, threads: [], unreadDocKeys: [] };
      case "fewercunts-search:saved-ids": return [];
      case "fewercunts-search:maintain": return { phase: "complete" };
      case "fewercunts-search:unloved": {
        const offset = Number(message.offset) || 0;
        const limit = Number(message.limit) || 25;
        requests.push({ offset, limit });
        document.documentElement.dataset.unlovedPaginationRequests = JSON.stringify(requests);
        return { items: Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, item) => thread(offset + item)), total: TOTAL };
      }
      default: return {};
    }
  }

  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: value(message) }));
})();
