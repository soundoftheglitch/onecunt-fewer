(function () {
  "use strict";

  const TOTAL = 277;
  const requests = [];
  function result(index, kind = "t") {
    const reply = kind === "r";
    return {
      docKey: `${kind}:${reply ? 100000 + index : 5000 + index}`, threadId: 5000 + index,
      postId: reply ? 100000 + index : null, kind, title: `Needle result ${index + 1}`,
      threadTitle: `Thread ${index + 1}`,
      username: index % 2 ? "alice" : "bob", createdUtc: "2026-09-01T00:00:00Z",
      canonicalUrl: `https://ntforum.net/thread/${5000 + index}${reply ? `/reply/${100000 + index}` : ""}`,
      snippet: `Search pagination fixture item ${index + 1}: https://example.test/${index + 1} and <a href="/thread/${5000 + index}">forum link</a>.`, replyCount: 1
    };
  }

  function value(message) {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: TOTAL, totalThreads: TOTAL };
      case "fewercunts-search:stats": return { documents: TOTAL, threads: TOTAL, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T00:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:update": return { debounced: true, refreshed: 0 };
      case "fewercunts-search:navigation-target": {
        const [kind, rawId] = String(message.docKey || "").split(":"); const id = Number(rawId);
        const index = kind === "r" ? id - 100000 : id - 5000;
        return { threadId: 5000 + index, targetPostId: kind === "r" ? id : 5000 + index };
      }
      case "fewercunts-search:unread-summary": return { total: 0, threads: [], unreadDocKeys: [] };
      case "fewercunts-search:saved-ids": return [];
      case "fewercunts-search:maintain": return { phase: "complete" };
      case "fewercunts-search:query": {
        const offset = Number(message.offset) || 0;
        const limit = Number(message.limit) || 25;
        const kind = message.resultKind === "r" ? "r" : "t";
        requests.push({ query: message.query, offset, limit, scopes: message.scopes, resultKind: kind });
        document.documentElement.dataset.searchPaginationRequests = JSON.stringify(requests);
        return { items: Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) },
          (_, item) => result(offset + item, kind)), total: TOTAL };
      }
      default: return {};
    }
  }

  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: value(message) }));
})();
