(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsUiRoute = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function routeUrl(state) {
    const params = new URLSearchParams();
    params.set("view", state.view);
    for (const [key, value] of Object.entries(state)) {
      if (key !== "view" && value != null && value !== "" && !(key === "page" && value === 1)) params.set(key, String(value));
    }
    return `/#${params}`;
  }

  function currentViewState(hash, view, overrides = {}) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const state = params.get("view") === view ? Object.fromEntries(params) : { view };
    return { ...state, view, ...overrides };
  }

  function authorPageKey(view) { return view === "replies" ? "repliesPage" : "postsPage"; }

  function authorRouteState(hash, username, view, overrides = {}) {
    return currentViewState(hash, "author", { user: username, tab: view, ...overrides });
  }

  function authorPageFromRoute(params, view) {
    const value = Number(params.get(authorPageKey(view)) || 1);
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  }

  return { authorPageFromRoute, authorPageKey, authorRouteState, currentViewState, routeUrl };
});
