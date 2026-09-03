(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsSearchResponse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normaliseSearchResponse(response) {
    if (Array.isArray(response)) return { items: response, total: response.length };
    if (!response || !Array.isArray(response.items)) {
      throw new Error("Search worker returned invalid results. Reload the extension and try again.");
    }
    const total = Number(response.total);
    return {
      items: response.items,
      total: Number.isSafeInteger(total) && total >= response.items.length ? total : response.items.length,
      ...(response.truncated === true ? { truncated: true } : {})
    };
  }

  return { normaliseSearchResponse };
});
