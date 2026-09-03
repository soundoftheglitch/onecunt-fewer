if (typeof importScripts === "function") {
  importScripts("search/indexer.js", "search/catalogue.js", "search/message-router.js", "search/compact-reader.js", "search/persistent-index-contract.js",
    "search/persistent-index-storage.js", "search/member-stats.js", "search/unanswered-state.js",
    "search/persistent-index-reader.js", "search/persistent-index-manager.js",
    "search/compiled-query.js", "search/compact-delta.js", "search/index-migration.js", "search/read-state.js",
    "search/saved-state.js", "search/notification-state.js", "search/notification-runtime.js",
    "search/block-list.js", "search/muted-threads.js", "search/categories.js");
}

const repository = new FewerCuntsIndexer.IndexedDbRepository(indexedDB);
const fetchJson = async path => {
  const response = await fetch(new URL(path, "https://ntforum.net"), { credentials: "omit" });
  if (!response.ok) throw new Error(`NTForum API returned ${response.status}`);
  return response.json();
};
const compactReader = new FewerCuntsCompactReader.CompactReader({
  pointerUrl: "https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.0/search-latest.json",
  publicKeyUrl: chrome.runtime.getURL("search/index-signing-public.pem")
});
const persistentStorage = new FewerCuntsPersistentIndexStorage.PersistentIndexStorage();
const persistentReader = new FewerCuntsPersistentIndexReader.PersistentIndexReader({ storage: persistentStorage });
const compactManager = new FewerCuntsPersistentIndexManager.PersistentIndexManager({
  storage: persistentStorage, reader: persistentReader, downloader: compactReader
});
const compiledQuery = new FewerCuntsCompiledQuery.CompiledQueryEngine({ reader: persistentReader });
const compactDeltaRepository = new FewerCuntsCompactDelta.CompactDeltaRepository(indexedDB);
const readState = new FewerCuntsReadState.ReadStateRepository(indexedDB);
const savedThreads = new FewerCuntsSavedState.SavedThreadRepository(indexedDB);
const notifications = new FewerCuntsNotificationState.NotificationRepository(indexedDB);
const blockList = new FewerCuntsBlockList.BlockListRepository(indexedDB);
const mutedThreads = new FewerCuntsMutedThreads.MutedThreadRepository(indexedDB);
async function loadCategoryBase() {
  const bundled = async () => {
    const response = await fetch(chrome.runtime.getURL("search/categories-data.json"));
    if (!response.ok) throw new Error(`Category base returned ${response.status}`);
    return response.json();
  };
  try {
    const pointerResponse = await fetch("https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.0/categories-latest.json", { cache: "no-store" });
    if (!pointerResponse.ok) throw new Error("Category pointer unavailable");
    const pointer = await pointerResponse.json();
    if (pointer.format !== "ntforum-categories-pointer" || !/^categories-v1-[a-f0-9]{12}$/.test(pointer.generationTag)
        || !/^https:\/\/github\.com\/soundoftheglitch\/onecunt-fewer\/releases\/download\/v4\.5\.0\//.test(pointer.mapUrl || "")) {
      throw new Error("Invalid category pointer");
    }
    const [manifestResponse, signatureResponse, keyResponse, mapResponse] = await Promise.all([
      fetch(pointer.manifestUrl), fetch(pointer.signatureUrl), fetch(chrome.runtime.getURL("search/index-signing-public.pem")), fetch(pointer.mapUrl)
    ]);
    if (![manifestResponse, signatureResponse, keyResponse, mapResponse].every(response => response.ok)) throw new Error("Category generation unavailable");
    const manifestBytes = await manifestResponse.arrayBuffer(); const signatureBytes = await signatureResponse.arrayBuffer();
    const keyText = await keyResponse.text(); const mapBytes = await mapResponse.arrayBuffer();
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
    const hash = async bytes => hex(await crypto.subtle.digest("SHA-256", bytes));
    const keyBytes = new TextEncoder().encode(keyText);
    if (await hash(manifestBytes) !== pointer.manifestSha256 || await hash(mapBytes) !== pointer.mapSha256
        || await hash(keyBytes) !== pointer.publicKeySha256) throw new Error("Category hash mismatch");
    await FewerCuntsCompactReader.verifyManifest(manifestBytes, signatureBytes, keyText);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (manifest.mapSha256 !== pointer.mapSha256) throw new Error("Category manifest mismatch");
    const stream = new Blob([mapBytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const value = JSON.parse(await new Response(stream).text());
    if (value.version !== 1 || typeof value.threads !== "object") throw new Error("Invalid category map");
    return value;
  } catch (error) {
    console.warn("fewerCunts remote category map unavailable; using bundled base:", error);
    return bundled();
  }
}
const categories = new FewerCuntsCategories.CategoryRepository(indexedDB, async () => {
  return loadCategoryBase();
});
const compactDelta = new FewerCuntsCompactDelta.CompactDeltaSynchronizer({ repository: compactDeltaRepository, fetchJson });
const migrationState = new FewerCuntsIndexMigration.MigrationStateRepository(indexedDB);
const legacyProfile = new FewerCuntsIndexMigration.LegacyProfileInspector(indexedDB, FewerCuntsIndexer.DB_NAME);
const migration = new FewerCuntsIndexMigration.IndexMigrationCoordinator({ state: migrationState,
  legacy: repository, profile: legacyProfile, compactManager, compiledQuery, delta: compactDeltaRepository });
let activeRun = null;
let activeCompact = null;
let activeDelta = null;
let classicBaseCache = null;
let classicBaseCachedAt = 0;

async function visibilitySettings(revealHidden = false) {
  const [setting, ids] = await Promise.all([blockList.get(), mutedThreads.ids()]);
  return { blockedUsernames: setting.usernames, mutedThreadIds: ids, revealHidden: Boolean(revealHidden) };
}

async function blockVisibleDeltaDocuments() {
  const [documents, setting] = await Promise.all([compactDeltaRepository.documents(), blockList.get()]);
  return FewerCuntsBlockList.visibleDocuments(documents, setting.usernames);
}

function summariseReadRecords(records) {
  const threads = new Map(); let total = 0; const unreadDocKeys = [];
  for (const record of records) {
    const unread = record.readFingerprint !== record.currentFingerprint;
    if (unread) { total += 1; unreadDocKeys.push(record.docKey); }
    const state = threads.get(record.threadId) || { threadId: record.threadId, unreadCount: 0, totalCount: 0 };
    state.totalCount += 1; if (unread) state.unreadCount += 1; threads.set(record.threadId, state);
  }
  return { total, threads: [...threads.values()], unreadDocKeys };
}

async function refreshReadState(revealHidden = false) {
  await readState.refresh(await blockVisibleDeltaDocuments());
  const [records, ids, state] = await Promise.all([readState.records(), mutedThreads.ids(), readState.summary()]);
  const visible = FewerCuntsMutedThreads.visibleRecords(records, ids, revealHidden);
  return { ...summariseReadRecords(visible), allUnread: state.allUnread,
    readDocKeys: visible.filter(record => record.readFingerprint === record.currentFingerprint).map(record => record.docKey) };
}

async function materializeReadDocuments(docKeys) {
  const documents = [];
  for (const docKey of [...new Set(Array.isArray(docKeys) ? docKeys : [])].slice(0, 1000)) {
    if (!/^[tr]:\d+$/.test(String(docKey))) continue;
    try {
      const payload = await navigationTarget(docKey); const reply = String(docKey).startsWith("r:");
      const raw = reply ? payload.target : payload.thread; const thread = payload.thread;
      if (!raw || !thread) continue;
      documents.push({ docKey: String(docKey), kind: reply ? "r" : "t", threadId: Number(thread.Id),
        postId: Number(raw.Id), parentPostId: reply ? (Number(raw.ParentPostId) || Number(thread.Id)) : null,
        username: String(raw.PostedByUsername || ""), title: String(raw.Title || thread.Title || "Untitled post"),
        threadTitle: String(thread.Title || raw.Title || "Untitled thread"), body: String(raw.Message || ""),
        createdUtc: String(raw.CreatedDateTimeUtc || ""), replyCount: Math.max(0, Number(thread.PostCount) - 1 || 0),
        canonicalUrl: `https://ntforum.net/thread/${Number(thread.Id)}${reply ? `/reply/${Number(raw.Id)}` : ""}` });
    } catch (_) {}
  }
  if (documents.length) await readState.upsert(documents);
}

async function markRead(message) {
  await refreshReadState(message.revealHidden);
  await materializeReadDocuments(message.visibleDocKeys || message.docKeys);
  await readState.mark(message);
  return refreshReadState(message.revealHidden);
}

async function unreadList(offset, limit, revealHidden = false) {
  await refreshReadState(revealHidden);
  const ids = revealHidden ? [] : await mutedThreads.ids();
  const records = FewerCuntsMutedThreads.visibleRecords(await readState.records(), ids, revealHidden)
    .filter(record => record.readFingerprint !== record.currentFingerprint)
    .sort((a, b) => String(b.createdUtc).localeCompare(String(a.createdUtc)) || b.docKey.localeCompare(a.docKey));
  const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
  return { total: records.length, firstUnread: records.length ? { ...records[records.length - 1], unread: true } : null,
    items: records.slice(start, start + size).map(record => ({ ...record, unread: true })) };
}

async function savedList(offset, limit, revealHidden = false) {
  const [records, visibility] = await Promise.all([savedThreads.records(), visibilitySettings(revealHidden)]);
  const blocked = new Set(visibility.blockedUsernames.map(FewerCuntsBlockList.normalise));
  const muted = new Set(visibility.mutedThreadIds.map(Number));
  const visible = records.filter(item => visibility.revealHidden
      || (!blocked.has(FewerCuntsBlockList.normalise(item.username)) && !muted.has(Number(item.threadId))))
    .sort((a, b) => String(b.savedUtc).localeCompare(String(a.savedUtc)) || b.threadId - a.threadId);
  const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const list = { total: visible.length, items: visible.slice(start, start + size) };
  const unread = await refreshReadState(revealHidden);
  const unreadByThread = new Map(unread.threads.map(item => [Number(item.threadId), Number(item.unreadCount) || 0]));
  list.items = await Promise.all(list.items.map(async item => {
    try { await navigationTarget(item.docKey); return { ...item, missing: false,
      unreadCount: unreadByThread.get(item.threadId) || 0 }; }
    catch (_) { return { ...item, missing: true, unreadCount: unreadByThread.get(item.threadId) || 0 }; }
  }));
  return list;
}

async function classicList(message) {
  const migration = await migrationState.get();
  if (migration.phase !== "complete") {
    startImport().catch(() => {});
    throw new Error("The local forum catalogue is still preparing; Classic remains on NTForum's native 25-row page until it is ready");
  }
  // Do not replace NTForum's current native page with a signed base that is
  // older than the device's first bounded Today/Yesterday reconciliation.
  // Subsequent calls debounce locally according to the selected refresh rate.
  try { await maintainDelta(); }
  catch (_) {
    throw new Error("The recent forum update is unavailable; Classic remains on NTForum's native 25-row page until it is ready");
  }
  if (!classicBaseCache || Date.now() - classicBaseCachedAt > 5 * 60_000) {
    classicBaseCache = compactManager.startup().then(status => {
      if (status.phase !== "ready" || !status.active) throw new Error("The signed local forum catalogue is unavailable");
      return persistentReader.catalogueThreads();
    }).then(value => {
      classicBaseCachedAt = Date.now(); return value;
    }).catch(error => { classicBaseCache = null; throw error; });
  }
  const [base, delta, tombstones, visibility] = await Promise.all([
    classicBaseCache, compactDeltaRepository.catalogueThreads(), compactDeltaRepository.tombstonedThreadIds(),
    visibilitySettings(false)
  ]);
  if (!base.length) throw new Error("The local forum catalogue is unavailable");
  const projection = FewerCuntsCatalogue.project(base, delta, tombstones, visibility);
  return FewerCuntsIndexer.selectClassicThreads(projection.visible, [], [], message.sortOrder,
    message.offset, message.limit);
}

async function unlovedList(message) {
  const status = await compactManager.startup();
  if (status.phase !== "ready" || !status.active) throw new Error("The signed local forum catalogue is unavailable");
  try { await maintainDelta(); }
  catch (_) {
    throw new Error("The recent forum update is unavailable; Unloved cannot be shown safely until it is ready");
  }
  const [base, delta, tombstones, visibility] = await Promise.all([
    persistentReader.catalogueThreads(), compactDeltaRepository.catalogueThreads(),
    compactDeltaRepository.tombstonedThreadIds(), visibilitySettings(message.revealHidden)
  ]);
  const projection = FewerCuntsCatalogue.project(base, delta, tombstones, visibility);
  return FewerCuntsIndexer.selectUnlovedThreads(projection.visible, message.offset, message.limit, [], [], true);
}

async function categoryThreads(message) {
  const status = await compactManager.startup();
  if (status.phase !== "ready" || !status.active) throw new Error("The signed local forum catalogue is unavailable");
  const categoryId = FewerCuntsCategories.resolve(message.categoryId);
  if (!categoryId) throw new Error("Unknown category");
  const [base, delta, tombstones, visibility] = await Promise.all([
    persistentReader.catalogueThreads(), compactDeltaRepository.catalogueThreads(),
    compactDeltaRepository.tombstonedThreadIds(), visibilitySettings(false)
  ]);
  const projection = FewerCuntsCatalogue.project(base, delta, tombstones, visibility);
  const combined = projection.visible
    .sort((left, right) => String(right.lastPostUtc || right.createdUtc).localeCompare(String(left.lastPostUtc || left.createdUtc)) || right.threadId - left.threadId);
  const values = [];
  for (let offset = 0; offset < combined.length; offset += 500) values.push(...await categories.get(combined.slice(offset, offset + 500)
    .map(item => ({ docKey: item.docKey, threadId: item.threadId }))));
  const selected = combined.filter((item, index) => values[index]?.categoryId === categoryId);
  const start = Math.max(0, Number(message.offset) || 0); const limit = Math.max(1, Math.min(100, Number(message.limit) || 25));
  return { categoryId, total: selected.length, items: selected.slice(start, start + limit) };
}

async function submitCanonicalCategory(message) {
  const threadId = Number(message.threadId); const categoryId = FewerCuntsCategories.resolve(message.categoryId);
  if (!Number.isSafeInteger(threadId) || threadId < 1 || !categoryId) throw new Error("Invalid reviewed category");
  const response = await fetch("http://127.0.0.1:8767/v1/thread-category", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, categoryId }) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value.ok) throw new Error(value.error || "Local category review service unavailable");
  await categories.set(`t:${threadId}`, threadId, categoryId);
  return value;
}

