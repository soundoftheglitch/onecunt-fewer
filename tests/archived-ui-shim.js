(function () {
  "use strict";

  const archivedThread = {
    docKey: "t:15249", threadId: 15249, postId: 15249, kind: "t",
    title: "Archived fixture", threadTitle: "Archived fixture", username: "fixture-user",
    createdUtc: "2026-08-31T12:00:00Z", lastPostUtc: "2026-08-31T12:00:00Z",
    canonicalUrl: "https://ntforum.net/thread/15249", snippet: "Exactly 999 replies.",
    replyCount: 999, archived: true
  };
  const archivedReply = {
    ...archivedThread, docKey: "r:999001", postId: 999001, kind: "r",
    title: "Re: Archived fixture", canonicalUrl: "https://ntforum.net/thread/15249/reply/999001",
    snippet: "An indexed reply in an archived thread."
  };
  const adjacent = {
    ...archivedThread, docKey: "t:15248", threadId: 15248, postId: 15248,
    title: "Adjacent fixture", threadTitle: "Adjacent fixture",
    canonicalUrl: "https://ntforum.net/thread/15248", replyCount: 998, archived: false
  };

  const values = message => {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: 2, totalThreads: 2 };
      case "fewercunts-search:stats": return { documents: 3, threads: 2, usage: 4096 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-08-31T12:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:update": return { debounced: true, refreshed: 0 };
      case "fewercunts-search:query": return { items: [archivedReply, adjacent], total: 2 };
      case "fewercunts-search:threads-by-user": return { items: [archivedThread], total: 1 };
      case "fewercunts-search:replies-by-user": return { items: [archivedReply], total: 1 };
      case "fewercunts-search:navigation-target": return {
        targetPostId: 15249,
        thread: { Id: 15249, Title: "Archived fixture", Message: "Exactly 999 replies.",
          PostedByUsername: "fixture-user", PostedByEmailAddress: "",
          CreatedDateTimeUtc: "2026-08-31T12:00:00Z", LastPostDateTimeUtc: "2026-08-31T12:00:00Z",
          PostCount: 1000 }
      };
      default: return {};
    }
  };

  chrome.runtime.sendMessage = (message, callback) => {
    queueMicrotask(() => callback({ ok: true, value: values(message) }));
  };
})();
