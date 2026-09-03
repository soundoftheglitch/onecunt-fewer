(function () {
  "use strict";
  const key = "fewercunts-notification-ui-fixture";
  const initial = { enabled: false, username: "", browser: false, permissionRequests: 0, updates: [], items: [
    { docKey: "r:42", threadId: 7, postId: 42, parentPostId: 6, username: "alice", title: "Fixture thread",
      snippet: "Exact reply forty-two", createdUtc: "2026-09-01T02:00:00Z", canonicalUrl: "https://ntforum.net/thread/7/reply/42", read: false, dismissed: false },
    { docKey: "r:41", threadId: 7, postId: 41, parentPostId: 7, username: "bob", title: "Fixture thread",
      snippet: "Exact reply forty-one", createdUtc: "2026-09-01T01:00:00Z", canonicalUrl: "https://ntforum.net/thread/7/reply/41", read: false, dismissed: false }
  ] };
  let state; try { state = JSON.parse(localStorage.getItem(key)) || initial; } catch (_) { state = initial; }
  const save = () => { localStorage.setItem(key, JSON.stringify(state));
    document.documentElement.dataset.notificationUiState = JSON.stringify(state); };
  save();
  const requestPermission = (_permissions, callback) => {
    state.permissionRequests += 1; save(); queueMicrotask(() => callback(false)); return undefined;
  };
  function response(message) {
    switch (message.type) {
      case "fewercunts-search:status": return { phase: "complete", completed: 2, totalThreads: 1 };
      case "fewercunts-search:stats": return { documents: 3, threads: 1, usage: 1000 };
      case "fewercunts-search:update-status": return { lastSuccessUtc: "2026-09-01T02:00:00Z" };
      case "fewercunts-search:settings": return { enabled: true, refreshMinutes: 15 };
      case "fewercunts-search:unread-summary": return { total: 0, threads: [], unreadDocKeys: [] };
      case "fewercunts-search:saved-ids": return [];
      case "fewercunts-search:maintain": return { phase: "complete" };
      case "fewercunts-search:notification-settings":
        if (message.settings) state = { ...state, ...message.settings }; save();
        return { enabled: state.enabled, username: state.username, browser: state.browser };
      case "fewercunts-search:notifications": {
        const items = state.items.filter(item => !item.dismissed);
        return { items, unread: items.filter(item => !item.read).length,
          settings: { enabled: state.enabled, username: state.username, browser: state.browser } };
      }
      case "fewercunts-search:notification-update": {
        state.items = state.items.map(item => item.docKey === message.docKey ? { ...item, ...message.changes } : item);
        state.updates.push({ docKey: message.docKey, changes: message.changes }); save();
        const items = state.items.filter(item => !item.dismissed);
        return { items, unread: items.filter(item => !item.read).length,
          settings: { enabled: state.enabled, username: state.username, browser: state.browser } };
      }
      default: return {};
    }
  }
  const sendMessage = (message, callback) => queueMicrotask(() => callback({ ok: true, value: response(message) }));
  globalThis.browser = { runtime: { lastError: null, sendMessage }, permissions: { request: requestPermission } };
  const publishIdentity = () => document.dispatchEvent(new CustomEvent("fewercunts:forum-identity", {
    detail: JSON.stringify({ username: "dog hat" })
  }));
  document.addEventListener("fewercunts:forum-identity-request", publishIdentity);
  setTimeout(publishIdentity, 500);
})();
