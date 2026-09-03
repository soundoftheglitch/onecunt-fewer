(function () {
  "use strict";

  const TOTALS = { posts: 302, replies: 277 };
  const requests = [];
  function item(kind, index, username) {
    const id = (kind === "posts" ? 10000 : 20000) + index;
    return {
      docKey: `${kind === "posts" ? "t" : "r"}:${id}`, threadId: id, kind: kind === "posts" ? "t" : "r",
      title: `${kind === "posts" ? "Post" : "Reply"} ${index + 1} by ${username}`,
      snippet: `Author ${kind} fixture item ${index + 1}.`, username,
      createdUtc: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      lastPostUtc: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      canonicalUrl: `https://ntforum.net/${kind === "posts" ? "thread" : "reply"}/${id}`,
      replyCount: kind === "posts" ? index % 20 : 0
    };
  }

  function value(message) {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: 1, totalThreads: 1 };
      case "fewercunts-search:stats": return { documents: 1, threads: 1, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T00:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:unread-summary": return { total: 0, threads: [], unreadDocKeys: [] };
      case "fewercunts-search:saved-ids": return [];
      case "fewercunts-search:maintain": return { phase: "complete" };
      case "fewercunts-search:threads-by-user":
      case "fewercunts-search:replies-by-user": {
        const kind = message.type.includes("threads") ? "posts" : "replies";
        const offset = Number(message.offset) || 0;
        const limit = Number(message.limit) || 25;
        requests.push({ kind, username: message.username, offset, limit });
        document.documentElement.dataset.authorPaginationRequests = JSON.stringify(requests);
        return { items: Array.from({ length: Math.max(0, Math.min(limit, TOTALS[kind] - offset)) },
          (_, row) => item(kind, offset + row, message.username)), total: TOTALS[kind] };
      }
      default: return {};
    }
  }

  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: value(message) }));
})();
