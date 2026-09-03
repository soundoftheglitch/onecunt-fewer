(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsDomLifecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function collect(root, selector, mutations = []) {
    const found = new Set();
    const add = node => {
      if (!node || node.nodeType !== 1) return;
      if (node.matches?.(selector)) found.add(node);
      const owner = node.closest?.(selector); if (owner && root.contains(owner)) found.add(owner);
      for (const match of node.querySelectorAll?.(selector) || []) found.add(match);
    };
    if (!mutations.length) for (const match of root.querySelectorAll(selector)) found.add(match);
    for (const mutation of mutations) {
      add(mutation.target);
      for (const node of mutation.addedNodes || []) add(node);
    }
    return [...found];
  }

  function observe(root, { selector, decorate, attributeFilter = [] }) {
    if (!root || !selector || typeof decorate !== "function") throw new TypeError("DOM lifecycle dependencies are required");
    const apply = mutations => { for (const node of collect(root, selector, mutations)) decorate(node); };
    const options = { childList: true, subtree: true };
    if (attributeFilter.length) { options.attributes = true; options.attributeFilter = [...attributeFilter]; }
    const observer = new MutationObserver(apply);
    observer.observe(root, options); apply([]);
    return { disconnect: () => observer.disconnect(), refresh: () => apply([]) };
  }

  return { collect, observe };
});