async function usernameSuggestions(message) {
  let migration = await migrationState.get();
  if (migration.phase !== "complete") migration = await startImport();
  if (migration.phase !== "complete") return [];
  if (!classicBaseCache || Date.now() - classicBaseCachedAt > 5 * 60_000) {
    classicBaseCache = compactManager.startup().then(status => {
      if (status.phase !== "ready" || !status.active) throw new Error("The signed local forum catalogue is unavailable");
      return persistentReader.catalogueThreads();
    }).then(value => { classicBaseCachedAt = Date.now(); return value; })
      .catch(error => { classicBaseCache = null; throw error; });
  }
  const [base, delta, setting] = await Promise.all([
    classicBaseCache, compactDeltaRepository.catalogueThreads(), blockList.get()
  ]);
  return FewerCuntsIndexer.selectUsernames(base, delta, message.query, setting.usernames, message.limit);
}

async function memberRecords(revealHidden = false) {
  const status = await compactManager.startup();
  if (status.phase !== "ready" || !status.active) throw new Error("The signed local member catalogue is unavailable");
  const [delta, tombstones, visibility] = await Promise.all([
    compactDeltaRepository.documents(), compactDeltaRepository.tombstonedThreadIds(), visibilitySettings(revealHidden)
  ]);
  const statistics = persistentReader.memberStatistics(); const byThread = new Map();
  for (const document of delta) {
    const threadId = Number(document.threadId); if (!Number.isSafeInteger(threadId) || threadId < 1) continue;
    if (!byThread.has(threadId)) byThread.set(threadId, []); byThread.get(threadId).push(document);
  }
  for (const threadId of new Set([...tombstones.map(Number), ...byThread.keys()])) {
    statistics.replaceThread(threadId, byThread.get(threadId) || []);
  }
  const items = statistics.snapshot(visibility.revealHidden ? [] : visibility.blockedUsernames);
  return { items, total: items.length, watermark: status.active.watermark };
}

