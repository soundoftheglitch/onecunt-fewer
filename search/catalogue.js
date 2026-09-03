(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsCatalogue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalise(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-GB");
  }

  function mergeRoots(baseDocuments = [], deltaDocuments = [], tombstonedThreadIds = []) {
    const removed = new Set((tombstonedThreadIds || []).map(Number));
    const roots = new Map();
    for (const document of baseDocuments || []) {
      const threadId = Number(document?.threadId);
      if (document?.kind === "t" && Number.isSafeInteger(threadId) && threadId > 0 && !removed.has(threadId)) {
        roots.set(threadId, { ...document, threadId,
          canonicalUrl: document.canonicalUrl || `https://ntforum.net/thread/${threadId}` });
      }
    }
    for (const document of deltaDocuments || []) {
      const threadId = Number(document?.threadId);
      if (document?.kind === "t" && Number.isSafeInteger(threadId) && threadId > 0 && !removed.has(threadId)) {
        roots.set(threadId, { ...document, threadId,
          canonicalUrl: document.canonicalUrl || `https://ntforum.net/thread/${threadId}` });
      }
    }
    return [...roots.values()];
  }

  function visibleRoots(documents, blockedUsernames = [], mutedThreadIds = [], revealHidden = false) {
    if (revealHidden) return [...(documents || [])];
    const blocked = new Set((blockedUsernames || []).map(normalise));
    const muted = new Set((mutedThreadIds || []).map(Number));
    return (documents || []).filter(document => !blocked.has(normalise(document?.username))
      && !muted.has(Number(document?.threadId)));
  }

  function project(baseDocuments, deltaDocuments, tombstonedThreadIds, visibility = {}) {
    const roots = mergeRoots(baseDocuments, deltaDocuments, tombstonedThreadIds);
    return { roots, visible: visibleRoots(roots, visibility.blockedUsernames, visibility.mutedThreadIds,
      visibility.revealHidden) };
  }

  return { mergeRoots, normalise, project, visibleRoots };
});
