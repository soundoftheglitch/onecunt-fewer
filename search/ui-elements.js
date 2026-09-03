(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsUiElements = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function element(tag, className, text, documentRef = document) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function linkedText(tag, className, text, documentRef = document, links = globalThis.FewerCuntsSafeLinks) {
    const node = element(tag, className, null, documentRef);
    for (const part of links.parts(text)) {
      if (!part.href) node.appendChild(documentRef.createTextNode(part.text));
      else {
        const link = element("a", "link-text fewercunts-snippet-link", part.text, documentRef);
        link.href = part.href; link.target = "_blank"; link.rel = "noopener noreferrer";
        node.appendChild(link);
      }
    }
    return node;
  }

  function bytes(value) {
    if (!Number.isFinite(value)) return "storage unavailable";
    const units = ["B", "KiB", "MiB", "GiB"];
    let amount = value; let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  function statusPanel(state, text, status, documentRef = document) {
    const panel = element("div", `fewercunts-search-status fewercunts-search-status-${state}`, text, documentRef);
    panel.dataset.state = state;
    panel.setAttribute("role", state === "error" ? "alert" : "status");
    panel.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
    if (state === "loading" || state === "progress") {
      const completed = Number(status && status.completed) || 0;
      const processed = completed + (Number(status && status.skipped) || 0);
      const total = Number(status && (status.totalThreads || status.catalogued || status.discovered)) || 0;
      const progress = element("progress", "fewercunts-search-progress", null, documentRef);
      if (total > 0) {
        progress.max = total; progress.value = Math.min(processed, total);
        progress.setAttribute("aria-label", `${processed} of ${total} forum threads checked`);
      } else {
        progress.removeAttribute("value"); progress.setAttribute("aria-label", "Forum indexing progress");
      }
      panel.appendChild(progress);
    }
    return panel;
  }

  return { bytes, element, linkedText, statusPanel };
});