async function unansweredRecords(username, revealHidden = false) {
  const status = await compactManager.startup();
  if (status.phase !== "ready" || !status.active) throw new Error("The signed local conversation catalogue is unavailable");
  const [delta, tombstones, visibility] = await Promise.all([
    compactDeltaRepository.documents(), compactDeltaRepository.tombstonedThreadIds(), visibilitySettings(revealHidden)
  ]);
  const catalogue = persistentReader.conversationCatalogue(); const byThread = new Map();
  for (const document of delta) {
    const threadId = Number(document.threadId); if (!Number.isSafeInteger(threadId) || threadId < 1) continue;
    if (!byThread.has(threadId)) byThread.set(threadId, []); byThread.get(threadId).push(document);
  }
  for (const threadId of new Set([...tombstones.map(Number), ...byThread.keys()])) {
    if (byThread.has(threadId)) catalogue.replaceThread(threadId, byThread.get(threadId));
    else catalogue.deleteThread(threadId);
  }
  const value = catalogue.snapshot(username, visibility.revealHidden ? [] : visibility.blockedUsernames);
  return { ...value, total: value.posts.length + value.replies.length, watermark: status.active.watermark };
}

function maintainCompact({ checkRemote = false, force = false } = {}) {
  if (!activeCompact) activeCompact = compactManager.startup().then(status =>
    status.phase === "empty" || checkRemote ? compactManager.install({ force }) : status
  ).then(async result => {
    const watermark = result.active?.watermark;
    if (watermark) await compactDeltaRepository.pruneThrough(watermark);
    return result;
  }).finally(() => { activeCompact = null; });
  return activeCompact;
}

