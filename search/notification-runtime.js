(function (root, factory) {
  const api = factory(); if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsNotificationRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function id(docKey) { return `fewercunts-reply-${String(docKey || "")}`; }
  async function deliver({ docKeys, repository, permissions, notifications, iconUrl }) {
    if (!Array.isArray(docKeys) || !docKeys.length || !permissions || !notifications) return { delivered: 0, denied: false };
    const config = await repository.settings(); if (!config.enabled || !config.browser) return { delivered: 0, denied: false };
    const permitted = await permissions.contains({ permissions: ["notifications"] });
    if (!permitted) return { delivered: 0, denied: true };
    let delivered = 0;
    for (const docKey of [...new Set(docKeys.map(String))]) {
      const item = await repository.get(docKey); if (!item || item.dismissed) continue;
      await notifications.create(id(docKey), { type: "basic", iconUrl,
        title: `Reply from ${item.username || "NTForum"}`, message: item.snippet || item.title,
        contextMessage: item.title, priority: 0 }); delivered += 1;
    }
    return { delivered, denied: false };
  }
  return { deliver, id };
});
