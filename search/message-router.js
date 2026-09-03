(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsMessageRouter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PREFIX = "fewercunts-search:";

  function create(handlers) {
    const routes = new Map(Object.entries(handlers || {}));
    for (const [type, handler] of routes) {
      if (!type.startsWith(PREFIX) || typeof handler !== "function") throw new TypeError(`Invalid search route: ${type}`);
    }
    return function route(message) {
      if (!message || !String(message.type || "").startsWith(PREFIX)) return null;
      const handler = routes.get(message.type);
      if (!handler) return Promise.reject(new Error("Unknown search operation"));
      try { return Promise.resolve(handler(message)); }
      catch (error) { return Promise.reject(error); }
    };
  }

  return { PREFIX, create };
});
