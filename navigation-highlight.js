(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsNavigationHighlight = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);

  function termsFromQuery(query) {
    const terms = [];
    const seen = new Set();
    const pattern = /(?:(user|title|body|email):)?(?:"([^"]+)"|(\S+))/giu;
    let match;
    while ((match = pattern.exec(String(query || "").slice(0, 512)))) {
      if (String(match[1] || "").toLowerCase() === "email") continue;
      const prefix = !match[2] && String(match[3] || "").endsWith("*");
      const value = String(match[2] || match[3] || "").replace(/\*$/, "").trim();
      const values = match[2] ? [value] : value.split(/\s+/u);
      for (const term of values) {
        const key = term.toLocaleLowerCase();
        if (key.length < 2 || seen.has(key)) continue;
        seen.add(key);
        terms.push({ value: term, prefix });
      }
    }
    return terms.slice(0, 16);
  }

  function visible(element) {
    if (!element || typeof element.getClientRects !== "function") return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function highlight(rootElement, terms, duration = 4000) {
    if (!rootElement || !Array.isArray(terms) || !terms.length) return [];
    const document = rootElement.ownerDocument;
    const escaped = terms.map(term => String(term.value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
    if (!escaped.length) return [];
    const expression = new RegExp(`(${escaped.sort((a, b) => b.length - a.length).join("|")})`, "giu");
    const walker = document.createTreeWalker(rootElement, document.defaultView.NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP.has(parent.tagName) || parent.closest("mark.fewercunts-match")) return document.defaultView.NodeFilter.FILTER_REJECT;
        return node.data.trim() && visible(parent) ? document.defaultView.NodeFilter.FILTER_ACCEPT : document.defaultView.NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode() && nodes.length < 200) nodes.push(walker.currentNode);
    const marks = [];
    for (const node of nodes) {
      expression.lastIndex = 0;
      if (!expression.test(node.data)) continue;
      expression.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of node.data.matchAll(expression)) {
        fragment.append(document.createTextNode(node.data.slice(offset, match.index)));
        const mark = document.createElement("mark");
        mark.className = "fewercunts-match";
        mark.textContent = match[0];
        fragment.append(mark); marks.push(mark);
        offset = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.data.slice(offset)));
      node.replaceWith(fragment);
    }
    if (marks.length) rootElement.classList.add("fewercunts-match-target");
    const clear = () => {
      for (const mark of marks) if (mark.isConnected) mark.replaceWith(document.createTextNode(mark.textContent));
      rootElement.normalize();
      rootElement.classList.remove("fewercunts-match-target");
    };
    if (duration >= 0) document.defaultView.setTimeout(clear, duration);
    marks.clear = clear;
    return marks;
  }

  return { termsFromQuery, highlight };
});
