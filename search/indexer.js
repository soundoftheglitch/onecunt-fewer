/* Resumable, opt-in NTForum ingestion. No user data outside the whitelist crosses this boundary. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsIndexer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-search-v2";
  const DB_VERSION = 7;
  const SYNC_KEY = "initial-import";
  const UPDATE_KEY = "incremental-update";
  const SETTINGS_KEY = "search-settings";
  const DEFAULT_REFRESH_MINUTES = 15;
  const DEFAULT_FULL_RECONCILE_DAYS = 7;
  const DEFAULT_REPLY_RECONCILE_DAYS = 30;
  const CANDIDATE_BATCH_SIZE = 250;
  const BOOTSTRAP_BATCH_SIZE = 50;
  const BOOTSTRAP_TERM_BATCH_SIZE = 500;
  const BOOTSTRAP_SCHEMA_VERSION = 3;
  const BLOCKED_USERNAMES = new Set(["soulisdead", "monkeybutler"]);

  function normalise(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function tokenise(value) {
    const text = normalise(value);
    return text.match(/[\p{L}\p{N}]+/gu) || [];
  }

  function termPrefix(term) {
    return Array.from(String(term || "")).slice(0, 3).join("");
  }

  function postingsForDocument(document) {
    const fields = {
      user: tokenise(document.username),
      title: tokenise(document.title),
      body: tokenise(document.body)
    };
    const postings = [];
    for (const [field, tokens] of Object.entries(fields)) {
      const positions = new Map();
      tokens.forEach((term, position) => {
        if (!positions.has(term)) positions.set(term, []);
        positions.get(term).push(position);
      });
      for (const [term, offsets] of positions) postings.push({
        term, field, docKey: document.docKey, positions: offsets, frequency: offsets.length
      });
    }
    const email = normalise(document.email).trim();
    if (email) postings.push({ term: email, field: "email", docKey: document.docKey, positions: [0], frequency: 1 });
    return postings;
  }

  function isBlocked(username) {
    return BLOCKED_USERNAMES.has(normalise(username).trim());
  }

  function blockedMatcher(usernames = BLOCKED_USERNAMES) {
    const values = usernames instanceof Set ? usernames : new Set((usernames || []).map(value => normalise(value).trim()));
    return username => values.has(normalise(username).trim());
  }

  function isArchivedRoot(root) {
    return Boolean(root && Number.isInteger(root.replyCount) && root.replyCount === 999);
  }

  function requiredInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}`);
    return number;
  }

  function requiredText(value, label) {
    if (typeof value !== "string") throw new Error(`Invalid ${label}`);
    return value;
  }

  function optionalText(value) {
    return typeof value === "string" ? value : "";
  }

  function sanitisePost(raw, threadId, parentPostId, kind) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid post record");
    const postId = requiredInteger(raw.Id, "post ID");
    const safeThreadId = requiredInteger(threadId, "thread ID");
    const username = requiredText(raw.PostedByUsername, "username");
    const email = optionalText(raw.PostedByEmailAddress).trim();
    const title = optionalText(raw.Title);
    const body = requiredText(raw.Message, "message");
    const createdUtc = requiredText(raw.CreatedDateTimeUtc, "creation timestamp");
    return {
      docKey: `${kind}:${postId}`,
      postId,
      threadId: safeThreadId,
      parentPostId: parentPostId == null ? null : requiredInteger(parentPostId, "parent post ID"),
      kind,
      username,
      normalisedUsername: normalise(username).trim(),
      email,
      title,
      body,
      createdUtc,
      canonicalUrl: `https://ntforum.net/thread/${safeThreadId}/reply/${postId}`,
      fetchedUtc: new Date().toISOString()
    };
  }

  function flattenReplies(replies, threadId, parentPostId = null, output = [], hiddenByAncestor = false,
    blockedUsernames = BLOCKED_USERNAMES) {
    const blocked = blockedMatcher(blockedUsernames);
    if (!Array.isArray(replies)) throw new Error("Invalid replies response");
    for (const raw of replies) {
      const document = sanitisePost(raw, threadId, parentPostId, "r");
      const hidden = hiddenByAncestor || blocked(document.username);
      if (!hidden) output.push(document);
      flattenReplies(Array.isArray(raw.Replies) ? raw.Replies : [], threadId, document.postId, output, hidden, blockedUsernames);
    }
    return output;
  }

  function sanitiseThread(raw) {
    const threadId = requiredInteger(raw && raw.Id, "thread ID");
    const root = sanitisePost(raw, threadId, null, "t");
    root.canonicalUrl = `https://ntforum.net/thread/${threadId}`;
    const advertisedPostCount = requiredInteger(raw.PostCount, "post count");
    const lastPostUtc = requiredText(raw.LastPostDateTimeUtc, "last-post timestamp");
    root.replyCount = Math.max(0, advertisedPostCount - 1);
    root.lastPostUtc = lastPostUtc;
    return {
      threadId,
      root,
      lastPostUtc,
      advertisedPostCount
    };
  }

  function threadSignature(thread) {
    return JSON.stringify([thread.root.username, thread.root.title, thread.root.body, thread.root.createdUtc]);
  }

  function sanitiseBootstrapThread(raw) {
    if (!raw || raw.type !== "thread" || !Array.isArray(raw.replies)) throw new Error("Invalid bootstrap thread");
    const threadId = requiredInteger(raw.threadId, "bootstrap thread ID");
    const makeDocument = (item, kind) => ({
      docKey: `${kind}:${requiredInteger(kind === "t" ? threadId : item.postId, "bootstrap post ID")}`,
      postId: requiredInteger(kind === "t" ? threadId : item.postId, "bootstrap post ID"), threadId,
      parentPostId: kind === "t" || item.parentPostId == null ? null : requiredInteger(item.parentPostId, "bootstrap parent ID"),
      kind, username: requiredText(item.username, "bootstrap username"),
      normalisedUsername: normalise(item.username).trim(), email: "",
      title: optionalText(item.title), body: requiredText(item.body, "bootstrap message"),
      createdUtc: requiredText(item.createdUtc, "bootstrap timestamp"),
      canonicalUrl: requiredText(item.canonicalUrl, "bootstrap URL"), fetchedUtc: new Date().toISOString()
    });
    const root = makeDocument(raw, "t");
    root.lastPostUtc = requiredText(raw.lastPostUtc, "bootstrap last-post timestamp");
    root.replyCount = Math.max(0, requiredInteger(raw.advertisedPostCount, "bootstrap post count") - 1);
    const replies = raw.replies.map(item => makeDocument(item, "r"));
    if (isBlocked(root.username) || replies.some(reply => isBlocked(reply.username))) throw new Error("Blocked bootstrap record");
    return { threadId, root, replies, lastPostUtc: root.lastPostUtc, advertisedPostCount: root.replyCount + 1 };
  }

  function sanitiseBootstrapTerm(raw) {
    if (!raw || raw.type !== "termShard" || !["user", "title", "body"].includes(raw.field)
        || typeof raw.prefix !== "string" || !raw.prefix || !Array.isArray(raw.postings) || !raw.postings.length) {
      throw new Error("Invalid bootstrap term shard");
    }
    let previous = "";
    const postings = raw.postings.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[0]
          || termPrefix(entry[0]) !== raw.prefix || entry[0] <= previous || !Array.isArray(entry[1])) {
        throw new Error("Invalid bootstrap term posting");
      }
      previous = entry[0];
      const seen = new Set();
      const docKeys = entry[1].map(value => {
        const docKey = String(value || "");
        if (!/^[tr]:\d+$/.test(docKey) || seen.has(docKey)) throw new Error("Invalid bootstrap posting key");
        seen.add(docKey);
        return docKey;
      });
      if (!docKeys.length) throw new Error("Empty bootstrap posting list");
      return [entry[0], docKeys];
    });
    return { field: raw.field, prefix: raw.prefix, postings };
  }

  function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = event => {
        const db = request.result;
        let documents;
        if (!db.objectStoreNames.contains("documents")) {
          documents = db.createObjectStore("documents", { keyPath: "docKey" });
          documents.createIndex("threadId", "threadId", { unique: false });
          documents.createIndex("createdUtc", "createdUtc", { unique: false });
          documents.createIndex("kindUsername", ["kind", "normalisedUsername"], { unique: false });
        } else {
          documents = request.transaction.objectStore("documents");
          if (!documents.indexNames.contains("kindUsername")) {
            documents.createIndex("kindUsername", ["kind", "normalisedUsername"], { unique: false });
          }
        }
        let terms;
        if (event.oldVersion > 0 && event.oldVersion < 7 && db.objectStoreNames.contains("terms")) db.deleteObjectStore("terms");
        if (!db.objectStoreNames.contains("terms")) terms = db.createObjectStore("terms", { keyPath: ["field", "prefix"] });
        else terms = request.transaction.objectStore("terms");
        if (!db.objectStoreNames.contains("threads")) {
          const threads = db.createObjectStore("threads", { keyPath: "threadId" });
          threads.createIndex("lastPostUtc", "lastPostUtc", { unique: false });
          threads.createIndex("advertisedPostCount", "advertisedPostCount", { unique: false });
        } else {
          const threads = request.transaction.objectStore("threads");
          if (!threads.indexNames.contains("advertisedPostCount")) threads.createIndex("advertisedPostCount", "advertisedPostCount", { unique: false });
        }
        if (!db.objectStoreNames.contains("sync")) db.createObjectStore("sync", { keyPath: "name" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "name" });
        if (event.oldVersion > 0 && event.oldVersion < 4) {
          documents.openCursor().onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, normalisedUsername: normalise(cursor.value.username).trim() });
            cursor.continue();
          };
        }
        if (event.oldVersion > 0 && event.oldVersion < 7) {
          request.transaction.objectStore("sync").put({
            name: SYNC_KEY, phase: "bootstrap", page: 1, pending: [], discovered: 0,
            catalogued: 0, totalThreads: 0, skipped: 0, completed: 0, failed: 0,
            cancelled: false, schemaVersion: DB_VERSION
          });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  }

  function parseQuery(query) {
    const source = String(query || "").trim();
    if (!source || source.length > 512) return [];
    const clauses = [];
    const pattern = /(?:(user|title|body|email):)?(?:"([^"]+)"|(\S+))/giu;
    let match;
    while ((match = pattern.exec(source))) {
      const rawValue = normalise(match[2] || match[3]).trim();
      const prefix = !match[2] && rawValue.endsWith("*");
      const value = prefix ? rawValue.slice(0, -1) : rawValue;
      const tokens = tokenise(value);
      if (tokens.length) clauses.push({
        field: match[1] ? match[1].toLowerCase() : null,
        value,
        tokens,
        phrase: Boolean(match[2]),
        prefix
      });
    }
    return clauses;
  }

  function containsPhrase(haystack, needle) {
    if (!needle.length || needle.length > haystack.length) return false;
    return haystack.some((_, start) => needle.every((token, offset) => haystack[start + offset] === token));
  }

  function clauseMatches(tokens, clause) {
    if (clause.phrase) return containsPhrase(tokens, clause.tokens);
    return clause.tokens.every(needle => clause.prefix
      ? tokens.some(token => token.startsWith(needle))
      : tokens.includes(needle));
  }

  function scoreDocument(document, clauses, requestedScopes) {
    const scopes = new Set(Array.isArray(requestedScopes)
      ? requestedScopes.filter(scope => ["user", "post", "replies"].includes(scope))
      : ["user", "post", "replies"]);
    const rawFields = {
      user: normalise(document.username),
      title: normalise(document.title),
      body: normalise(document.body),
      email: normalise(document.email)
    };
    const fields = Object.fromEntries(Object.entries(rawFields).map(([field, text]) => [field, tokenise(text)]));
    let score = 0;
    for (const clause of clauses) {
      const permitted = field => {
        if (field === "user" || field === "email") return scopes.has("user");
        if (document.kind === "t") return scopes.has("post") && (field === "title" || field === "body");
        return scopes.has("replies") && (field === "title" || field === "body");
      };
      const candidates = (clause.field ? [clause.field] : ["user", "title", "body"])
        .filter(permitted).map(field => [field, fields[field]]);
      const hits = candidates.filter(([field, tokens]) => field === "email"
        ? (clause.prefix ? rawFields.email.startsWith(clause.value) : rawFields.email === clause.value)
        : clauseMatches(tokens, clause));
      if (!hits.length) return 0;
      for (const [field] of hits) {
        const weight = field === "user" ? 5 : field === "title" ? 4 : 1;
        score += weight + (clause.phrase ? 6 : 0) + (field === "user" && rawFields.user === clause.value ? 8 : 0);
      }
    }
    return score;
  }

  function makeSnippet(document, clauses) {
    const body = String(document.body || "").replace(/\s+/g, " ").trim();
    const needle = clauses[0] && clauses[0].value;
    const at = needle ? normalise(body).indexOf(needle) : -1;
    const start = Math.max(0, at < 0 ? 0 : at - 80);
    return `${start ? "…" : ""}${body.slice(start, start + 240)}${body.length > start + 240 ? "…" : ""}`;
  }

  function permittedFields(documentKind, clause, requestedScopes) {
    const scopes = new Set(Array.isArray(requestedScopes)
      ? requestedScopes.filter(scope => ["user", "post", "replies"].includes(scope))
      : ["user", "post", "replies"]);
    const allowed = field => {
      if (field === "user" || field === "email") return scopes.has("user");
      if (documentKind === "t") return scopes.has("post") && (field === "title" || field === "body");
      return scopes.has("replies") && (field === "title" || field === "body");
    };
    return (clause.field ? [clause.field] : ["user", "title", "body"]).filter(allowed);
  }

  function intersectSets(sets) {
    if (!sets.length) return new Set();
    const ordered = sets.slice().sort((a, b) => a.size - b.size);
    return new Set([...ordered[0]].filter(value => ordered.slice(1).every(set => set.has(value))));
  }

  function selectUnlovedThreads(documents, offset = 0, limit = 25, blockedUsernames = BLOCKED_USERNAMES, mutedThreadIds = [], revealHidden = false) {
    const blocked = blockedMatcher(blockedUsernames);
    const muted = new Set(mutedThreadIds.map(Number));
    const matches = documents.filter(document => document.kind === "t"
      && (revealHidden || (!blocked(document.username) && !muted.has(Number(document.threadId))))
      && Number(document.replyCount) === 0).map(document => ({
      docKey: document.docKey, threadId: document.threadId, title: document.title,
      username: document.username, createdUtc: document.createdUtc, lastPostUtc: document.lastPostUtc || document.createdUtc,
      replyCount: 0, canonicalUrl: `https://ntforum.net/thread/${document.threadId}`
    }));
    matches.sort((a, b) => a.createdUtc.localeCompare(b.createdUtc) || a.threadId - b.threadId);
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.max(1, Math.min(Number(limit) || 25, 100));
    return { items: matches.slice(start, start + size), total: matches.length };
  }

  function selectClassicThreads(baseDocuments, deltaDocuments = [], tombstonedThreadIds = [], sortOrder = "datedesc", offset = 0, limit = 25) {
    const tombstones = new Set((tombstonedThreadIds || []).map(Number)); const roots = new Map();
    for (const document of baseDocuments || []) if (document?.kind === "t" && !tombstones.has(Number(document.threadId))) roots.set(Number(document.threadId), document);
    for (const document of deltaDocuments || []) if (document?.kind === "t" && !tombstones.has(Number(document.threadId))) roots.set(Number(document.threadId), document);
    for (const id of tombstones) roots.delete(id);
    const items = [...roots.values()].map(document => ({ threadId: Number(document.threadId),
      title: document.title || "Untitled thread", username: document.username || "", body: document.body || "",
      createdUtc: document.createdUtc, lastPostUtc: document.lastPostUtc || document.createdUtc,
      replyCount: Math.max(0, Number(document.replyCount) || 0), canonicalUrl: `https://ntforum.net/thread/${Number(document.threadId)}` }));
    const text = value => normalise(value || "").trim();
    const compareText = field => (left, right) => text(left[field]).localeCompare(text(right[field])) || left.threadId - right.threadId;
    const comparators = { date: (left, right) => String(left.lastPostUtc).localeCompare(String(right.lastPostUtc)) || left.threadId - right.threadId,
      datedesc: (left, right) => String(right.lastPostUtc).localeCompare(String(left.lastPostUtc)) || right.threadId - left.threadId,
      postedby: compareText("username"), subject: compareText("title"),
      size: (left, right) => left.replyCount - right.replyCount || left.threadId - right.threadId };
    const order = String(sortOrder || "datedesc").toLowerCase(); const descending = order.endsWith("desc") && order !== "datedesc";
    const comparator = comparators[order] || comparators[descending ? order.slice(0, -4) : order] || comparators.datedesc;
    items.sort(descending ? (left, right) => -comparator(left, right) : comparator);
    if (order === "datedesc") {
      const welcome = items.findIndex(item => item.threadId === 15249);
      if (welcome > 0) items.unshift(items.splice(welcome, 1)[0]);
    }
    const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
    return { items: items.slice(start, start + size), total: items.length };
  }

  function selectUsernames(baseDocuments, deltaDocuments = [], query = "", excludedUsernames = [], limit = 20) {
    const prefix = normalise(query).trim();
    const excluded = new Set((excludedUsernames || []).map(value => normalise(value).trim()).filter(Boolean));
    const names = new Map();
    for (const document of [...(baseDocuments || []), ...(deltaDocuments || [])]) {
      const display = String(document?.username || "").normalize("NFKC").trim();
      const key = normalise(display).trim();
      if (!display || !key || excluded.has(key) || (prefix && !key.startsWith(prefix))) continue;
      if (!names.has(key)) names.set(key, display);
    }
    const maximum = Math.max(1, Math.min(20, Number(limit) || 20));
    return [...names.entries()].sort(([leftKey, left], [rightKey, right]) =>
      leftKey.localeCompare(rightKey) || left.localeCompare(right)).slice(0, maximum).map(([, display]) => display);
  }

  function stableIndex(seed, length) {
    if (!Number.isSafeInteger(length) || length < 1) return 0;
    let hash = 2166136261;
    for (const character of String(seed || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % length;
  }

  function selectBackfillThreads(documents, seed, count, excludeIds = [], blockedUsernames = BLOCKED_USERNAMES, mutedThreadIds = [], revealHidden = false) {
    const blocked = blockedMatcher(blockedUsernames);
    const muted = new Set(mutedThreadIds.map(Number));
    const wanted = Math.max(0, Math.min(Number(count) || 0, 100));
    const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : [])
      .map(Number).filter(Number.isSafeInteger));
    const candidates = documents.filter(document => document && document.kind === "t"
      && Number(document.replyCount) === 0 && Number.isSafeInteger(document.threadId)
      && (revealHidden || (!blocked(document.username) && !muted.has(Number(document.threadId))))
      && !excluded.has(document.threadId));
    candidates.sort((a, b) => a.threadId - b.threadId);
    const selected = [];
    const start = stableIndex(seed, candidates.length);
    for (let step = 0; step < candidates.length && selected.length < wanted; step += 1) {
      const root = candidates[(start + step) % candidates.length];
      if (excluded.has(root.threadId)) continue;
      selected.push(makeNavigationPayload(root, root, blockedUsernames).thread);
      excluded.add(root.threadId);
    }
    return selected;
  }

  function makeNavigationPayload(root, target, blockedUsernames = BLOCKED_USERNAMES) {
    if (!root || root.kind !== "t" || !target || root.threadId !== target.threadId) {
      throw new Error("Invalid navigation target");
    }
    const blocked = blockedUsernames instanceof Set ? blockedUsernames
      : new Set((blockedUsernames || []).map(value => normalise(value).trim()));
    if (blocked.has(normalise(root.username).trim()) || blocked.has(normalise(target.username).trim())) throw new Error("Blocked navigation target");
    return {
      thread: {
        Id: root.threadId,
        Title: root.title,
        Message: root.body,
        PostedByUsername: root.username,
        PostedByEmailAddress: "",
        CreatedDateTimeUtc: root.createdUtc,
        LastPostDateTimeUtc: root.lastPostUtc || root.createdUtc,
        PostCount: (root.replyCount || 0) + 1
      },
      targetPostId: target.kind === "r" ? target.postId : null,
      targetDocKey: target.docKey
    };
  }

  async function updateTermShards(store, changes) {
    const grouped = new Map();
    for (const change of changes) {
      const prefix = termPrefix(change.term);
      const key = JSON.stringify([change.field, prefix]);
      if (!grouped.has(key)) grouped.set(key, { field: change.field, prefix, changes: [] });
      grouped.get(key).changes.push(change);
    }
    const shards = [...grouped.values()];
    const stored = await Promise.all(shards.map(shard => requestResult(store.get([shard.field, shard.prefix]))));
    shards.forEach((shard, index) => {
      const postings = new Map((stored[index] && stored[index].postings) || []);
      for (const change of shard.changes) {
        const docKeys = new Set(postings.get(change.term) || []);
        for (const docKey of change.remove || []) docKeys.delete(docKey);
        for (const docKey of change.add || []) docKeys.add(docKey);
        if (docKeys.size) postings.set(change.term, [...docKeys]);
        else postings.delete(change.term);
      }
      if (postings.size) store.put({ field: shard.field, prefix: shard.prefix,
        postings: [...postings].sort((a, b) => a[0].localeCompare(b[0])) });
      else store.delete([shard.field, shard.prefix]);
    });
  }

  class IndexedDbRepository {
    constructor(indexedDB) { this.indexedDB = indexedDB; this.database = null; this.navigationCache = new Map(); }
    async db() { return this.database || (this.database = await openDatabase(this.indexedDB)); }
    async getSync() {
      const db = await this.db();
      return requestResult(db.transaction("sync", "readonly").objectStore("sync").get(SYNC_KEY));
    }
    async putSync(state) {
      const db = await this.db();
      const tx = db.transaction("sync", "readwrite");
      tx.objectStore("sync").put({ ...state, name: SYNC_KEY });
      await transactionDone(tx);
    }
    async getUpdate() {
      const db = await this.db();
      return requestResult(db.transaction("sync", "readonly").objectStore("sync").get(UPDATE_KEY));
    }
    async putUpdate(state) {
      const db = await this.db();
      const tx = db.transaction("sync", "readwrite");
      tx.objectStore("sync").put({ ...state, name: UPDATE_KEY });
      await transactionDone(tx);
    }
    async getSettings() {
      const db = await this.db();
      const stored = await requestResult(db.transaction("settings", "readonly").objectStore("settings").get(SETTINGS_KEY));
      return { enabled: true, refreshMinutes: DEFAULT_REFRESH_MINUTES, fullReconcileDays: DEFAULT_FULL_RECONCILE_DAYS, replyReconcileDays: DEFAULT_REPLY_RECONCILE_DAYS, ...(stored || {}) };
    }
    async putSettings(settings) {
      const current = await this.getSettings();
      const refreshMinutes = Math.max(15, Math.min(1440, Number(settings.refreshMinutes ?? current.refreshMinutes) || DEFAULT_REFRESH_MINUTES));
      const fullReconcileDays = Math.max(1, Math.min(30, Number(settings.fullReconcileDays ?? current.fullReconcileDays) || DEFAULT_FULL_RECONCILE_DAYS));
      const replyReconcileDays = Math.max(7, Math.min(90, Number(settings.replyReconcileDays ?? current.replyReconcileDays) || DEFAULT_REPLY_RECONCILE_DAYS));
      const value = { ...current, ...settings, name: SETTINGS_KEY, enabled: settings.enabled == null ? current.enabled : Boolean(settings.enabled), refreshMinutes, fullReconcileDays, replyReconcileDays };
      const db = await this.db();
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(value);
      await transactionDone(tx);
      return value;
    }
    async threadMetadata(threadId) {
      const db = await this.db();
      return requestResult(db.transaction("threads", "readonly").objectStore("threads").get(threadId));
    }
    async allThreadIds() {
      const db = await this.db();
      return requestResult(db.transaction("threads", "readonly").objectStore("threads").getAllKeys());
    }
    async latestPostUtc() {
      const db = await this.db();
      const cursor = await requestResult(db.transaction("threads", "readonly")
        .objectStore("threads").index("lastPostUtc").openCursor(null, "prev"));
      return cursor ? cursor.value.lastPostUtc : null;
    }
    async deleteThread(threadId) {
      const db = await this.db();
      const oldDocuments = await requestResult(db.transaction("documents", "readonly")
        .objectStore("documents").index("threadId").getAll(threadId));
      const tx = db.transaction(["documents", "terms", "threads"], "readwrite");
      const documents = tx.objectStore("documents");
      const terms = tx.objectStore("terms");
      const removals = new Map();
      for (const document of oldDocuments) {
        documents.delete(document.docKey);
        for (const posting of postingsForDocument(document)) {
          const key = JSON.stringify([posting.field, posting.term]);
          if (!removals.has(key)) removals.set(key, { field: posting.field, term: posting.term, docKeys: new Set() });
          removals.get(key).docKeys.add(document.docKey);
        }
      }
      const changes = [...removals.values()];
      await updateTermShards(terms, changes.map(change => ({ ...change, remove: change.docKeys, add: [] })));
      tx.objectStore("threads").delete(threadId);
      await transactionDone(tx);
    }
    async clear() {
      if (this.database) {
        this.database.close();
        this.database = null;
      }
      this.navigationCache.clear();
      await new Promise((resolve, reject) => {
        const request = this.indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => {};
      });
      return this.stats();
    }
    async migrationSnapshot(watermark) {
      const db = await this.db();
      const threads = await requestResult(db.transaction("threads", "readonly").objectStore("threads").getAll());
      return threads.filter(item => item.lastPostUtc > watermark).map(item => ({ thread: { threadId: item.threadId } }));
    }
    async migrationThread(threadId) {
      const db = await this.db(); const transaction = db.transaction(["threads", "documents"], "readonly");
      const metadata = await requestResult(transaction.objectStore("threads").get(Number(threadId)));
      const documents = await requestResult(transaction.objectStore("documents").index("threadId").getAll(Number(threadId)));
      const root = documents.find(item => item.kind === "t");
      if (!metadata || !root) return null;
      return { thread: { threadId: Number(threadId), root, lastPostUtc: metadata.lastPostUtc,
        advertisedPostCount: metadata.advertisedPostCount }, replies: documents.filter(item => item.kind === "r") };
    }
    async retireSearchPostings() {
      const db = await this.db(); const transaction = db.transaction("terms", "readwrite");
      transaction.objectStore("terms").clear(); await transactionDone(transaction);
    }
    async stats() {
      const db = await this.db();
      const tx = db.transaction(["documents", "threads"], "readonly");
      const [documents, threads] = await Promise.all([
        requestResult(tx.objectStore("documents").count()),
        requestResult(tx.objectStore("threads").count())
      ]);
      let usage = null;
      let quota = null;
      if (typeof navigator === "object" && navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
        quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
      }
      return { documents, threads, usage, quota };
    }
    async commitThread(thread, replies, state) {
      const documents = [thread.root, ...replies.map(reply => ({ ...reply, threadTitle: thread.root.title }))];
      const db = await this.db();
      const oldDocuments = await requestResult(db.transaction("documents", "readonly")
        .objectStore("documents").index("threadId").getAll(thread.threadId));
      const changes = new Map();
      const changeFor = posting => {
        const key = JSON.stringify([posting.field, posting.term]);
        if (!changes.has(key)) changes.set(key, { field: posting.field, term: posting.term, remove: new Set(), add: new Set() });
        return changes.get(key);
      };
      for (const document of oldDocuments) {
        for (const posting of postingsForDocument(document)) changeFor(posting).remove.add(document.docKey);
      }
      for (const document of documents) {
        for (const posting of postingsForDocument(document)) changeFor(posting).add.add(document.docKey);
      }
      const tx = db.transaction(["documents", "terms", "threads", "sync"], "readwrite");
      const store = tx.objectStore("documents");
      const terms = tx.objectStore("terms");
      for (const document of oldDocuments) store.delete(document.docKey);
      const changeList = [...changes.values()];
      await updateTermShards(terms, changeList);
      for (const document of documents) {
        store.put(document);
      }
      tx.objectStore("threads").put({
        threadId: thread.threadId,
        lastPostUtc: thread.lastPostUtc,
        advertisedPostCount: thread.advertisedPostCount,
        importedPostCount: documents.length,
        rootSignature: threadSignature(thread),
        fetchedUtc: new Date().toISOString()
      });
      tx.objectStore("sync").put({ ...state, name: SYNC_KEY });
      await transactionDone(tx);
    }
    async commitBootstrapRecord(record, state) {
      const thread = sanitiseBootstrapThread(record);
      await this.commitThread(thread, thread.replies, state);
      return 1 + thread.replies.length;
    }
    async resetBootstrap(state) {
      const db = await this.db();
      const tx = db.transaction(["documents", "terms", "threads", "sync"], "readwrite");
      tx.objectStore("documents").clear();
      tx.objectStore("terms").clear();
      tx.objectStore("threads").clear();
      tx.objectStore("sync").put({ ...state, name: SYNC_KEY });
      await transactionDone(tx);
      this.navigationCache.clear();
    }
    async commitBootstrapBatch(records, state) {
      const threads = records.map(sanitiseBootstrapThread);
      const db = await this.db();
      const tx = db.transaction(["documents", "threads", "sync"], "readwrite");
      const documents = tx.objectStore("documents");
      const threadStore = tx.objectStore("threads");
      let documentCount = 0;
      for (const thread of threads) {
        const items = [thread.root, ...thread.replies.map(reply => ({ ...reply, threadTitle: thread.root.title }))];
        documentCount += items.length;
        for (const document of items) {
          documents.put(document);
        }
        threadStore.put({
          threadId: thread.threadId, lastPostUtc: thread.lastPostUtc,
          advertisedPostCount: thread.advertisedPostCount, importedPostCount: items.length,
          rootSignature: threadSignature(thread), fetchedUtc: new Date().toISOString()
        });
      }
      tx.objectStore("sync").put({ ...state, name: SYNC_KEY });
      await transactionDone(tx);
      return documentCount;
    }
    async commitBootstrapTerms(records) {
      const values = records.map(sanitiseBootstrapTerm);
      const db = await this.db();
      const tx = db.transaction("terms", "readwrite");
      const terms = tx.objectStore("terms");
      for (const value of values) terms.put(value);
      await transactionDone(tx);
      return values.length;
    }
    async search(query, limit = 100, scopes, offset = 0, includeTotal = false, blockedUsernames = BLOCKED_USERNAMES,
      mutedThreadIds = [], revealHidden = false, resultKind = "") {
      const clauses = parseQuery(query);
      if (!clauses.length) return includeTotal ? { items: [], total: 0 } : [];
      const db = await this.db();
      const postingTransaction = db.transaction("terms", "readonly");
      const terms = postingTransaction.objectStore("terms");
      const clauseRequests = clauses.map(clause => {
        const fields = clause.field ? [clause.field] : ["user", "title", "body"];
        const term = clause.field === "email" ? clause.value : clause.tokens[0];
        return fields.map(field => {
          const prefix = termPrefix(term);
          const range = clause.prefix && Array.from(term).length < 3
            ? IDBKeyRange.bound([field, term], [field, `${term}\uffff`])
            : IDBKeyRange.only([field, prefix]);
          return requestResult(terms.getAll(range)).then(records => records.flatMap(record => record.postings
            .filter(([storedTerm]) => clause.prefix ? storedTerm.startsWith(term) : storedTerm === term)
            .flatMap(([, docKeys]) => docKeys)));
        });
      });
      const postingGroups = await Promise.all(clauseRequests.map(requests => Promise.all(requests)));
      const candidateKeys = intersectSets(postingGroups.map(groups => new Set(groups.flat())));
      const candidateTransaction = db.transaction("documents", "readonly");
      const candidateStore = candidateTransaction.objectStore("documents");
      const results = [];
      const blocked = blockedMatcher(blockedUsernames); const muted = new Set(mutedThreadIds.map(Number)); const visibility = new Map();
      const visible = async document => {
        if (!document || (!revealHidden && (blocked(document.username) || muted.has(Number(document.threadId))))) return false;
        if (!document.parentPostId) return true;
        if (visibility.has(document.docKey)) return visibility.get(document.docKey);
        const parent = await requestResult(candidateStore.get(`r:${document.parentPostId}`));
        const value = await visible(parent); visibility.set(document.docKey, value); return value;
      };
      const roots = new Map();
      const matchedDocuments = new Map();
      const candidateKeyList = [...candidateKeys];
      for (let start = 0; start < candidateKeyList.length; start += CANDIDATE_BATCH_SIZE) {
        const batchKeys = candidateKeyList.slice(start, start + CANDIDATE_BATCH_SIZE);
        const candidates = await Promise.all(batchKeys.map(key => requestResult(candidateStore.get(key))));
        for (const document of candidates.filter(Boolean)) {
          if (resultKind && document.kind !== resultKind) continue;
          if (!await visible(document)) continue;
          if (!permittedFields(document.kind, clauses[0], scopes).length) continue;
          const score = scoreDocument(document, clauses, scopes);
          if (!score) continue;
          matchedDocuments.set(document.docKey, document);
          results.push({
            docKey: document.docKey, threadId: document.threadId, title: document.title,
            username: document.username, createdUtc: document.createdUtc, kind: document.kind,
            threadTitle: document.threadTitle || document.title,
            canonicalUrl: document.canonicalUrl, snippet: makeSnippet(document, clauses), score
          });
        }
        if (start + CANDIDATE_BATCH_SIZE < candidateKeyList.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const rootIds = [...new Set(results.map(result => result.threadId))];
      const rootTransaction = db.transaction("documents", "readonly");
      const rootStore = rootTransaction.objectStore("documents");
      const rootDocuments = await Promise.all(rootIds.map(id => requestResult(rootStore.get(`t:${id}`))));
      for (const root of rootDocuments.filter(Boolean)) roots.set(root.threadId, root);
      results.sort((a, b) => b.score - a.score || b.createdUtc.localeCompare(a.createdUtc) || a.docKey.localeCompare(b.docKey));
      const size = Math.max(1, Math.min(Number(limit) || 25, 100));
      const start = Math.max(0, Number(offset) || 0);
      const selected = results.slice(start, start + size);
      this.navigationCache.clear();
      for (const result of selected) {
        const target = matchedDocuments.get(result.docKey);
        const root = roots.get(result.threadId);
        result.archived = isArchivedRoot(root);
        if (root && target) this.navigationCache.set(result.docKey, makeNavigationPayload(root, target));
      }
      return includeTotal ? { items: selected, total: results.length } : selected;
    }
    async backfillThreads(seed, count, excludeIds, blockedUsernames = BLOCKED_USERNAMES, mutedThreadIds = [], revealHidden = false) {
      const db = await this.db();
      const metadata = await requestResult(db.transaction("threads", "readonly")
        .objectStore("threads").index("advertisedPostCount").getAll(IDBKeyRange.only(1)));
      const store = db.transaction("documents", "readonly").objectStore("documents");
      const roots = await Promise.all(metadata.map(item => requestResult(store.get(`t:${item.threadId}`))));
      return selectBackfillThreads(roots.filter(Boolean), seed, count, excludeIds, blockedUsernames, mutedThreadIds, revealHidden);
    }
    async catalogueThreads() {
      const db = await this.db();
      return requestResult(db.transaction("documents", "readonly").objectStore("documents")
        .index("kindUsername").getAll(IDBKeyRange.bound(["t", ""], ["t", "\uffff"])));
    }
    async navigationTarget(docKey) {
      const key = String(docKey || "");
      if (this.navigationCache.has(key)) return structuredClone(this.navigationCache.get(key));
      const db = await this.db();
      const getDocument = documentKey => requestResult(
        db.transaction("documents", "readonly").objectStore("documents").get(documentKey)
      );
      const target = await getDocument(key);
      if (!target) throw new Error("Indexed post not found");
      const root = target.kind === "t" ? target : await getDocument(`t:${target.threadId}`);
      return makeNavigationPayload(root, target);
    }
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  class BootstrapImporter {
    constructor({ repository, fetchImpl = (...arguments_) => fetch(...arguments_), manifestUrl }) {
      this.repository = repository;
      this.fetchImpl = fetchImpl;
      this.manifestUrl = manifestUrl;
    }
    async run({ allowUpdate = false } = {}) {
      const existing = await this.repository.stats();
      const hadExisting = Boolean(existing.documents || existing.threads);
      const savedState = await this.repository.getSync();
      const resumingBootstrap = Boolean(savedState && savedState.phase === "bootstrap");
      if (hadExisting && !allowUpdate && !resumingBootstrap) return { used: false, reason: "index-not-empty" };
      const manifestResponse = await this.fetchImpl(this.manifestUrl, { cache: "no-store", credentials: "omit" });
      if (!manifestResponse.ok) throw new Error(`Bootstrap manifest returned ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();
      if (manifest.format !== "fewercunts-search-bootstrap" || manifest.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION
          || !Number.isSafeInteger(manifest.compressedBytes) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
          || !Number.isSafeInteger(manifest.termCount) || !Number.isSafeInteger(manifest.shardCount)
          || typeof manifest.url !== "string"
          || !Number.isFinite(Date.parse(manifest.latestPostUtc))) throw new Error("Invalid bootstrap manifest");
      const localLatestPostUtc = hadExisting ? await this.repository.latestPostUtc() : null;
      if (!resumingBootstrap && localLatestPostUtc && Date.parse(manifest.latestPostUtc) <= Date.parse(localLatestPostUtc)) {
        return { used: false, reason: "snapshot-not-newer", localLatestPostUtc, remoteLatestPostUtc: manifest.latestPostUtc };
      }
      const response = await this.fetchImpl(manifest.url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`Bootstrap asset returned ${response.status}`);
      const compressed = await response.arrayBuffer();
      if (compressed.byteLength !== manifest.compressedBytes) throw new Error("Bootstrap size mismatch");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", compressed)))
        .map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== manifest.sha256) throw new Error("Bootstrap checksum mismatch");
      const readRecords = async onRecord => {
        let threads = 0;
        let documents = 0;
        let terms = 0;
        let shards = 0;
        let records = 0;
        let sawHeader = false;
        let buffer = "";
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
        for await (const chunk of stream) {
          buffer += chunk;
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const record = JSON.parse(line);
            if (record.type === "header") {
              if (sawHeader || record.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION || records) throw new Error("Invalid bootstrap header");
              sawHeader = true;
              continue;
            }
            if (!sawHeader) throw new Error("Missing bootstrap header");
            records += 1;
            if (record.type === "thread") {
              const thread = sanitiseBootstrapThread(record);
              threads += 1;
              documents += 1 + thread.replies.length;
            } else {
              const shard = sanitiseBootstrapTerm(record);
              terms += shard.postings.length;
              shards += 1;
            }
            await onRecord(record, { threads, documents, terms, shards });
            // Parsing a full snapshot can otherwise monopolise the MV3 worker long
            // enough for Chromium to classify it as unresponsive and terminate it.
            if (records % 500 === 0) await delay(0);
          }
        }
        if (buffer.trim() || !sawHeader || threads !== manifest.threadCount
            || documents !== manifest.documentCount || terms !== manifest.termCount || shards !== manifest.shardCount) {
          throw new Error("Bootstrap record count mismatch");
        }
        return { threads, documents, terms, shards };
      };
      let resetStarted = false;
      try {
        const validated = await readRecords(async () => {});
        const initialState = { phase: "bootstrap", page: 1, pending: [], discovered: 0,
          catalogued: 0, totalThreads: manifest.threadCount, skipped: 0, completed: 0,
          failed: 0, cancelled: false, schemaVersion: DB_VERSION };
        await this.repository.resetBootstrap(initialState);
        resetStarted = true;
        let threadBatch = [];
        let termBatch = [];
        const commitThreads = async counts => {
          if (!threadBatch.length) return;
          await this.repository.commitBootstrapBatch(threadBatch, { ...initialState,
            discovered: counts.threads, catalogued: counts.threads, completed: counts.threads });
          threadBatch = [];
        };
        const commitTerms = async () => {
          if (!termBatch.length) return;
          await this.repository.commitBootstrapTerms(termBatch);
          termBatch = [];
        };
        await readRecords(async (record, counts) => {
          if (record.type === "thread") {
            threadBatch.push(record);
            if (threadBatch.length >= BOOTSTRAP_BATCH_SIZE) await commitThreads(counts);
          } else {
            await commitThreads(counts);
            termBatch.push(record);
            if (termBatch.length >= BOOTSTRAP_TERM_BATCH_SIZE) await commitTerms();
          }
        });
        await commitThreads(validated);
        await commitTerms();
        const completedUtc = new Date().toISOString();
        await this.repository.putSync({ phase: "complete", page: 1, pending: [], discovered: validated.threads,
          catalogued: validated.threads, totalThreads: validated.threads, skipped: 0, completed: validated.threads, failed: 0,
          cancelled: false, schemaVersion: DB_VERSION, completedUtc, bootstrapSha256: digest,
          bootstrapLatestPostUtc: manifest.latestPostUtc });
        return { used: true, updated: hadExisting, threads: validated.threads,
          documents: validated.documents, terms: validated.terms, shards: validated.shards, sha256: digest };
      } catch (error) {
        if (!hadExisting && !resetStarted) await this.repository.clear();
        throw error;
      }
    }
  }

  class InitialImporter {
    constructor({ repository, fetchJson, wait = delay, requestDelayMs = 500 }) {
      this.repository = repository;
      this.fetchJson = fetchJson;
      this.wait = wait;
      this.requestDelayMs = requestDelayMs;
      this.cancelRequested = false;
    }
    async status() {
      const defaults = {
        phase: "disabled", page: 1, pending: [], discovered: 0, catalogued: 0,
        totalThreads: 0, skipped: 0, completed: 0, failed: 0,
        cancelled: false, schemaVersion: DB_VERSION
      };
      const saved = await this.repository.getSync();
      if (!saved) return defaults;
      return { ...defaults, ...saved,
        page: Number.isSafeInteger(Number(saved.page)) && Number(saved.page) > 0 ? Number(saved.page) : 1,
        pending: Array.isArray(saved.pending) ? saved.pending : [] };
    }
    async setCancelled(cancelled) {
      this.cancelRequested = Boolean(cancelled);
      const state = await this.status();
      const next = { ...state, cancelled, phase: cancelled && state.phase !== "complete" ? "paused" : state.phase };
      await this.repository.putSync(next);
      return next;
    }
    async run({ maxThreads = Infinity } = {}) {
      let state = await this.status();
      if (state.phase === "complete") return state;
      this.cancelRequested = false;
      state = { ...state, phase: "catalogue", cancelled: false };
      await this.repository.putSync(state);
      let processedThisRun = 0;
      while (!state.cancelled && processedThisRun < maxThreads) {
        if (!state.pending.length) {
          const payload = await this.fetchJson(`/api/forum/threads/page/${state.page}`);
          if (this.cancelRequested) {
            state = { ...state, phase: "paused", cancelled: true };
            await this.repository.putSync(state);
            return state;
          }
          const rawThreads = Array.isArray(payload.Threads) ? payload.Threads : [];
          if (!rawThreads.length) {
            state = { ...state, phase: "complete", completedUtc: new Date().toISOString() };
            await this.repository.putSync(state);
            return state;
          }
          const threads = rawThreads.map(sanitiseThread).filter(thread => !isBlocked(thread.root.username));
          state = {
            ...state,
            pending: threads,
            discovered: (state.discovered || 0) + threads.length,
            catalogued: (state.catalogued || 0) + rawThreads.length,
            totalThreads: requiredInteger(payload.ThreadCount ?? state.totalThreads, "thread count"),
            skipped: (state.skipped || 0) + rawThreads.length - threads.length,
            page: state.page + 1
          };
          await this.repository.putSync(state);
        }
        const thread = state.pending[0];
        try {
          await this.wait(this.requestDelayMs);
          if (this.cancelRequested) {
            state = { ...state, phase: "paused", cancelled: true };
            await this.repository.putSync(state);
            return state;
          }
          const replyPayload = await this.fetchJson(`/api/forum/thread/${thread.threadId}/replies`);
          if (this.cancelRequested) {
            state = { ...state, phase: "paused", cancelled: true };
            await this.repository.putSync(state);
            return state;
          }
          const replyTree = Array.isArray(replyPayload) ? replyPayload : (replyPayload.Replies || []);
          const replies = flattenReplies(replyTree, thread.threadId);
          state = { ...state, phase: "threads", pending: state.pending.slice(1), completed: state.completed + 1 };
          await this.repository.commitThread(thread, replies, state);
        } catch (error) {
          state = { ...state, phase: "paused", lastError: String(error && error.message || error) };
          await this.repository.putSync(state);
          throw error;
        }
        processedThisRun += 1;
        state = await this.status();
      }
      if (state.cancelled && state.phase !== "complete" && state.phase !== "paused") {
        state = { ...state, phase: "paused" };
        await this.repository.putSync(state);
      }
      return state;
    }
  }

  class IncrementalSynchronizer {
    constructor({ repository, fetchJson, wait = delay, requestDelayMs = 500, now = () => Date.now() }) {
      this.repository = repository;
      this.fetchJson = fetchJson;
      this.wait = wait;
      this.requestDelayMs = requestDelayMs;
      this.now = now;
    }
    async status() {
      const saved = await this.repository.getUpdate();
      if (saved) return { ...saved,
        pending: Array.isArray(saved.pending) ? saved.pending : [],
        pendingRemovals: Array.isArray(saved.pendingRemovals) ? saved.pendingRemovals : [] };
      const initial = await this.repository.getSync();
      const baseline = initial && initial.phase === "complete" ? (initial.completedUtc || new Date(this.now()).toISOString()) : null;
      return { phase: "idle", pending: [], checked: 0, refreshed: 0, removed: 0, lastSuccessUtc: baseline, lastFullReconcileUtc: baseline, lastReplyReconcileUtc: baseline };
    }
    async due(force = false) {
      const settings = await this.repository.getSettings();
      if (!settings.enabled) return false;
      const state = await this.status();
      if (state.pending.length || (state.pendingRemovals || []).length) return true;
      const elapsed = this.now() - Date.parse(state.lastSuccessUtc || 0);
      return force || !Number.isFinite(elapsed) || elapsed >= settings.refreshMinutes * 60_000;
    }
    async run({ force = false } = {}) {
      if (!await this.due(force)) return { ...(await this.status()), debounced: true };
      const settings = await this.repository.getSettings();
      let state = await this.status();
      try {
        if (!state.pending.length && !(state.pendingRemovals || []).length) {
          const lastFull = Date.parse(state.lastFullReconcileUtc || 0);
          const full = !Number.isFinite(lastFull) || this.now() - lastFull >= settings.fullReconcileDays * 86_400_000;
          const lastReply = Date.parse(state.lastReplyReconcileUtc || 0);
          const reconcileReplies = !Number.isFinite(lastReply) || this.now() - lastReply >= settings.replyReconcileDays * 86_400_000;
          const seen = [];
          const changed = [];
          let page = 1;
          let unchangedPages = 0;
          while (full || unchangedPages < 2) {
            const payload = await this.fetchJson(`/api/forum/threads/page/${page}`);
            const raw = Array.isArray(payload.Threads) ? payload.Threads : [];
            if (!raw.length) break;
            let pageChanged = false;
            for (const item of raw) {
              const thread = sanitiseThread(item);
              seen.push(thread.threadId);
              const old = await this.repository.threadMetadata(thread.threadId);
              if (!isBlocked(thread.root.username) && (reconcileReplies || !old || old.lastPostUtc !== thread.lastPostUtc || old.advertisedPostCount !== thread.advertisedPostCount || old.rootSignature !== threadSignature(thread))) {
                changed.push(thread);
                pageChanged = true;
              }
            }
            unchangedPages = pageChanged ? 0 : unchangedPages + 1;
            page += 1;
          }
          const removed = full ? (await this.repository.allThreadIds()).filter(id => !seen.includes(id)) : [];
          state = { ...state, phase: "refresh", pending: changed, pendingRemovals: removed, checked: seen.length, refreshed: 0, removed: 0, full, reconcileReplies, startedUtc: new Date(this.now()).toISOString(), lastError: null };
          await this.repository.putUpdate(state);
        } else {
          state = { ...state, phase: "refresh", lastError: null };
          await this.repository.putUpdate(state);
        }
        while (state.pending.length) {
          const thread = state.pending[0];
          await this.wait(this.requestDelayMs);
          const payload = await this.fetchJson(`/api/forum/thread/${thread.threadId}/replies`);
          const replies = flattenReplies(Array.isArray(payload) ? payload : (payload.Replies || []), thread.threadId);
          state = { ...state, pending: state.pending.slice(1), refreshed: state.refreshed + 1 };
          await this.repository.commitThread(thread, replies, await this.repository.getSync());
          await this.repository.putUpdate(state);
        }
        while ((state.pendingRemovals || []).length) {
          await this.repository.deleteThread(state.pendingRemovals[0]);
          state = { ...state, pendingRemovals: state.pendingRemovals.slice(1), removed: state.removed + 1 };
          await this.repository.putUpdate(state);
        }
        const completedUtc = new Date(this.now()).toISOString();
        state = { ...state, phase: "idle", lastSuccessUtc: completedUtc, lastFullReconcileUtc: state.full ? completedUtc : state.lastFullReconcileUtc, lastReplyReconcileUtc: state.reconcileReplies ? completedUtc : state.lastReplyReconcileUtc, completedUtc };
        await this.repository.putUpdate(state);
        return state;
      } catch (error) {
        state = { ...state, phase: "paused", lastError: String(error && error.message || error) };
        await this.repository.putUpdate(state);
        throw error;
      }
    }
  }

  return { DB_NAME, DB_VERSION, BootstrapImporter, IndexedDbRepository, InitialImporter, IncrementalSynchronizer, isArchivedRoot, normalise, sanitiseBootstrapTerm, sanitiseBootstrapThread, sanitiseThread, flattenReplies, makeNavigationPayload, makeSnippet, parseQuery, postingsForDocument, scoreDocument, selectBackfillThreads, selectClassicThreads, selectUnlovedThreads, selectUsernames, tokenise };
});