function maintainDelta({ force = false } = {}) {
  if (!activeDelta) activeDelta = Promise.all([compactManager.startup(), repository.getSettings()]).then(([status, settings]) => {
    if (status.phase !== "ready") return { result: "compact-unavailable" };
    if (!settings.enabled) return { result: "disabled", phase: "paused", debounced: true, refreshed: 0, removed: 0, requests: 0 };
    return compactDelta.run({ baseWatermark: status.active.watermark, force,
      debounceMs: settings.refreshMinutes * 60_000 });
  }).then(async result => {
    await refreshReadState();
    const detected = await notifications.reconcile(await blockVisibleDeltaDocuments());
    await showBrowserNotifications(detected.created);
    return { ...result, notifications: detected.total };
  }).finally(() => { activeDelta = null; });
  return activeDelta;
}

async function showBrowserNotifications(docKeys) {
  return FewerCuntsNotificationRuntime.deliver({ docKeys, repository: notifications,
    permissions: chrome.permissions, notifications: chrome.notifications,
    iconUrl: chrome.runtime.getURL("icons/icon128.png") });
}

async function configureNotifications(settings) {
  const previous = await notifications.settings(); const next = await notifications.settings(settings);
  if (next.enabled && (!previous.enabled || previous.username !== next.username)) {
    await notifications.reconcile(await blockVisibleDeltaDocuments(), { baseline: true });
  }
  return next;
}

