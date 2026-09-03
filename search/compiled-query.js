(function (root, factory) {
  const indexer = typeof module === "object" && module.exports ? require("./indexer.js") : root.FewerCuntsIndexer;
  const api = factory(indexer);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsCompiledQuery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (indexer) {
  "use strict";

  const MAX_PREFIX_TERMS = 128;
  const MAX_CANDIDATES = 20000;
  const MAX_DOCUMENT_LOADS = 1000;
  const FIELD_WEIGHT = { user: 5, title: 4, body: 1 };

  function sourceIdentity(document) {
    const url = String(document?.canonicalUrl || "");
    const thread = url.match(/\/thread\/(\d+)/);
    const reply = url.match(/\/reply\/(\d+)/);
    const threadId = thread ? Number(thread[1]) : (document?.kind === "thread"
      ? Math.floor(Number(document.id) / 2) : Math.floor(Number(document.threadId) / 2));
    const postId = document?.kind === "reply" ? (reply ? Number(reply[1]) : Math.floor((Number(document.id) - 1) / 2)) : null;
    return { threadId, postId };
  }

  function legacyDocument(document) {
    if (!document) return null;
    const source = sourceIdentity(document);
    return { ...document, docKey: `${document.kind === "thread" ? "t" : "r"}:${source.postId || source.threadId}`,
      threadId: source.threadId, postId: source.postId || source.threadId, parentPostId: null,
      kind: document.kind === "thread" ? "t" : "r" };
  }

  class BoundedCandidates {
    constructor(limit = MAX_CANDIDATES) { this.limit = limit; this.values = new Map(); this.heap = []; this.truncated = false; }
    weaker(left, right) { return left.score < right.score || (left.score === right.score && left.id < right.id); }
    push(node) {
      this.heap.push(node); let index = this.heap.length - 1;
      while (index) { const parent = Math.floor((index - 1) / 2); if (!this.weaker(node, this.heap[parent])) break;
        this.heap[index] = this.heap[parent]; index = parent; }
      this.heap[index] = node;
    }
    pop() {
      const first = this.heap[0]; const last = this.heap.pop();
      if (this.heap.length) { let index = 0; this.heap[0] = last;
        while (true) { const left = index * 2 + 1; const right = left + 1; let next = index;
          if (left < this.heap.length && this.weaker(this.heap[left], this.heap[next])) next = left;
          if (right < this.heap.length && this.weaker(this.heap[right], this.heap[next])) next = right;
          if (next === index) break; [this.heap[index], this.heap[next]] = [this.heap[next], this.heap[index]]; index = next; }
      }
      return first;
    }
    weakest() {
      while (this.heap.length) {
        const node = this.heap[0]; const current = this.values.get(node.id);
        if (current && current.score === node.score) return node;
        this.pop();
      }
      return null;
    }
    add(id, value) {
      const old = this.values.get(id);
      if (old) { old.score += value.score; old.positions.push(...value.positions); this.push({ id, score: old.score }); return; }
      if (this.values.size < this.limit) { this.values.set(id, value); this.push({ id, score: value.score }); return; }
      const weakest = this.weakest();
      this.truncated = true;
      if (weakest && (value.score > weakest.score || (value.score === weakest.score && id > weakest.id))) {
        this.pop(); this.values.delete(weakest.id); this.values.set(id, value); this.push({ id, score: value.score });
      }
    }
  }

  function phraseMatches(groups) {
    if (groups.length < 2) return true;
    const later = groups.slice(1).map(values => new Set(values));
    return groups[0].some(start => later.every((values, index) => values.has(start + index + 1)));
  }

  class CompiledQueryEngine {
    constructor({ reader, candidateLimit = MAX_CANDIDATES, documentLoadLimit = MAX_DOCUMENT_LOADS } = {}) {
      if (!reader) throw new Error("Compiled query reader is required");
      this.reader = reader; this.candidateLimit = candidateLimit; this.documentLoadLimit = documentLoadLimit;
      this.navigationCache = new Map();
    }

    tokenTerms(field, token, prefix) {
      if (prefix) {
        if (Array.from(token).length < 2) throw new Error("Prefix search needs at least two characters");
        return this.reader.terms(field, token, MAX_PREFIX_TERMS);
      }
      const entry = this.reader.termInfo(field, token);
      return entry ? [entry] : [];
    }

    async fieldClause(field, clause, documentCount) {
      const groups = clause.tokens.map(token => this.tokenTerms(field, token, clause.prefix));
      if (groups.some(group => !group.length)) return { values: new Map(), truncated: false };
      const ordered = groups.map((entries, tokenIndex) => ({ entries, tokenIndex,
        frequency: entries.reduce((sum, entry) => sum + entry.documentFrequency, 0) }))
        .sort((left, right) => left.frequency - right.frequency);
      const pivot = ordered[0]; const candidates = new BoundedCandidates(this.candidateLimit);
      for (const term of pivot.entries) {
        const idf = Math.log(1 + (documentCount - term.documentFrequency + .5) / (term.documentFrequency + .5));
        for await (const posting of this.reader.postingEntries(field, term.term)) {
          candidates.add(posting.documentId, { score: FIELD_WEIGHT[field] * idf
            * ((posting.termFrequency * 2.2) / (posting.termFrequency + 1.2)),
          positions: [{ tokenIndex: pivot.tokenIndex, values: posting.positions }] });
        }
      }
      for (const group of ordered.slice(1)) {
        const hits = new Map();
        for (const term of group.entries) {
          const idf = Math.log(1 + (documentCount - term.documentFrequency + .5) / (term.documentFrequency + .5));
          for await (const posting of this.reader.postingEntries(field, term.term)) {
            if (!candidates.values.has(posting.documentId)) continue;
            const hit = hits.get(posting.documentId) || { score: 0, positions: [] };
            hit.score += FIELD_WEIGHT[field] * idf * ((posting.termFrequency * 2.2) / (posting.termFrequency + 1.2));
            hit.positions.push(...posting.positions); hits.set(posting.documentId, hit);
          }
        }
        for (const [id, candidate] of [...candidates.values]) {
          const hit = hits.get(id);
          if (!hit) candidates.values.delete(id);
          else { candidate.score += hit.score; candidate.positions.push({ tokenIndex: group.tokenIndex, values: hit.positions }); }
        }
      }
      if (clause.phrase) {
        for (const [id, candidate] of [...candidates.values]) {
          const positions = candidate.positions.sort((a, b) => a.tokenIndex - b.tokenIndex).map(item => item.values);
          if (!phraseMatches(positions)) candidates.values.delete(id); else candidate.score += 6;
        }
      }
      return { values: candidates.values, truncated: candidates.truncated };
    }

    async search(query, limit = 25, scopes = ["user", "post", "replies"], offset = 0, blockedUsernames = [], mutedThreadIds = [], revealHidden = false, suppressed = {}) {
      const clauses = indexer.parseQuery(query);
      if (!clauses.length) return { items: [], total: 0, truncated: false };
      const opened = this.reader.requireOpen(); const documentCount = opened.generation.documentCount;
      const requested = new Set(scopes); const clauseResults = []; let truncated = false;
      for (const clause of clauses) {
        if (clause.field === "email") return { items: [], total: 0, truncated: false };
        const fields = (clause.field ? [clause.field] : ["user", "title", "body"]).filter(field =>
          field === "user" ? requested.has("user") : requested.has("post") || requested.has("replies"));
        const combined = new Map();
        for (const field of fields) {
          const result = await this.fieldClause(field, clause, documentCount); truncated ||= result.truncated;
          for (const [id, candidate] of result.values) {
            const current = combined.get(id);
            if (!current || candidate.score > current.score) combined.set(id, candidate);
          }
        }
        clauseResults.push(combined);
      }
      clauseResults.sort((left, right) => left.size - right.size);
      const matches = new Map();
      for (const [id, first] of clauseResults[0]) {
        let score = first.score; let valid = true;
        for (const clause of clauseResults.slice(1)) {
          const hit = clause.get(id); if (!hit) { valid = false; break; } score += hit.score;
        }
        if (valid) matches.set(id, score);
      }
      const ranked = [...matches].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      if (ranked.length > this.documentLoadLimit) truncated = true;
      const shortlist = ranked.slice(0, this.documentLoadLimit);
      const results = [];
      const blocked = new Set(blockedUsernames.map(value => indexer.normalise(value).trim()).filter(Boolean));
      const muted = new Set(mutedThreadIds.map(Number));
      const suppressedKeys = new Set((suppressed.docKeys || []).map(String));
      const suppressedThreads = new Set((suppressed.threadIds || []).map(Number));
      const exactUsername = suppressed.exactUsername ? indexer.normalise(suppressed.exactUsername).trim() : "";
      const resultKind = suppressed.resultKind === "t" || suppressed.resultKind === "r" ? suppressed.resultKind : "";
      const visibility = new Map();
      const visible = async document => {
        if (!document) return false;
        if (visibility.has(document.id)) return visibility.get(document.id);
        const source = sourceIdentity(document);
        if (!revealHidden && (blocked.has(indexer.normalise(document.username).trim()) || muted.has(Number(source.threadId)))) {
          visibility.set(document.id, false); return false;
        }
        const parent = document.parentId ? await this.reader.document(document.parentId) : null;
        const value = !document.parentId || await visible(parent);
        visibility.set(document.id, value); return value;
      };
      this.navigationCache.clear();
      for (const [id, score] of shortlist) {
        const document = await this.reader.document(id); if (!document || !await visible(document)) continue;
        if (exactUsername && indexer.normalise(document.username).trim() !== exactUsername) continue;
        if (resultKind && (document.kind === "thread" ? "t" : "r") !== resultKind) continue;
        if (document.kind === "thread" ? !requested.has("post") : !requested.has("replies")) {
          if (!requested.has("user") || !clauses.some(clause => clause.field === "user" || !clause.field)) continue;
        }
        const source = sourceIdentity(document);
        const docKey = `${document.kind === "thread" ? "t" : "r"}:${source.postId || source.threadId}`;
        if (suppressedKeys.has(docKey) || suppressedThreads.has(Number(source.threadId))) continue;
        const rootDocument = document.kind === "thread" ? document : await this.reader.document(document.threadId);
        if (rootDocument) this.navigationCache.set(docKey, indexer.makeNavigationPayload(legacyDocument(rootDocument), legacyDocument(document), []));
        results.push({ docKey,
          threadId: source.threadId, postId: source.postId,
          title: document.title, username: document.username, createdUtc: document.createdUtc,
          lastPostUtc: rootDocument?.lastPostUtc || rootDocument?.createdUtc || document.createdUtc,
          replyCount: Math.max(0, Number(rootDocument?.replyCount) || 0),
          kind: document.kind === "thread" ? "t" : "r", threadTitle: rootDocument?.title || document.title,
          canonicalUrl: new URL(document.canonicalUrl, "https://ntforum.net").href,
          snippet: indexer.makeSnippet(document, clauses), score, archived: indexer.isArchivedRoot(rootDocument) });
      }
      results.sort((a, b) => b.score - a.score || b.createdUtc.localeCompare(a.createdUtc) || b.postId - a.postId);
      const start = Math.max(0, Number(offset) || 0);
      const size = Math.max(1, Math.min(Number(limit) || 25, this.documentLoadLimit));
      return { items: results.slice(start, start + size), total: results.length, truncated };
    }

    async navigationTarget(docKey) {
      const key = String(docKey || "");
      const cached = this.navigationCache.get(key);
      if (cached) return structuredClone(cached);
      const match = key.match(/^([tr]):(\d+)$/);
      if (!match) throw new Error("Compiled search navigation target is invalid");
      const id = Number(match[2]);
      const encodedId = match[1] === "t" ? id * 2 : id * 2 + 1;
      const document = await this.reader.document(encodedId) || await this.reader.document(id);
      if (!document || (match[1] === "t") !== (document.kind === "thread")) {
        throw new Error("Compiled search navigation target is unavailable");
      }
      const rootDocument = document.kind === "thread" ? document : await this.reader.document(document.threadId);
      const payload = indexer.makeNavigationPayload(legacyDocument(rootDocument), legacyDocument(document), []);
      this.navigationCache.set(key, payload);
      return structuredClone(payload);
    }
  }

  return { BoundedCandidates, CompiledQueryEngine, MAX_CANDIDATES, MAX_DOCUMENT_LOADS,
    MAX_PREFIX_TERMS, phraseMatches };
});
