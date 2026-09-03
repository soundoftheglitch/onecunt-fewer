(function () {
  "use strict";
  let items = [
    { threadId: 15249, docKey: "t:15249", title: "Muted fixture", username: "alice",
      mutedUtc: "2026-09-01T00:02:00Z", canonicalUrl: "https://ntforum.net/thread/15249" }
  ];
  const calls = [];
  const values = message => {
    calls.push(message.type); document.documentElement.dataset.mutedMessages = JSON.stringify(calls);
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: 2, totalThreads: 2 };
      case "fewercunts-search:stats": return { documents: 2, threads: 2, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T00:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:block-list": return { usernames: ["Soulisdead"], source: "custom" };
      case "fewercunts-search:unread-summary": return { total: 0, unreadDocKeys: [], threads: [] };
      case "fewercunts-search:saved-ids": return [];
      case "fewercunts-search:muted-ids": return items.map(item => item.threadId);
      case "fewercunts-search:muted": return { total: items.length,
        items: items.slice(message.offset || 0, (message.offset || 0) + (message.limit || 25)) };
      case "fewercunts-search:query": return { total: 1, items: [{ ...items[0], kind: "t",
        createdUtc: "2026-08-31T12:00:00Z", snippet: "Muted fixture body", score: 10, replyCount: 0 }] };
      case "fewercunts-search:mute-remove": items = items.filter(item => item.threadId !== Number(message.threadId));
        return { muted: false, threadId: Number(message.threadId), ids: items.map(item => item.threadId) };
      case "fewercunts-search:muted-clear": items = []; return { ids: [], total: 0 };
      case "fewercunts-search:mute-toggle": {
        const id = Number(message.thread.threadId); const existing = items.some(item => item.threadId === id);
        items = existing ? items.filter(item => item.threadId !== id) : [{ ...message.thread,
          docKey: `t:${id}`, mutedUtc: "2026-09-01T00:03:00Z" }, ...items];
        return { muted: !existing, threadId: id, ids: items.map(item => item.threadId) };
      }
      case "fewercunts-search:navigation-target": return { targetPostId: null,
        thread: { Id: 15249, Title: "Muted fixture", Message: "Fixture", PostedByUsername: "alice",
          PostedByEmailAddress: "", CreatedDateTimeUtc: "2026-08-31T12:00:00Z",
          LastPostDateTimeUtc: "2026-08-31T12:00:00Z", PostCount: 1 } };
      default: return {};
    }
  };
  chrome.runtime.sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: values(message) }));
})();