async function notificationList(revealHidden = false) {
  const [records, visibility, settings] = await Promise.all([
    notifications.list(), visibilitySettings(revealHidden), notifications.settings()
  ]);
  const blocked = new Set(visibility.blockedUsernames.map(FewerCuntsBlockList.normalise));
  const muted = new Set(visibility.mutedThreadIds.map(Number));
  const items = records.filter(item => visibility.revealHidden
    || (!blocked.has(FewerCuntsBlockList.normalise(item.username)) && !muted.has(Number(item.threadId))));
  return { items, unread: items.filter(item => !item.read).length, settings };
}

async function searchQuery(message) {
  const visibility = await visibilitySettings(message.revealHidden);
  const compact = await compactManager.startup().catch(() => compactManager.status());
  const categoryMatch = /(?:^|\s)category:(?:"([^"]+)"|([^\s]+))/i.exec(String(message.query || ""));
  const categoryId = categoryMatch && FewerCuntsCategories.resolve(categoryMatch[1] || categoryMatch[2]);
  if (categoryMatch && !categoryId) throw new Error("Unknown category filter");
  const query = categoryMatch
    ? String(message.query).slice(0, categoryMatch.index) + " " + String(message.query).slice(categoryMatch.index + categoryMatch[0].length)
    : message.query;
  if (categoryMatch && !String(query).trim()) throw new Error("Add a search word alongside category:");
  const requestedOffset = Math.max(0, Number(message.offset) || 0);
  const requestedLimit = Math.max(1, Math.min(100, Number(message.limit) || 25));
  const rawOffset = categoryId ? 0 : requestedOffset;
  const rawLimit = categoryId ? 20000 : requestedLimit;
  let result;
  if (compact.phase === "ready") {
    result = await FewerCuntsCompactDelta.mergedSearch({ baseEngine: compiledQuery,
      deltaRepository: compactDeltaRepository, query, limit: rawLimit,
      scopes: message.scopes, offset: rawOffset, resultKind: message.resultKind, ...visibility });
  } else {
    result = await repository.search(query, rawLimit, message.scopes, rawOffset, true,
      visibility.blockedUsernames, visibility.mutedThreadIds, visibility.revealHidden, message.resultKind);
  }
  const values = [];
  for (let offset = 0; offset < result.items.length; offset += 500) {
    values.push(...await categories.get(result.items.slice(offset, offset + 500)
      .map(item => ({ docKey: item.docKey, threadId: item.threadId }))));
  }
  const byKey = new Map(values.map(value => [value.docKey, value]));
  let items = result.items.map(item => ({ ...item, category: byKey.get(item.docKey) }));
  if (categoryId) items = items.filter(item => item.category?.categoryId === categoryId);
  const total = categoryId ? items.length : result.total;
  if (categoryId) items = items.slice(requestedOffset, requestedOffset + requestedLimit);
  return { ...result, items, total, categoryId: categoryId || null };
}

