(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsUnansweredState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function username(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .trim().toLocaleLowerCase();
  }

  function postId(document) {
    const value = Number(document?.postId ?? String(document?.docKey || "").slice(2));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  function parentId(document) { return Number(document?.parentPostId) || Number(document?.threadId) || null; }

  function publicBranch(document, type, answered) {
    return { docKey: String(document.docKey), threadId: Number(document.threadId), postId: postId(document),
      parentPostId: Number(document.parentPostId), type, answered, username: String(document.username || ""),
      title: String(document.threadTitle || document.title || "Reply").slice(0, 300),
      snippet: String(document.body || "").replace(/\s+/g, " ").trim().slice(0, 240),
      createdUtc: String(document.createdUtc || ""), canonicalUrl: String(document.canonicalUrl || "") };
  }

  function classifyThread(documents, ownUsername, blockedUsernames = []) {
    const own = username(ownUsername); if (!own) return [];
    const blocked = new Set((blockedUsernames || []).map(username).filter(Boolean));
    const input = Array.isArray(documents) ? documents.filter(Boolean) : [];
    const byId = new Map();
    for (const document of input) {
      const id = postId(document); const threadId = Number(document.threadId);
      if (!id || !Number.isSafeInteger(threadId) || threadId < 1 || byId.has(id)) continue;
      byId.set(id, document);
    }
    const visible = new Map();
    function isVisible(document, visiting = new Set()) {
      const id = postId(document); if (!id || visiting.has(id) || blocked.has(username(document.username))) return false;
      if (visible.has(id)) return visible.get(id);
      if (document.kind === "t") { visible.set(id, true); return true; }
      const parent = byId.get(parentId(document));
      if (!parent || Number(parent.threadId) !== Number(document.threadId)) { visible.set(id, false); return false; }
      visiting.add(id); const value = isVisible(parent, visiting); visiting.delete(id); visible.set(id, value); return value;
    }
    const children = new Map();
    for (const document of byId.values()) if (isVisible(document) && document.kind === "r") {
      const parent = parentId(document);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(document);
    }
    function answeredBelow(document) {
      const incomingTime = Date.parse(String(document.createdUtc || "")); const stack = [...(children.get(postId(document)) || [])];
      while (stack.length) {
        const child = stack.pop(); const childTime = Date.parse(String(child.createdUtc || ""));
        if (username(child.username) === own && Number.isFinite(incomingTime)
            && Number.isFinite(childTime) && childTime > incomingTime) return true;
        stack.push(...(children.get(postId(child)) || []));
      }
      return false;
    }
    return [...byId.values()].filter(document => document.kind === "r" && isVisible(document)
      && username(document.username) !== own && username(byId.get(parentId(document))?.username) === own)
      .map(document => publicBranch(document,
        byId.get(parentId(document)).kind === "t" ? "posts" : "replies", answeredBelow(document)))
      .sort((left, right) => right.createdUtc.localeCompare(left.createdUtc) || right.postId - left.postId);
  }

  class ConversationBranches {
    constructor({ ownUsername = "", blockedUsernames = [] } = {}) {
      this.ownUsername = ownUsername; this.blockedUsernames = [...blockedUsernames];
      this.threads = new Map(); this.classified = new Map(); this.metrics = { recomputedThreads: 0, scannedDocuments: 0 };
    }
    reclassify(threadId) {
      const documents = this.threads.get(Number(threadId)) || [];
      this.classified.set(Number(threadId), classifyThread(documents, this.ownUsername, this.blockedUsernames));
      this.metrics = { recomputedThreads: 1, scannedDocuments: documents.length };
    }
    replaceThread(threadId, documents) {
      const id = Number(threadId); if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("Invalid thread ID");
      this.threads.set(id, Array.isArray(documents) ? [...documents] : []); this.reclassify(id); return this.snapshot();
    }
    replaceThreads(entries) {
      let scannedDocuments = 0; let recomputedThreads = 0;
      for (const [threadId, documents] of entries || []) {
        const id = Number(threadId); if (!Number.isSafeInteger(id) || id < 1) continue;
        const values = Array.isArray(documents) ? [...documents] : [];
        this.threads.set(id, values); this.reclassify(id); scannedDocuments += values.length; recomputedThreads += 1;
      }
      this.metrics = { recomputedThreads, scannedDocuments }; return this.snapshot();
    }
    deleteThread(threadId) {
      this.threads.delete(Number(threadId)); this.classified.delete(Number(threadId));
      this.metrics = { recomputedThreads: 0, scannedDocuments: 0 }; return this.snapshot();
    }
    setIdentity(value) {
      this.ownUsername = value; let scannedDocuments = 0;
      for (const [id, documents] of this.threads) { this.reclassify(id); scannedDocuments += documents.length; }
      this.metrics = { recomputedThreads: this.threads.size, scannedDocuments }; return this.snapshot();
    }
    setBlocked(usernames) {
      this.blockedUsernames = [...(usernames || [])]; let scannedDocuments = 0;
      for (const [id, documents] of this.threads) { this.reclassify(id); scannedDocuments += documents.length; }
      this.metrics = { recomputedThreads: this.threads.size, scannedDocuments }; return this.snapshot();
    }
    snapshot() {
      const items = [...this.classified.values()].flat().sort((left, right) =>
        right.createdUtc.localeCompare(left.createdUtc) || right.postId - left.postId);
      return { posts: items.filter(item => item.type === "posts"),
        replies: items.filter(item => item.type === "replies"), metrics: { ...this.metrics } };
    }
  }

  function publicCandidate(document, parent) {
    return { docKey: String(document.docKey), threadId: Number(document.threadId), postId: postId(document),
      parentPostId: Number(document.parentPostId) || null, recipient: username(parent.username),
      type: parent.kind === "t" ? "posts" : "replies", username: String(document.username || ""),
      normalisedUsername: username(document.username), title: String(document.threadTitle || document.title || "Reply").slice(0, 300),
      snippet: String(document.body || "").replace(/\s+/g, " ").trim().slice(0, 240),
      createdUtc: String(document.createdUtc || ""), canonicalUrl: String(document.canonicalUrl || ""), answerPaths: [] };
  }

  class ConversationBuilder {
    constructor() { this.nodes = new Map(); this.candidates = new Map(); this.threads = new Map(); }
    add(document) {
      const id = postId(document); if (!id || this.nodes.has(id)) return;
      const node = { id, parentId: document.kind === "r" ? parentId(document) : null, kind: document.kind,
        username: String(document.username || ""), normalisedUsername: username(document.username),
        createdUtc: String(document.createdUtc || "") };
      if (node.kind === "r") {
        const parent = this.nodes.get(node.parentId); if (!parent || Number(document.threadId) < 1) return;
        const path = []; let ancestor = parent;
        while (ancestor) {
          path.push(ancestor.normalisedUsername); const candidate = this.candidates.get(ancestor.id);
          if (candidate && candidate.recipient === node.normalisedUsername
              && node.createdUtc > candidate.createdUtc) candidate.answerPaths.push([...path]);
          ancestor = ancestor.parentId ? this.nodes.get(ancestor.parentId) : null;
        }
        if (node.normalisedUsername && parent.normalisedUsername
            && node.normalisedUsername !== parent.normalisedUsername) {
          const candidate = publicCandidate(document, parent); this.candidates.set(id, candidate);
          if (!this.threads.has(candidate.threadId)) this.threads.set(candidate.threadId, []);
          this.threads.get(candidate.threadId).push(candidate);
        }
      }
      this.nodes.set(id, node);
    }
    finish() { this.nodes.clear(); this.candidates.clear(); return this.threads; }
  }

  function summariseThread(documents) {
    const builder = new ConversationBuilder();
    for (const document of [...(documents || [])].sort((left, right) => postId(left) - postId(right))) builder.add(document);
    return builder.finish().values().next().value || [];
  }

  class ConversationCatalogue {
    constructor(entries = []) { this.threads = new Map(entries); }
    replaceThread(threadId, documents) {
      const id = Number(threadId); const candidates = summariseThread(documents);
      if (candidates.length) this.threads.set(id, candidates); else this.threads.delete(id); return this;
    }
    replaceThreadCandidates(threadId, candidates) {
      const id = Number(threadId); const values = (candidates || []).map(value => ({ ...value,
        answerPaths: (value.answerPaths || []).map(path => [...path]) }));
      if (values.length) this.threads.set(id, values); else this.threads.delete(id); return this;
    }
    deleteThread(threadId) { this.threads.delete(Number(threadId)); return this; }
    clone() { const copy = new ConversationCatalogue(); for (const [id, values] of this.threads) copy.replaceThreadCandidates(id, values); return copy; }
    snapshot(ownUsername, blockedUsernames = []) {
      const own = username(ownUsername); if (!own) return { posts: [], replies: [] };
      const blocked = new Set((blockedUsernames || []).map(username).filter(Boolean));
      const items = [...this.threads.values()].flat().filter(item => item.recipient === own
        && !blocked.has(item.normalisedUsername)).map(item => ({ ...item,
          answered: item.answerPaths.some(path => path.every(author => !blocked.has(author))) }))
        .map(({ recipient: _recipient, normalisedUsername: _normalised, answerPaths: _paths, ...item }) => item)
        .sort((left, right) => right.createdUtc.localeCompare(left.createdUtc) || right.postId - left.postId);
      return { posts: items.filter(item => item.type === "posts"), replies: items.filter(item => item.type === "replies") };
    }
  }

  return { ConversationBranches, ConversationBuilder, ConversationCatalogue, classifyThread, summariseThread, username };
});
