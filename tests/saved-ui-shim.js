(function () {
  "use strict";
  let items = [
    { threadId: 15249, docKey: "t:15249", title: "Newest saved", username: "alice",
      createdUtc: "2026-08-31T12:00:00Z", savedUtc: "2026-09-01T00:02:00Z",
      canonicalUrl: "https://ntforum.net/thread/15249", missing: false, unreadCount: 2 },
    { threadId: 999999, docKey: "t:999999", title: "Missing saved", username: "bob",
      createdUtc: "2026-08-30T12:00:00Z", savedUtc: "2026-09-01T00:01:00Z",
      canonicalUrl: "https://ntforum.net/thread/999999", missing: true, unreadCount: 0 }
  ];
  const values = message => {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: 2, totalThreads: 2 };
      case "fewercunts-search:stats": return { documents: 2, threads: 2, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T00:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:unread-summary": return { total: 2, unreadDocKeys: ["r:2", "r:3"],
        threads: [{ threadId: 15249, unreadCount: 2, totalCount: 3 }] };
      case "fewercunts-search:saved-ids": return items.map(item => item.threadId);
      case "fewercunts-search:saved": return { total: items.length,
        items: items.slice(message.offset || 0, (message.offset || 0) + (message.limit || 25)) };
      case "fewercunts-search:save-remove": items = items.filter(item => item.threadId !== Number(message.threadId));
        return { saved: false, threadId: Number(message.threadId), ids: items.map(item => item.threadId) };
      case "fewercunts-search:saved-clear": items = []; return { ids: [], total: 0 };
      case "fewercunts-search:save-toggle": return { saved: true, threadId: message.thread.threadId,
        ids: [...new Set([...items.map(item => item.threadId), message.thread.threadId])] };
      case "fewercunts-search:navigation-target": return { targetPostId: 15249,
        thread: { Id: 15249, Title: "Newest saved", Message: "Saved fixture", PostedByUsername: "alice",
          PostedByEmailAddress: "", CreatedDateTimeUtc: "2026-08-31T12:00:00Z",
          LastPostDateTimeUtc: "2026-08-31T12:00:00Z", PostCount: 3 } };
      default: return {};
    }
  };
  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: values(message) }));
})();