async function authorRecords(message, resultKind) {
  const username = String(message.username || "").normalize("NFKC").trim();
  if (!username) return { items: [], total: 0 };
  const visibility = await visibilitySettings(message.revealHidden);
  const status = await compactManager.startup();
  if (status.phase !== "ready" || !status.active) throw new Error("The signed local author index is unavailable");
  const safeUsername = username.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return FewerCuntsCompactDelta.mergedSearch({ baseEngine: compiledQuery, deltaRepository: compactDeltaRepository,
    query: `user:"${safeUsername}"`, scopes: ["user"], resultKind, exactUsername: username,
    offset: message.offset, limit: message.limit, ...visibility });
}

async function navigationTarget(docKey) {
  try { return await compiledQuery.navigationTarget(docKey); }
  catch (_) {
    try { return await compactDeltaRepository.navigationTarget(docKey); }
    catch (_) { return repository.navigationTarget(docKey); }
  }
}

async function visibleNavigationTarget(docKey, revealHidden = false) {
  const [payload, visibility] = await Promise.all([navigationTarget(docKey), visibilitySettings(revealHidden)]);
  if (visibility.revealHidden) return payload;
  const threadId = Number(payload?.thread?.Id);
  const targetUsername = payload?.target?.PostedByUsername || payload?.thread?.PostedByUsername || "";
  const blocked = new Set(visibility.blockedUsernames.map(FewerCuntsBlockList.normalise));
  if (visibility.mutedThreadIds.map(Number).includes(threadId)) throw new Error("Muted navigation target");
  if (blocked.has(FewerCuntsBlockList.normalise(targetUsername))
      || blocked.has(FewerCuntsBlockList.normalise(payload?.thread?.PostedByUsername))) {
    throw new Error("Blocked navigation target");
  }
  return payload;
}

function startImport() {
  if (!activeRun) activeRun = migration.resume().finally(() => { activeRun = null; });
  return activeRun;
}

async function pauseImport() {
  const paused = await migration.pause();
  const legacy = await repository.getSync();
  if (legacy && legacy.phase !== "complete") await repository.putSync({ ...legacy, phase: "paused", cancelled: true });
  return { ...(legacy || {}), ...paused, phase: "paused" };
}

async function clearIndex() {
  await pauseImport();
  await migration.clear();
  await compactDeltaRepository.clear();
  await persistentStorage.clearAll();
  compactManager.reset();
  return repository.clear();
}

async function updateSearch(force = false) {
  const migrated = await migration.run();
  if (migrated.phase === "cleared" || migrated.phase === "paused") return migrated;
  return maintainDelta({ force });
}

async function maintainIndex() {
  return migration.run();
}

async function searchStats() {
  const compact = await compactManager.startup().catch(() => compactManager.status());
  if (compact.phase !== "ready" || !compact.active) return repository.stats();
  const estimate = await (globalThis.navigator?.storage?.estimate?.() || {});
  return { documents: compact.active.documentCount, threads: compact.active.threadCount,
    usage: compact.active.bytes,
    indexBytes: compact.active.bytes,
    originUsage: Number.isFinite(Number(estimate.usage)) ? Number(estimate.usage) : null,
    source: "compiled", generationId: compact.active.generationId };
}

async function developerReplyPolicy() {
  let compact = await compactManager.startup().catch(() => compactManager.status());
  if (compact.phase !== "ready") {
    try { await startImport(); compact = await compactManager.startup(); }
    catch (error) { return { ready: false, title: null,
      message: `The signed search database is unavailable: ${String(error.message || error)}` }; }
  }
  const watermark = compact.phase === "ready" ? String(compact.active?.watermark || "") : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(watermark);
  if (!match) {
    return { ready: false, title: null,
      message: "The signed search database is still preparing; replying to this developer thread is unavailable." };
  }
  const databaseDate = `${match[1]}${match[2]}${match[3]}`;
  const version = chrome.runtime.getManifest().version;
  return { ready: true, version, databaseDate, watermark, title: `${version}+${databaseDate}` };
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("fewercunts-reconcile", { periodInMinutes: 15 }));
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("fewercunts-reconcile", { periodInMinutes: 15 });
  migration.run().then(() => maintainDelta()).catch(error => console.warn("fewerCunts compact migration paused:", error));
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "fewercunts-reconcile") maintainCompact().then(() => maintainDelta())
    .catch(error => console.warn("fewerCunts scheduled compact update paused:", error));
});
chrome.notifications?.onClicked.addListener(async notificationId => {
  if (!notificationId.startsWith("fewercunts-reply-")) return;
  const docKey = notificationId.slice("fewercunts-reply-".length); const item = await notifications.get(docKey);
  if (!item) return; await notifications.update(docKey, { read: true });
  await chrome.tabs.create({ url: item.canonicalUrl }); chrome.notifications.clear(notificationId);
});

const searchRouter = FewerCuntsMessageRouter.create({
  "fewercunts-search:status": () => migrationState.get(),
  "fewercunts-search:start": () => startImport(),
  "fewercunts-search:pause": () => pauseImport(),
  "fewercunts-search:clear": () => clearIndex(),
  "fewercunts-search:stats": () => searchStats(),
  "fewercunts-search:developer-reply-policy": () => developerReplyPolicy(),
  "fewercunts-search:update": message => updateSearch(Boolean(message.force)),
  "fewercunts-search:update-status": () => compactDeltaRepository.state(),
  "fewercunts-search:settings": message => message.settings ? repository.putSettings(message.settings) : repository.getSettings(),
  "fewercunts-search:query": message => searchQuery(message),
  "fewercunts-search:classic": message => classicList(message),
  "fewercunts-search:category-threads": message => categoryThreads(message),
  "fewercunts-search:category-submit": message => submitCanonicalCategory(message),
  "fewercunts-search:usernames": message => usernameSuggestions(message),
  "fewercunts-search:members": message => memberRecords(message.revealHidden),
  "fewercunts-search:unanswered-branches": message => unansweredRecords(message.username, message.revealHidden),
  "fewercunts-search:unloved": message => unlovedList(message),
  "fewercunts-search:threads-by-user": message => authorRecords(message, "t"),
  "fewercunts-search:replies-by-user": message => authorRecords(message, "r"),
  "fewercunts-search:backfill": async message => {
    const value = await visibilitySettings(message.revealHidden);
    return repository.backfillThreads(message.seed, message.count, message.excludeIds,
      value.blockedUsernames, value.mutedThreadIds, value.revealHidden);
  },
  "fewercunts-search:unread-summary": message => refreshReadState(message.revealHidden),
  "fewercunts-search:unread": message => unreadList(message.offset, message.limit, message.revealHidden),
  "fewercunts-search:mark-read": message => markRead(message),
  "fewercunts-search:mark-all-unread": message => message.confirmed === true
    ? refreshReadState(false).then(summary => summary.threads.length
      ? readState.markAllUnread([...summary.unreadDocKeys, ...summary.readDocKeys]) : { ...summary, marked: 0 })
    : Promise.reject(new Error("Mark forum unread requires confirmation")),
  "fewercunts-search:saved-ids": () => savedThreads.ids(),
  "fewercunts-search:saved": message => savedList(message.offset, message.limit, message.revealHidden),
  "fewercunts-search:save-toggle": message => savedThreads.toggle(message.thread),
  "fewercunts-search:save-remove": message => savedThreads.remove(message.threadId),
  "fewercunts-search:saved-clear": () => savedThreads.clear(),
  "fewercunts-search:saved-export": () => savedThreads.exportRecords(),
  "fewercunts-search:notification-settings": message => message.settings
    ? configureNotifications(message.settings) : notifications.settings(),
  "fewercunts-search:notifications": message => notificationList(message.revealHidden),
  "fewercunts-search:notification-update": message => notifications.update(message.docKey, message.changes)
    .then(() => notificationList(message.revealHidden)),
  "fewercunts-search:block-list": () => blockList.get(),
  "fewercunts-search:block-list-set": message => blockList.set(message.usernames),
  "fewercunts-search:block-list-reset": () => blockList.reset(),
  "fewercunts-search:muted-ids": () => mutedThreads.ids(),
  "fewercunts-search:muted": message => mutedThreads.list(message.offset, message.limit),
  "fewercunts-search:mute-toggle": message => mutedThreads.toggle(message.thread),
  "fewercunts-search:mute-remove": message => mutedThreads.remove(message.threadId),
  "fewercunts-search:muted-clear": () => mutedThreads.clear(),
  "fewercunts-search:categories-get": message => categories.get(message.items),
  "fewercunts-search:category-set": message => categories.set(message.docKey, message.threadId, message.categoryId),
  "fewercunts-search:category-inherit": message => categories.inherit(message.docKey, message.threadId),
  "fewercunts-search:maintain": () => {
    migration.run().then(() => maintainDelta()).catch(error => console.warn("fewerCunts compact migration paused:", error));
    return maintainIndex();
  },
  "fewercunts-search:navigation-target": message => visibleNavigationTarget(message.docKey, message.revealHidden),
  "fewercunts-search:compact-install": message => maintainCompact({ checkRemote: true, force: Boolean(message.force) }),
  "fewercunts-search:compact-status": () => compactManager.startup()
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = searchRouter(message);
  if (!operation) return false;
  const response = operation.then(value => ({ ok: true, value }),
    error => ({ ok: false, error: String(error.message || error) }));
  if (typeof browser !== "undefined") return response;
  response.then(sendResponse);
  return true;
});
