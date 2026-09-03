(function () {
  "use strict";

  const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  let blockedUsernames = globalThis.FewerCuntsBlockList.defaults();
  let blockedKeys = new Set(blockedUsernames.map(globalThis.FewerCuntsBlockList.normalise));
  let mutedIds = new Set();
  let revealHidden = false;
  const BLOCK_LIST_EVENT = "fewercunts:block-list-updated";
  const VISIBILITY_EVENT = "fewercunts:visibility-updated";
  const NAVIGATE_EVENT = "fewercunts:navigate-to-post";
  const NAVIGATE_RESULT_EVENT = "fewercunts:navigate-to-post-result";
  const BACKFILL_EVENT = "fewercunts:blocked-thread-backfill";
  const BACKFILL_RESULT_EVENT = "fewercunts:blocked-thread-backfill-result";
  const CLASSIC_EVENT = "fewercunts:classic-page-request";
  const CLASSIC_RESULT_EVENT = "fewercunts:classic-page-result";
  const CLASSIC_READY_EVENT = "fewercunts:classic-page-ready";
  const PRESENTED_EVENT = "fewercunts:presented-posts";
  const PLUGIN_VIEW_READY_EVENT = "fewercunts:plugin-view-ready";
  const IDENTITY_EVENT = "fewercunts:forum-identity";
  const IDENTITY_REQUEST_EVENT = "fewercunts:forum-identity-request";
  const DEVELOPER_POLICY_EVENT = "fewercunts:developer-reply-policy";
  const DEVELOPER_POLICY_REQUEST_EVENT = "fewercunts:developer-reply-policy-request";
  const HOME_EVENT = "fewercunts:home-request";
  const { normaliseSearchResponse } = globalThis.FewerCuntsSearchResponse;
  let forumUsername = "";
  const unwrap = response => {
    if (!response || !response.ok) throw new Error(response && response.error || "Search worker unavailable");
    return response.value;
  };
  const sendOnce = message => {
    return new Promise((resolve, reject) => {
      let settled = false;
      const receive = response => {
        if (settled) return;
        settled = true;
        const error = api.runtime.lastError;
        if (error) return reject(error);
        try { resolve(unwrap(response)); } catch (failure) { reject(failure); }
      };
      try {
        const result = api.runtime.sendMessage(message, receive);
        if (result?.then) result.then(receive, reject);
      } catch (_callbackUnsupported) {
        api.runtime.sendMessage(message).then(receive, reject);
      }
    });
  };
  const send = (message, attempt = 0) => sendOnce({ ...message, revealHidden }).catch(error => {
    const transient = /receiving end does not exist|message port closed before a response/i.test(String(error && error.message || error));
    if (!transient || attempt >= 100) throw error;
    return new Promise(resolve => setTimeout(resolve, 100)).then(() => send(message, attempt + 1));
  });

  async function publishDeveloperReplyPolicy() {
    let value;
    try { value = await send({ type: "fewercunts-search:developer-reply-policy" }); }
    catch (error) { value = { ready: false, title: null, message: String(error.message || error) }; }
    document.dispatchEvent(new CustomEvent(DEVELOPER_POLICY_EVENT, { detail: JSON.stringify(value) }));
  }
  document.addEventListener(DEVELOPER_POLICY_REQUEST_EVENT, () => { publishDeveloperReplyPolicy(); });

  document.addEventListener(BACKFILL_EVENT, async event => {
    let detail;
    try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    if (!detail || typeof detail.requestId !== "string" || !Number.isSafeInteger(detail.count) || detail.count < 1) return;
    let selected = [];
    try {
      selected = await send({ type: "fewercunts-search:backfill", seed: String(detail.seed || ""),
        count: detail.count, excludeIds: detail.excludeIds });
      if (!Array.isArray(selected)) selected = [];
    } catch (_error) {
      // An incomplete/disabled local index must never trigger a forum request.
    }
    document.dispatchEvent(new CustomEvent(BACKFILL_RESULT_EVENT, {
      detail: JSON.stringify({ requestId: detail.requestId, threads: selected })
    }));
  });

  document.addEventListener(CLASSIC_EVENT, async event => {
    let detail; try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    if (!detail || typeof detail.requestId !== "string") return;
    try {
      const value = await send({ type: "fewercunts-search:classic", offset: detail.offset,
        limit: detail.limit, sortOrder: detail.sortOrder });
      document.dispatchEvent(new CustomEvent(CLASSIC_RESULT_EVENT, {
        detail: JSON.stringify({ requestId: detail.requestId, ok: true, value })
      }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent(CLASSIC_RESULT_EVENT, {
        detail: JSON.stringify({ requestId: detail.requestId, ok: false, error: String(error.message || error) })
      }));
    }
  });
  document.dispatchEvent(new CustomEvent(CLASSIC_READY_EVENT));

  document.addEventListener(PRESENTED_EVENT, event => {
    let detail; try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    if (!Array.isArray(detail.docKeys) || !detail.docKeys.length) return;
    send({ type: "fewercunts-search:mark-read", docKeys: detail.docKeys,
      visibleDocKeys: Array.isArray(detail.visibleDocKeys) ? detail.visibleDocKeys : detail.docKeys }).catch(() => {});
  });

  document.addEventListener(IDENTITY_EVENT, event => {
    let detail; try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    forumUsername = String(detail.username || "").trim();
  });
  document.dispatchEvent(new CustomEvent(IDENTITY_REQUEST_EVENT));

  const { bytes, element, linkedText, statusPanel } = globalThis.FewerCuntsUiElements;

  function attach() {
    const input = document.querySelector("#theforum input.search-bar");
    const rightSide = input && input.closest(".forum-right-side");
    if (!input || !rightSide || input.dataset.fewercuntsSearch) return false;
    input.dataset.fewercuntsSearch = "true";
    input.dataset.fewercuntsBuild = api.runtime.getManifest().version;
    input.placeholder = "Search the forum";
    input.setAttribute("aria-label", "Search every indexed forum post");
    input.title = "Whole words by default. Use quotes, * prefixes, user:, title:, body:, email:, or category:\"Sports › Football\".";

    const form = element("form", "fewercunts-search-form");
    form.setAttribute("role", "search");
    form.hidden = true;
    input.parentNode.insertBefore(form, input);
    form.appendChild(input);
    const submitControl = element("button", "fewercunts-search-submit", "Search");
    submitControl.type = "submit";
    form.appendChild(submitControl);
    const scopeControls = element("span", "fewercunts-search-scopes");
    const scopes = new Map();
    for (const [scope, label] of [["user", "User"], ["post", "Post"], ["replies", "Replies"]]) {
      const control = element("button", "fewercunts-scope-button link-text", label);
      control.type = "button";
      control.dataset.scope = scope;
      control.setAttribute("aria-pressed", "true");
      control.title = `Include ${label.toLowerCase()} matches`;
      control.addEventListener("click", () => {
        const selected = control.getAttribute("aria-pressed") !== "true";
        control.setAttribute("aria-pressed", String(selected));
        control.classList.toggle("fewercunts-scope-disabled", !selected);
      });
      scopes.set(scope, control);
      scopeControls.appendChild(control);
    }
    form.appendChild(scopeControls);
    const recentPanel = element("section", "fewercunts-recent-searches");
    recentPanel.hidden = true;
    recentPanel.setAttribute("aria-label", "Recent searches");
    form.appendChild(recentPanel);
    const indexControls = element("span", "fewercunts-index-controls");
    const pauseControl = element("button", "fewercunts-index-button link-text", "Pause index");
    pauseControl.type = "button";
    const clearControl = element("button", "fewercunts-index-button link-text", "Clear index");
    clearControl.type = "button";
    const clearViewStateControl = element("button", "fewercunts-index-button link-text", "Clear view state");
    clearViewStateControl.type = "button";
    const updateControl = element("button", "fewercunts-index-button link-text", "Update now");
    updateControl.type = "button";
    const autoUpdate = element("input", "fewercunts-auto-update");
    autoUpdate.type = "checkbox";
    autoUpdate.id = "fewercunts-auto-update";
    const autoUpdateLabel = element("label", "fewercunts-auto-update-label", "Auto-update");
    autoUpdateLabel.htmlFor = autoUpdate.id;
    const refreshInterval = element("select", "fewercunts-refresh-interval");
    refreshInterval.setAttribute("aria-label", "Automatic update interval");
    for (const [minutes, label] of [[15, "15 min"], [60, "hourly"], [1440, "daily"]]) {
      const option = element("option", "", label);
      option.value = String(minutes);
      refreshInterval.appendChild(option);
    }
    const storageStatus = element("span", "fewercunts-storage-status");
    storageStatus.setAttribute("aria-live", "polite");
    indexControls.append(pauseControl, document.createTextNode(" | "), updateControl, document.createTextNode(" | "), clearControl, document.createTextNode(" | "), clearViewStateControl, document.createTextNode(" | "), autoUpdate, autoUpdateLabel, refreshInterval, storageStatus);
    form.appendChild(indexControls);
    const nativeThreads = rightSide.children[1];
    nativeThreads.classList.add("fewercunts-native-threads");
    const results = element("section", "fewercunts-search-results");
    results.hidden = true;
    results.tabIndex = -1;
    results.setAttribute("aria-label", "Forum search results");
    rightSide.appendChild(results);
    let progressTimer = null;
    let progressPolls = 0;
    let searchRevision = 0;
    const rowsApi = globalThis.NtForumPagination;
    let PAGE_SIZE = typeof rowsApi.storedRows() === "number" ? rowsApi.storedRows() : 25;
    let activeRows = null;
    let rowsSlot = null;
    let nativeRowsElement = null;
    let unreadSummary = { total: 0, threads: [], unreadDocKeys: [] };
    let savedIds = new Set();
    let viewMenu = null;
    let revealStatus = null;
    const recentApi = globalThis.FewerCuntsRecentSearches;

    function isBlockedUsername(value) {
      return !revealHidden && blockedKeys.has(globalThis.FewerCuntsBlockList.normalise(value));
    }

    function isMutedThread(value) {
      return !revealHidden && mutedIds.has(Number(value));
    }

    function configuredHidden(item) {
      return blockedKeys.has(globalThis.FewerCuntsBlockList.normalise(item && item.username))
        || mutedIds.has(Number(item && item.threadId));
    }

    function publishVisibility() {
      document.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, { detail: JSON.stringify({
        usernames: blockedUsernames, mutedThreadIds: [...mutedIds], revealHidden
      }) }));
      if (revealStatus) {
        revealStatus.hidden = !revealHidden;
        revealStatus.textContent = revealHidden ? "Hidden content revealed" : "";
      }
    }

    function publishBlockList(value) {
      const next = globalThis.FewerCuntsBlockList.validate(value.usernames);
      const nextKeys = new Set(next.map(globalThis.FewerCuntsBlockList.normalise));
      const changed = nextKeys.size !== blockedKeys.size || [...nextKeys].some(key => !blockedKeys.has(key));
      blockedUsernames = next;
      blockedKeys = nextKeys;
      if (!changed) return;
      document.dispatchEvent(new CustomEvent(BLOCK_LIST_EVENT, {
        detail: JSON.stringify({ usernames: blockedUsernames })
      }));
      publishVisibility();
    }

    function applyScopes(values) {
      const wanted = new Set(values);
      for (const [scope, control] of scopes) {
        const selected = wanted.has(scope);
        control.setAttribute("aria-pressed", String(selected));
        control.classList.toggle("fewercunts-scope-disabled", !selected);
      }
    }

    function renderRecentSearches() {
      const values = recentApi.list(localStorage);
      recentPanel.replaceChildren();
      recentPanel.hidden = !values.length;
      if (!values.length) return;
      const label = element("span", "fewercunts-recent-label", "Recent:");
      const list = element("span", "fewercunts-recent-list");
      list.setAttribute("role", "list");
      for (const value of values) {
        const item = element("span", "fewercunts-recent-item"); item.setAttribute("role", "listitem");
        const run = element("button", "fewercunts-recent-run link-text", value.query); run.type = "button";
        run.title = `Search ${value.scopes.join(", ")}`;
        run.addEventListener("click", () => {
          input.value = value.query; applyScopes(value.scopes);
          history.pushState({}, "", routeUrl({ view: "search", q: value.query, scopes: value.scopes.join(","), page: 1 }));
          search(value.query, 1, false, true).catch(error => showStatus(`Search error: ${error.message}`, "error"));
        });
        const remove = element("button", "fewercunts-recent-remove", "×"); remove.type = "button";
        remove.setAttribute("aria-label", `Remove recent search ${value.query}`);
        remove.addEventListener("click", () => { recentApi.remove(localStorage, value.id); renderRecentSearches(); });
        item.append(run, remove); list.appendChild(item);
      }
      const clear = element("button", "fewercunts-recent-clear link-text", "Clear recent searches"); clear.type = "button";
      clear.addEventListener("click", () => { recentApi.clear(localStorage); renderRecentSearches(); input.focus(); });
      recentPanel.append(label, list, clear);
    }

    const routeUrl = globalThis.FewerCuntsUiRoute.routeUrl;

    function currentViewState(view, overrides = {}) {
      return globalThis.FewerCuntsUiRoute.currentViewState(location.hash, view, overrides);
    }

    const authorPageKey = globalThis.FewerCuntsUiRoute.authorPageKey;

    function authorRouteState(username, view, overrides = {}) {
      return globalThis.FewerCuntsUiRoute.authorRouteState(location.hash, username, view, overrides);
    }

    function authorPageFromRoute(params, view) {
      return globalThis.FewerCuntsUiRoute.authorPageFromRoute(params, view);
    }

    function addPagination(children, total, page, label, state, load, push = true) {
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (pages <= 1) return;
      const footer = element("div", "thread-footer row");
      const holder = element("div", "col-xs-12");
      const pageState = globalThis.NtForumPagination.createPageState({ page: () => page, pages: () => pages,
        onPage: target => { if (target !== page) load(target); },
        route: { mode: "hash-params", pageKey: state.pageKey || "page" },
        navigation: push ? "push" : "none", historyState: { fewercuntsView: state.view } });
      const pager = globalThis.NtForumPagination.create({ label, state: pageState });
      holder.appendChild(pager.element); footer.appendChild(holder); children.push(footer);
    }

    function addRows(children, page, label, load) {
      if (activeRows) activeRows.destroy();
      activeRows = rowsApi.createRows({ label, rows: () => PAGE_SIZE, container: results,
        rowSelector: ".fewercunts-result, .fewercunts-unloved-thread, .fewercunts-author-thread, .fewercunts-saved-thread",
        maximum: 50, onRows(next, previous) {
          if (next === PAGE_SIZE) return;
          PAGE_SIZE = next;
          const target = rowsApi.pageForAnchor(page, previous, next);
          return load(target, true);
        } });
      activeRows.element.classList.add("fewercunts-top-nav");
      if (rowsSlot) rowsSlot.replaceChildren(activeRows.element);
    }

    function progressText(response, status, query) {
      const items = response.items || [];
      if (status.phase === "complete") {
        const count = Number(response.total) || 0;
        return `${response.truncated ? "At least " : ""}${count.toLocaleString()} result${count === 1 ? "" : "s"} for “${query}”`;
      }
      const completed = status.completed || 0;
      const processed = completed + (status.skipped || 0);
      const total = status.totalThreads || status.catalogued || status.discovered || 0;
      return `${items.length} current result${items.length === 1 ? "" : "s"}; ${completed} searchable threads indexed; ${processed} of ${total} forum threads checked`;
    }

    async function refreshControls() {
      const [status, stats, update, settings] = await Promise.all([
        send({ type: "fewercunts-search:status" }),
        send({ type: "fewercunts-search:stats" }),
        send({ type: "fewercunts-search:update-status" }),
        send({ type: "fewercunts-search:settings" })
      ]);
      pauseControl.textContent = status.phase === "paused" || status.phase === "disabled" ? "Resume index" : "Pause index";
      pauseControl.dataset.phase = status.phase;
      autoUpdate.checked = settings.enabled;
      refreshInterval.value = String(settings.refreshMinutes);
      refreshInterval.disabled = !settings.enabled;
      const updated = update.lastSuccessUtc ? `; updated ${new Date(update.lastSuccessUtc).toLocaleString()}` : "; not yet updated";
      const storageBytes = Number.isFinite(stats.indexBytes) ? stats.indexBytes : stats.usage;
      storageStatus.textContent = ` — ${stats.documents.toLocaleString()} posts, ${stats.threads.toLocaleString()} threads, ${bytes(storageBytes)} index${updated}`;
      if (Number.isFinite(stats.originUsage) && stats.originUsage > storageBytes) {
        storageStatus.title = `${bytes(stats.originUsage)} total extension storage is in use; the search index itself is ${bytes(storageBytes)}.`;
      } else storageStatus.removeAttribute("title");
    }

    function selectedScopes() {
      return Array.from(scopes).filter(([, control]) => control.getAttribute("aria-pressed") === "true")
        .map(([scope]) => scope);
    }

    function stopProgress() {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      progressPolls = 0;
    }

    function showNative() {
      searchRevision += 1;
      stopProgress();
      closeSearch();
      if (activeRows) { activeRows.destroy(); activeRows = null; }
      if (rowsSlot && nativeRowsElement) rowsSlot.replaceChildren(nativeRowsElement);
      results.hidden = true;
      delete results.dataset.state;
      results.removeAttribute("aria-busy");
      nativeThreads.hidden = false;
      results.replaceChildren();
      if (viewMenu) {
        viewMenu.directAction = null; viewMenu.trigger.textContent = "View";
        viewMenu.trigger.setAttribute("aria-haspopup", "menu"); viewMenu.popup.hidden = true;
      }
    }

    function showStatus(text, state = "loading", status = null) {
      rightSide.scrollTop = 0;
      nativeThreads.hidden = true;
      results.hidden = false;
      results.dataset.state = state;
      results.setAttribute("aria-busy", String(state === "loading"));
      results.replaceChildren(statusPanel(state, text, status));
    }

    function authorControl(username) {
      const control = element("button", "fewercunts-author-link link-text", username);
      control.type = "button";
      control.dataset.fewercuntsAuthor = username;
      return control;
    }

    function archivedThread(item) {
      return Boolean(item && (item.archived === true
        || globalThis.NtForumArchiveEngine.isArchivedReplyCount(item.replyCount)));
    }

    function archivedLabel() {
      const label = element("span", "fewercunts-result-archived fewercunts-archived", "Archived");
      label.setAttribute("aria-label", "Thread archived; replies are closed");
      return label;
    }

    function viewOnlyLabel() {
      const label = element("span", "fewercunts-result-archived fewercunts-archived", "View only");
      label.setAttribute("aria-label", "Hidden content is temporarily view only");
      return label;
    }

    async function navigateToPost(payload, reply = false) {
      stopProgress();
      const requestId = crypto.randomUUID();
      const completion = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          document.removeEventListener(NAVIGATE_RESULT_EVENT, receive);
          reject(new Error("The forum took too long to open that post"));
        }, 12000);
        function receive(event) {
          let detail;
          try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
          if (detail.requestId !== requestId) return;
          clearTimeout(timer);
          document.removeEventListener(NAVIGATE_RESULT_EVENT, receive);
          if (detail.ok) resolve();
          else reject(new Error(detail.error || "The post could not be opened"));
        }
        document.addEventListener(NAVIGATE_RESULT_EVENT, receive);
      });
      showNative();
      document.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, {
        detail: JSON.stringify({ ...payload, requestId, reply: Boolean(reply) })
      }));
      await completion;
    }

    async function openResult(item, reply, snapshotScrollY = window.scrollY) {
      if (isBlockedUsername(item.username)) throw new Error("That post is blocked");
      if (isMutedThread(item.threadId)) throw new Error("That thread is muted");
      if (reply && (archivedThread(item) || configuredHidden(item))) reply = false;
      const payload = await send({ type: "fewercunts-search:navigation-target", docKey: item.docKey });
      const resultNodes = Array.from(results.querySelectorAll("[data-fewercunts-doc-key]"));
      const resultNode = resultNodes.find(node => node.dataset.fewercuntsDocKey === item.docKey);
      const snapshot = globalThis.FewerCuntsNavigationState.capture({ storage: localStorage, history, location,
        scrollY: snapshotScrollY, resultKey: item.docKey, resultIndex: Math.max(0, resultNodes.indexOf(resultNode)) });
      if (snapshot) history.pushState({ fewercuntsThread: true }, "", item.canonicalUrl);
      const highlightTerms = reply ? [] : globalThis.FewerCuntsNavigationHighlight.termsFromQuery(input.value);
      try {
        await navigateToPost({ ...payload, highlightTerms }, reply);
      } catch (error) {
        if (snapshot) history.replaceState({ fewercuntsRestoreKey: snapshot.key }, "", snapshot.url);
        throw error;
      }
    }

    async function markRead(message) {
      unreadSummary = await send({ type: "fewercunts-search:mark-read", ...message });
      decorateUnread();
      return unreadSummary;
    }

    function unreadBadge(count) {
      const badge = element("span", "fewercunts-unread-badge", `${count} unread`);
      badge.setAttribute("aria-label", `${count} unread ${count === 1 ? "item" : "items"}`);
      return badge;
    }

    function decorateUnread() {
      const unreadDocuments = new Set(unreadSummary.unreadDocKeys || []);
      const readDocuments = new Set(unreadSummary.readDocKeys || []);
      const unreadThreads = new Map((unreadSummary.threads || []).map(value => [Number(value.threadId), value.unreadCount]));
      const knownThreads = new Set((unreadSummary.threads || []).map(value => Number(value.threadId)));
      for (const node of forum.querySelectorAll("[data-fewercunts-doc-key], a[href*='/thread/']")) {
        const match = String(node.getAttribute("href") || "").match(/\/thread\/(\d+)(?:\/reply\/(\d+))?/);
        const threadId = Number(node.dataset.fewercuntsThreadId || match?.[1]);
        const docKey = node.dataset.fewercuntsDocKey || (match?.[2] ? `r:${match[2]}` : (match?.[1] ? `t:${match[1]}` : ""));
        const isReplyLink = Boolean(match?.[2] || String(docKey).startsWith("r:"));
        let count = isReplyLink ? Number(unreadDocuments.has(docKey)) : Number(unreadThreads.get(threadId) || 0);
        if (unreadSummary.allUnread) count = isReplyLink ? Number(!readDocuments.has(docKey))
          : Number(!knownThreads.has(threadId) || (unreadThreads.get(threadId) || 0) > 0);
        if (isMutedThread(threadId)) count = 0;
        node.classList.toggle("fewercunts-unread", count > 0);
        node.setAttribute("aria-label", count > 0 ? `${node.textContent.trim()}, ${count} unread` : node.textContent.trim());
      }
      if (viewMenu?.trigger && viewMenu.trigger.textContent === "View") {
        viewMenu.trigger.dataset.unreadCount = String(unreadSummary.total || 0);
        viewMenu.trigger.setAttribute("aria-label", unreadSummary.allUnread
          ? "View; forum marked unread" : `View; ${unreadSummary.total || 0} unread`);
      }
    }

    async function refreshUnread() {
      unreadSummary = await send({ type: "fewercunts-search:unread-summary" }); decorateUnread(); return unreadSummary;
    }

    function savedThreadFromLink(link) {
      const match = String(link.getAttribute("href") || "").match(/\/thread\/(\d+)/);
      if (!match) return null;
      const threadId = Number(match[1]);
      const row = link.closest(".thread-header, .fewercunts-result, .post-container");
      const username = row?.querySelector("[data-fewercunts-author], .col-xs-2 .thread-header-text, .post-author")?.textContent?.trim() || "";
      return { threadId, title: link.textContent.trim() || "Untitled thread", username,
        canonicalUrl: `https://ntforum.net/thread/${threadId}` };
    }

    function updateSavedControls() {
      for (const control of forum.querySelectorAll(".fewercunts-save-thread")) {
        const saved = savedIds.has(Number(control.dataset.threadId));
        const text = "S";
        const pressed = String(saved); const label = `${saved ? "Remove from" : "Add to"} saved threads`;
        if (control.textContent !== text) control.textContent = text;
        control.dataset.actionLabel = saved ? "Unsave" : "Save";
        if (control.getAttribute("aria-pressed") !== pressed) control.setAttribute("aria-pressed", pressed);
        if (control.getAttribute("aria-label") !== label) control.setAttribute("aria-label", label);
      }
    }

    function decorateSaved() {
      for (const link of forum.querySelectorAll(".thread-header a[href*='/thread/'], .post-title > a[href*='/thread/']")) {
        const thread = savedThreadFromLink(link);
        if (!thread || link.parentElement?.querySelector(`.fewercunts-save-thread[data-thread-id="${thread.threadId}"]`)) continue;
        link.parentElement.classList.add("fewercunts-thread-title-cell");
        const saveControl = element("button", "fewercunts-save-thread fewercunts-unread-action link-text", "S");
        saveControl.type = "button"; saveControl.dataset.threadId = String(thread.threadId);
        saveControl.addEventListener("click", async event => {
          event.preventDefault(); event.stopPropagation();
          const response = await send({ type: "fewercunts-search:save-toggle", thread });
          savedIds = new Set(response.ids.map(Number)); updateSavedControls();
        });
        const actions = element("span", "fewercunts-thread-actions");
        actions.appendChild(saveControl);
        if (!link.closest(".fewercunts-muted-thread")) {
          const muteControl = element("button", "fewercunts-mute-thread fewercunts-unread-action link-text", "M");
          muteControl.type = "button"; muteControl.dataset.threadId = String(thread.threadId);
          muteControl.addEventListener("click", async event => {
            event.preventDefault(); event.stopPropagation();
            const response = await send({ type: "fewercunts-search:mute-toggle", thread });
            mutedIds = new Set(response.ids.map(Number)); publishVisibility(); updateMuteControls();
          });
          actions.appendChild(muteControl);
        }
        link.parentNode.insertBefore(actions, link.nextSibling);
      }
      updateSavedControls();
    }

    async function refreshSaved() {
      savedIds = new Set((await send({ type: "fewercunts-search:saved-ids" })).map(Number)); decorateSaved();
      return savedIds;
    }

    function updateMuteControls() {
      for (const control of forum.querySelectorAll(".fewercunts-mute-thread")) {
        const muted = mutedIds.has(Number(control.dataset.threadId));
        const text = "M"; const pressed = String(muted);
        const label = `${muted ? "Unmute" : "Mute"} this thread`;
        if (control.textContent !== text) control.textContent = text;
        control.dataset.actionLabel = muted ? "Unmute" : "Mute";
        if (control.getAttribute("aria-pressed") !== pressed) control.setAttribute("aria-pressed", pressed);
        if (control.getAttribute("aria-label") !== label) control.setAttribute("aria-label", label);
      }
    }

    async function refreshMuted() {
      mutedIds = new Set((await send({ type: "fewercunts-search:muted-ids" })).map(Number));
      publishVisibility(); updateMuteControls(); return mutedIds;
    }

    function showHome(push = false) {
      stopProgress();
      showNative();
      if (push) history.pushState({ fewercuntsPage: 1 }, "", "/");
      else history.replaceState({ fewercuntsPage: 1 }, "", "/");
      threadsControl && threadsControl.click();
      if (push) document.dispatchEvent(new CustomEvent(HOME_EVENT));
    }

    function showAbout(section) {
      closeSearch(); stopProgress(); searchRevision += 1;
      if (activeRows) { activeRows.destroy(); activeRows = null; }
      if (rowsSlot && nativeRowsElement) rowsSlot.replaceChildren(nativeRowsElement);
      nativeThreads.hidden = true; results.hidden = false;
      results.dataset.state = "results"; results.setAttribute("aria-busy", "false");
      const readme = section !== "history";
      const children = [element("h2", "fewercunts-results-heading", readme ? "About fewerCunts" : "Version history")];
      if (readme) {
        const lead = element("p", "fewercunts-about-version", `Installed version ${api.runtime.getManifest().version}`);
        children.push(lead);
        for (const entry of globalThis.FewerCuntsAbout.README) {
          const block = element("section", "fewercunts-about-section");
          block.appendChild(element("h3", "fewercunts-about-heading", entry.heading));
          for (const paragraph of entry.paragraphs) block.appendChild(element("p", "fewercunts-about-copy", paragraph));
          children.push(block);
        }
      } else {
        const list = element("ol", "fewercunts-version-history");
        for (const [version, date, note] of globalThis.FewerCuntsAbout.HISTORY) {
          const item = element("li", "fewercunts-version-entry");
          const heading = element("h3", "fewercunts-version-heading", `${version} — ${date}`);
          item.append(heading, element("p", "fewercunts-about-copy", note)); list.appendChild(item);
        }
        children.push(list);
      }
      results.replaceChildren(...children); results.focus({ preventScroll: true });
    }

    async function showAuthor(username, view = "posts", page = 1, push = false) {
      if (isBlockedUsername(username)) return showNative();
      closeSearch();
      stopProgress();
      const repliesView = view === "replies";
      showStatus(`Loading ${repliesView ? "replies from" : "posts started by"} ${username}…`, "loading");
      const offset = (page - 1) * PAGE_SIZE;
      const response = await send({
        type: repliesView ? "fewercunts-search:replies-by-user" : "fewercunts-search:threads-by-user",
        username, offset, limit: PAGE_SIZE
      });
      const totalPages = Math.max(1, Math.ceil(response.total / PAGE_SIZE));
      const pageKey = authorPageKey(view);
      if (page > totalPages) {
        history.replaceState({}, "", routeUrl(authorRouteState(username, view, { [pageKey]: null })));
        return showAuthor(username, view, 1);
      }
      nativeThreads.hidden = true;
      results.hidden = false;
      input.value = `user:"${username}"`;
      results.dataset.state = response.total ? "results" : "empty";
      results.setAttribute("aria-busy", "false");
      const noun = repliesView ? "repl" : "post";
      const children = [statusPanel(response.total ? "results" : "empty", `${response.total} indexed ${noun}${response.total === 1 ? (repliesView ? "y" : "") : (repliesView ? "ies" : "s")} ${repliesView ? "from" : "started by"} ${username}`)];
      addRows(children, page, `Rows per page for ${repliesView ? "author replies" : "author posts"}`,
        (target, replace) => {
          if (replace) history.replaceState({}, "", routeUrl(authorRouteState(username, view, { [pageKey]: target })));
          return showAuthor(username, view, target);
        });
      const tabs = element("div", "fewercunts-author-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", `Activity by ${username}`);
      for (const [tabView, label] of [["posts", "Posts"], ["replies", "Replies"]]) {
        const tab = element("button", "fewercunts-author-tab link-text", label);
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(view === tabView));
        tab.tabIndex = view === tabView ? 0 : -1;
        tab.addEventListener("click", () => {
          const state = authorRouteState(username, tabView);
          const target = authorPageFromRoute(new URLSearchParams(routeUrl(state).split("#")[1]), tabView);
          history.pushState({}, "", routeUrl(state)); showAuthor(username, tabView, target);
        });
        tab.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const destination = event.key === "ArrowLeft" || event.key === "Home" ? "posts" : "replies";
          const state = authorRouteState(username, destination);
          const target = authorPageFromRoute(new URLSearchParams(routeUrl(state).split("#")[1]), destination);
          history.pushState({}, "", routeUrl(state));
          showAuthor(username, destination, target).then(() => {
            const selected = results.querySelector('.fewercunts-author-tab[aria-selected="true"]');
            if (selected) selected.focus();
          }).catch(error => showStatus(`Author view error: ${error.message}`, "error"));
        });
        tabs.appendChild(tab);
      }
      children.push(tabs);
      if (repliesView) {
        for (const item of response.items) {
          const article = element("article", "post fewercunts-result fewercunts-author-reply");
          const heading = element("div", "post-title");
          const title = element("a", "link-text", item.title || "Untitled post");
          title.dataset.fewercuntsDocKey = item.docKey; title.dataset.fewercuntsThreadId = String(item.threadId);
          title.href = item.canonicalUrl;
          title.addEventListener("click", event => {
            event.preventDefault();
            openResult(item, false).catch(error => showStatus(`Visit error: ${error.message}`, "error"));
          });
          heading.append(title, document.createTextNode(` — ${new Date(item.createdUtc).toLocaleString()}`));
          const body = element("div", "post-body");
          body.appendChild(linkedText("div", "post-message", item.snippet));
          const actions = element("div", "fewercunts-result-actions");
          if (archivedThread(item)) actions.appendChild(archivedLabel());
          else if (configuredHidden(item)) actions.appendChild(viewOnlyLabel());
          else {
            const reply = element("button", "fewercunts-result-reply link-text", "Reply");
            reply.type = "button";
            reply.addEventListener("click", () => openResult(item, true).catch(error => showStatus(`Reply error: ${error.message}`, "error")));
            actions.appendChild(reply);
          }
          body.appendChild(actions);
          article.append(heading, body);
          children.push(article);
        }
      } else {
        const header = element("div", "all-threads-header thread-underline-gold row fewercunts-author-header");
        for (const [classes, label] of [
          ["col-xs-1 no-wrap", "Size"], ["col-xs-6 no-wrap", "Subject"],
          ["col-xs-2 no-wrap", "From"], ["col-xs-2 col-xs-offset-1 no-wrap", "When"]
        ]) header.appendChild(element("div", classes, label));
        children.push(header);
        for (const item of response.items) {
          const row = element("div", "thread-header thread-underline row fewercunts-author-thread");
          const size = element("div", "col-xs-1 no-wrap", String(item.replyCount + 1));
          const subject = element("div", "col-xs-6");
          const title = element("a", "link-text", item.title || "Untitled post");
          title.dataset.fewercuntsDocKey = item.docKey; title.dataset.fewercuntsThreadId = String(item.threadId);
          title.href = item.canonicalUrl;
          title.addEventListener("click", event => {
            event.preventDefault();
            openResult(item, false).catch(error => showStatus(`Visit error: ${error.message}`, "error"));
          });
          subject.appendChild(title);
          const from = element("div", "col-xs-2");
          from.appendChild(authorControl(item.username));
          const when = element("div", "col-xs-2 col-xs-offset-1", new Date(item.lastPostUtc).toLocaleDateString());
          row.append(size, subject, from, when);
          children.push(row);
        }
      }
      addPagination(children, response.total, page, `${view === "replies" ? "Replies" : "Posts"} by ${username} pagination`,
        { view: "author", user: username, tab: view, pageKey }, target => showAuthor(username, view, target));
      results.replaceChildren(...children);
    }

    function render(query, response, status, activeScopes, page = 1, revision = searchRevision, resultKind = "t") {
      if (revision !== searchRevision) return;
      response = normaliseSearchResponse(response);
      const items = response.items;
      nativeThreads.hidden = true;
      results.hidden = false;
      const statusText = progressText(response, status, query);
      const state = items.length ? (status.phase === "complete" ? "results" : "progress") : (status.phase === "complete" ? "empty" : "progress");
      results.dataset.state = items.length ? "results" : state;
      results.setAttribute("aria-busy", "false");
      const label = resultKind === "r" ? "Replies" : "Posts";
      const route = target => ({ view: "search", q: query, scopes: activeScopes.join(","),
        tab: resultKind === "r" ? "replies" : null, page: target });
      const children = [statusPanel(state, items.length || status.phase !== "complete"
        ? `${label}: ${statusText}` : `No indexed ${label.toLowerCase()} matched “${query}”.`, status)];
      addRows(children, page, "Rows per page for search results", (target, replace) => {
        if (replace) history.replaceState({}, "", routeUrl(route(target)));
        return search(query, target, false, false, resultKind);
      });
      const tabs = element("div", "fewercunts-author-tabs fewercunts-search-tabs");
      tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", `Search results for ${query}`);
      for (const [kind, tabLabel] of [["t", "Posts"], ["r", "Replies"]]) {
        const tab = element("button", "fewercunts-author-tab link-text", tabLabel); tab.type = "button";
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(kind === resultKind));
        tab.tabIndex = kind === resultKind ? 0 : -1;
        const activate = (targetKind = kind, focus = false) => {
          history.pushState({}, "", routeUrl({ ...route(1), tab: targetKind === "r" ? "replies" : null }));
          search(query, 1, false, false, targetKind).then(() => {
            if (!focus) return;
            const selected = results.querySelector('.fewercunts-search-tabs [role="tab"][aria-selected="true"]');
            if (selected) selected.focus();
          }).catch(error => showStatus(`Search error: ${error.message}`, "error"));
        };
        tab.addEventListener("click", () => activate(kind));
        tab.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const destination = event.key === "ArrowLeft" || event.key === "Home" ? "t" : "r";
          activate(destination, true);
        });
        tabs.appendChild(tab);
      }
      children.push(tabs);
      const header = element("div", "all-threads-header thread-underline-gold row fewercunts-search-header");
      for (const [classes, heading] of [["col-xs-1 no-wrap", "Size"], ["col-xs-6 no-wrap", "Subject"],
        ["col-xs-2 no-wrap", "From"], ["col-xs-2 col-xs-offset-1 no-wrap", "When"]]) {
        header.appendChild(element("div", classes, heading));
      }
      children.push(header);
      for (const item of items) {
        const row = element("article", "thread-header thread-underline row fewercunts-result fewercunts-search-result-row");
        const size = element("div", "col-xs-1 no-wrap", item.kind === "t" ? String((Number(item.replyCount) || 0) + 1) : "R");
        if (item.kind === "r") size.setAttribute("aria-label", "Reply");
        const subject = element("div", "col-xs-6 fewercunts-search-result-subject");
        const link = element("a", "link-text", item.title || "Untitled post");
        link.dataset.fewercuntsDocKey = item.docKey; link.dataset.fewercuntsThreadId = String(item.threadId);
        link.href = item.canonicalUrl;
        link.addEventListener("pointerdown", () => { link.dataset.fewercuntsOriginScroll = String(window.scrollY); });
        link.addEventListener("click", event => {
          event.preventDefault();
          const originScroll = Number(link.dataset.fewercuntsOriginScroll);
          openResult(item, false, Number.isFinite(originScroll) ? originScroll : window.scrollY)
            .catch(error => showStatus(`Visit error: ${error.message}`, "error"));
        });
        subject.appendChild(link);
        if (item.kind === "r" && item.threadTitle && item.threadTitle !== item.title) {
          subject.appendChild(element("span", "fewercunts-search-thread-context", ` in ${item.threadTitle}`));
        }
        subject.appendChild(linkedText("div", "fewercunts-search-snippet", item.snippet));
        const actions = element("span", "fewercunts-result-actions");
        let reply;
        if (archivedThread(item)) reply = archivedLabel();
        else if (configuredHidden(item)) reply = viewOnlyLabel();
        else {
          reply = element("button", "link-text fewercunts-result-reply", "Reply");
          reply.type = "button";
          reply.addEventListener("click", async () => {
            reply.dataset.actionState = "opening";
            reply.disabled = true;
            reply.textContent = "Opening…";
            try {
              await openResult(item, true);
            } catch (error) {
              showStatus(`Reply error: ${error.message}`, "error");
            } finally {
              reply.disabled = false;
              reply.textContent = "Reply";
            }
          });
        }
        const visit = element("a", "link-text fewercunts-result-visit", "Visit");
        visit.href = item.canonicalUrl;
        visit.addEventListener("click", event => {
          event.preventDefault();
          openResult(item, false).catch(error => showStatus(`Visit error: ${error.message}`, "error"));
        });
        actions.append(document.createTextNode(" · "), reply, document.createTextNode(" · "), visit);
        subject.appendChild(actions);
        const from = element("div", "col-xs-2"); from.appendChild(authorControl(item.username));
        const when = element("div", "col-xs-2 col-xs-offset-1", new Date(item.createdUtc).toLocaleDateString());
        row.append(size, subject, from, when); children.push(row);
      }
      addPagination(children, response.total, page, "Search results pagination",
        { view: "search", q: query, scopes: activeScopes.join(","), tab: resultKind === "r" ? "replies" : null },
        target => search(query, target, false, false, resultKind));
      results.replaceChildren(...children);
      stopProgress();
      if (status.phase === "complete") refreshControls().catch(() => {});
      if (status.phase !== "complete") {
        const poll = async () => {
          if (results.hidden || revision !== searchRevision) return;
          try {
            const latest = await send({ type: "fewercunts-search:start" });
            if (revision !== searchRevision) return;
            progressPolls += 1;
            if (progressPolls % 5 === 0) {
              const latestItems = await send({ type: "fewercunts-search:query", query, offset: (page - 1) * PAGE_SIZE,
                limit: PAGE_SIZE, scopes: activeScopes, resultKind });
              if (revision === searchRevision) render(query, latestItems, latest, activeScopes, page, revision, resultKind);
              return;
            }
            const statusNode = results.querySelector(".fewercunts-search-status");
            if (statusNode) statusNode.firstChild.textContent = progressText(response, latest, query);
            if (latest.phase !== "complete") progressTimer = setTimeout(poll, 3000);
          } catch (error) {
            const statusNode = results.querySelector(".fewercunts-search-status");
            results.dataset.state = "error";
            if (statusNode) statusNode.replaceWith(statusPanel("error", `${progressText(response, status, query)}; update paused: ${error.message}`));
          }
        };
        progressTimer = setTimeout(poll, 3000);
      }
    }

    async function search(query, page = 1, push = false, remember = false, resultKind = "t") {
      if (!query) return showStatus("Enter a word or phrase to search the local forum index.", "empty");
      page = Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
      const revision = ++searchRevision;
      stopProgress();
      const activeScopes = selectedScopes();
      if (!activeScopes.length) return showStatus("Select User, Post or Replies before searching.", "error");
      let status = await send({ type: "fewercunts-search:status" });
      if (status.phase === "disabled") {
        const accepted = confirm("Enable private local forum search? This will gradually download and index public NTForum posts and author email addresses on this device. Addresses remain local, are never shown in ordinary results, and are searchable only with email:.");
        if (!accepted) return showNative();
        status = await send({ type: "fewercunts-search:start" });
      } else if (status.phase !== "complete") {
        status = await send({ type: "fewercunts-search:start" });
      }
      if (revision !== searchRevision) return;
      showStatus(`Searching ${status.completed || 0} indexed threads…`, "loading", status);
      await refreshControls();
      if (revision !== searchRevision) return;
      const response = await send({ type: "fewercunts-search:query", query, offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE, scopes: activeScopes, resultKind });
      if (revision !== searchRevision) return;
      if (remember) { recentApi.add(localStorage, query, activeScopes); renderRecentSearches(); }
      const totalPages = Math.max(1, Math.ceil(normaliseSearchResponse(response).total / PAGE_SIZE));
      if (page > totalPages) {
        history.replaceState({}, "", routeUrl({ view: "search", q: query, scopes: activeScopes.join(","),
          tab: resultKind === "r" ? "replies" : null, page: 1 }));
        return search(query, 1, false, false, resultKind);
      }
      status = await send({ type: "fewercunts-search:status" });
      if (revision !== searchRevision) return;
      render(query, response, status, activeScopes, page, revision, resultKind);
      await refreshControls();
      if (status.phase === "complete" && revision === searchRevision) send({ type: "fewercunts-search:update" }).then(update => {
        if (revision === searchRevision && !update.debounced && update.refreshed) search(query, page, false, false, resultKind);
      }).catch(error => {
        if (revision !== searchRevision) return;
        const statusNode = results.querySelector(".fewercunts-search-status");
        if (statusNode) statusNode.title = `The last complete index remains available. Freshness check paused: ${error.message}`;
      });
    }

    pauseControl.addEventListener("click", async () => {
      pauseControl.disabled = true;
      try {
        const resuming = pauseControl.dataset.phase === "paused" || pauseControl.dataset.phase === "disabled";
        if (!resuming) stopProgress();
        const status = await send({ type: resuming ? "fewercunts-search:start" : "fewercunts-search:pause" });
        pauseControl.dataset.phase = status.phase;
        pauseControl.textContent = status.phase === "paused" || status.phase === "disabled" ? "Resume index" : "Pause index";
        refreshControls().catch(error => { storageStatus.title = `Status refresh delayed: ${error.message}`; });
      } catch (error) {
        showStatus(`Index control error: ${error.message}`, "error");
      } finally { pauseControl.disabled = false; }
    });
    clearControl.addEventListener("click", async () => {
      if (!confirm("Clear the complete local forum index from this browser? This cannot be undone.")) return;
      clearControl.disabled = true;
      try {
        await send({ type: "fewercunts-search:clear" });
        input.value = "";
        showNative();
        await refreshControls();
      } catch (error) {
        showStatus(`Clear error: ${error.message}`, "error");
      } finally { clearControl.disabled = false; }
    });
    clearViewStateControl.addEventListener("click", () => {
      globalThis.FewerCuntsNavigationState.clear(localStorage);
      clearViewStateControl.textContent = "View state cleared";
      setTimeout(() => { clearViewStateControl.textContent = "Clear view state"; }, 2000);
    });
    updateControl.addEventListener("click", async () => {
      updateControl.disabled = true;
      try {
        const status = await send({ type: "fewercunts-search:status" });
        if (status.phase !== "complete") throw new Error("Finish the initial import before checking for updates");
        await send({ type: "fewercunts-search:update", force: true });
        await refreshControls();
        if (input.value.trim()) await search(input.value.trim());
      } catch (error) { showStatus(`Update error: ${error.message}`, "error"); }
      finally { updateControl.disabled = false; }
    });
    autoUpdate.addEventListener("change", async () => {
      await send({ type: "fewercunts-search:settings", settings: { enabled: autoUpdate.checked } });
      await refreshControls();
    });
    refreshInterval.addEventListener("change", async () => {
      await send({ type: "fewercunts-search:settings", settings: { refreshMinutes: Number(refreshInterval.value) } });
      await refreshControls();
    });

    form.addEventListener("submit", event => {
      event.preventDefault();
      history.pushState({}, "", routeUrl({ view: "search", q: input.value.trim(), scopes: selectedScopes().join(","),
        tab: null, page: 1 }));
      search(input.value.trim(), 1, false, true, "t").catch(error => showStatus(`Search error: ${error.message}`, "error"));
    });
    const toolbar = rightSide.querySelector(".top-toolbar");
    const toolbarLine = toolbar.querySelector(".col-xs-12");
    const threadsControl = toolbarLine.querySelector('[data-bind*="reloadThreads"]');
    const newTopicControl = toolbarLine.querySelector('[data-bind*="showNewThreadForm"]');
    const createAccountControl = toolbarLine.querySelector('[data-bind*="showNewAccountForm"]');
    const changePasswordControl = toolbarLine.querySelector('[data-bind*="showPasswordResetForm"]');
    const logoutControl = toolbarLine.querySelector('[data-bind*="click: logout"]');
    toolbarLine.classList.add("fewercunts-toolbar-line");

    async function saveBlockList(usernames, announcement) {
      const value = await send({ type: "fewercunts-search:block-list-set", usernames });
      publishBlockList(value);
      showBlockList(announcement);
    }

    function showBlockList(announcement = "") {
      closeSearch(); stopProgress(); nativeThreads.hidden = true; results.hidden = false;
      results.dataset.state = "results"; results.setAttribute("aria-busy", "false");
      const heading = element("h2", "fewercunts-results-heading", "Blocked users");
      const intro = element("p", "fewercunts-block-list-help", "Posts by these users and replies beneath them are hidden on this device.");
      const form = element("form", "fewercunts-block-list-form");
      const label = element("label", "fewercunts-block-list-label", "Username");
      const combobox = element("span", "fewercunts-block-list-combobox");
      const field = element("input", "fewercunts-block-list-input");
      field.type = "text"; field.maxLength = globalThis.FewerCuntsBlockList.MAX_USERNAME_LENGTH;
      field.autocomplete = "off"; field.setAttribute("role", "combobox");
      field.setAttribute("aria-autocomplete", "list"); field.setAttribute("aria-expanded", "false");
      const suggestions = element("ul", "fewercunts-block-list-suggestions");
      suggestions.id = `fewercunts-block-list-suggestions-${crypto.randomUUID()}`;
      suggestions.hidden = true; suggestions.setAttribute("role", "listbox");
      const suggestionStatus = element("span", "fewercunts-pagination-status");
      suggestionStatus.setAttribute("role", "status"); suggestionStatus.setAttribute("aria-live", "polite");
      field.setAttribute("aria-controls", suggestions.id); combobox.append(field, suggestions, suggestionStatus); label.appendChild(combobox);
      const add = element("button", "fewercunts-search-submit", "Add"); add.type = "submit";
      form.append(label, add);
      const list = element("ul", "fewercunts-block-list-items");
      for (const username of blockedUsernames) {
        const item = element("li", "fewercunts-block-list-item");
        const name = element("span", "fewercunts-block-list-name", username);
        const remove = element("button", "fewercunts-menu-item link-text", "Remove"); remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${username} from blocked users`);
        remove.addEventListener("click", () => saveBlockList(blockedUsernames.filter(value => globalThis.FewerCuntsBlockList.normalise(value) !== globalThis.FewerCuntsBlockList.normalise(username)), `${username} removed.`).catch(error => showStatus(`Block list error: ${error.message}`, "error")));
        item.append(name, remove); list.appendChild(item);
      }
      if (!blockedUsernames.length) list.appendChild(element("li", "fewercunts-block-list-empty", "No users are blocked."));
      const reset = element("button", "fewercunts-index-button link-text", "Reset defaults"); reset.type = "button";
      reset.addEventListener("click", async () => {
        const value = await send({ type: "fewercunts-search:block-list-reset" });
        publishBlockList(value); showBlockList("Default blocked users restored.");
      });
      const status = element("p", "fewercunts-block-list-status", announcement); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      let suggestionValues = []; let activeSuggestion = -1; let suggestionRevision = 0; let suggestionTimer = null;
      function closeSuggestions() {
        suggestions.hidden = true; suggestions.replaceChildren(); suggestionValues = []; activeSuggestion = -1;
        field.setAttribute("aria-expanded", "false"); field.removeAttribute("aria-activedescendant"); suggestionStatus.textContent = "";
      }
      function selectSuggestion(index) {
        if (index < 0 || index >= suggestionValues.length) return;
        field.value = suggestionValues[index]; closeSuggestions(); field.focus();
      }
      function activateSuggestion(index) {
        if (!suggestionValues.length) return;
        activeSuggestion = (index + suggestionValues.length) % suggestionValues.length;
        const options = [...suggestions.children];
        options.forEach((option, item) => option.setAttribute("aria-selected", String(item === activeSuggestion)));
        field.setAttribute("aria-activedescendant", options[activeSuggestion].id);
        options[activeSuggestion].scrollIntoView({ block: "nearest" });
      }
      async function updateSuggestions() {
        const revision = ++suggestionRevision; const query = field.value;
        if (!query.trim()) { closeSuggestions(); return; }
        let values;
        try { values = await send({ type: "fewercunts-search:usernames", query, limit: 20 }); }
        catch (_error) { values = []; }
        if (revision !== suggestionRevision || document.activeElement !== field || !Array.isArray(values)) return;
        suggestionValues = values; activeSuggestion = -1; suggestions.replaceChildren();
        for (const [index, username] of values.entries()) {
          const option = element("li", "fewercunts-block-list-suggestion", username);
          option.id = `${suggestions.id}-${index}`; option.setAttribute("role", "option"); option.setAttribute("aria-selected", "false");
          option.addEventListener("pointerdown", event => { event.preventDefault(); selectSuggestion(index); });
          suggestions.appendChild(option);
        }
        suggestions.hidden = !values.length; field.setAttribute("aria-expanded", String(Boolean(values.length)));
        suggestionStatus.textContent = values.length ? `${values.length} username suggestions available.` : "No matching usernames.";
      }
      field.addEventListener("input", () => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(updateSuggestions, 100); });
      field.addEventListener("focus", () => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(updateSuggestions, 0); });
      field.addEventListener("blur", () => setTimeout(() => { if (!combobox.contains(document.activeElement)) closeSuggestions(); }, 0));
      field.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" && suggestionValues.length) { event.preventDefault(); activateSuggestion(activeSuggestion + 1); }
        else if (event.key === "ArrowUp" && suggestionValues.length) { event.preventDefault(); activateSuggestion(activeSuggestion < 0 ? suggestionValues.length - 1 : activeSuggestion - 1); }
        else if (event.key === "Home" && suggestionValues.length) { event.preventDefault(); activateSuggestion(0); }
        else if (event.key === "End" && suggestionValues.length) { event.preventDefault(); activateSuggestion(suggestionValues.length - 1); }
        else if (event.key === "Enter" && activeSuggestion >= 0) { event.preventDefault(); selectSuggestion(activeSuggestion); }
        else if (event.key === "Escape") { event.preventDefault(); closeSuggestions(); }
      });
      form.addEventListener("submit", event => {
        event.preventDefault();
        let next;
        try { next = globalThis.FewerCuntsBlockList.validate([...blockedUsernames, field.value]); }
        catch (error) { status.textContent = error.message; field.focus(); return; }
        closeSuggestions(); saveBlockList(next, `${field.value.trim()} added.`).catch(error => { status.textContent = error.message; });
      });
      results.replaceChildren(heading, intro, form, list, reset, status);
      field.focus();
    }

    function menu(label, items) {
      const wrapper = element("span", "fewercunts-menu");
      const trigger = element("button", "fewercunts-top-nav link-text", label);
      trigger.type = "button"; trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-haspopup", "menu");
      const popup = element("span", "fewercunts-menu-popup"); popup.hidden = true; popup.setAttribute("role", "menu");
      for (const [itemLabel, action] of items) {
        const item = element("button", "fewercunts-menu-item link-text", itemLabel);
        item.type = "button"; item.setAttribute("role", "menuitem");
        item.addEventListener("click", () => {
          popup.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
          closeSearch();
          action();
        });
        popup.appendChild(item);
      }
      trigger.addEventListener("click", () => {
        if (wrapper.directAction) { wrapper.directAction(); return; }
        const opening = popup.hidden;
        document.querySelectorAll(".fewercunts-menu-popup").forEach(node => { node.hidden = true; });
        document.querySelectorAll(".fewercunts-menu > button").forEach(node => node.setAttribute("aria-expanded", "false"));
        popup.hidden = !opening; trigger.setAttribute("aria-expanded", String(opening));
        if (opening) {
          const top = popup.getBoundingClientRect().top;
          popup.style.maxHeight = `${Math.max(132, window.innerHeight - top - 8)}px`;
          popup.querySelector("button").focus();
        }
      });
      function menuItems() { return Array.from(popup.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')); }
      trigger.addEventListener("keydown", event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (popup.hidden) trigger.click();
        const controls = menuItems();
        const target = event.key === 'ArrowUp' || event.key === 'End' ? controls.at(-1) : controls[0];
        if (target) target.focus();
      });
      popup.addEventListener("keydown", event => {
        const controls = menuItems();
        const current = controls.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          popup.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus(); return;
        }
        if (event.key === "Tab") {
          popup.hidden = true; trigger.setAttribute("aria-expanded", "false"); return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
          : event.key === "ArrowDown" ? (current + 1) % controls.length : (current - 1 + controls.length) % controls.length;
        if (controls[next]) controls[next].focus();
      });
      wrapper.append(trigger, popup);
      wrapper.trigger = trigger; wrapper.popup = popup;
      return wrapper;
    }

    const settingsStatus = element("span", "fewercunts-settings-status");
    settingsStatus.setAttribute("role", "status"); settingsStatus.setAttribute("aria-live", "polite");
    try { localStorage.removeItem("fewercunts:theme:v1"); } catch (_error) {}
    const transfer = globalThis.FewerCuntsSettingsTransfer;
    const importInput = element("input", "fewercunts-settings-import");
    importInput.type = "file"; importInput.accept = "application/json,.json"; importInput.hidden = true;
    let userMenu;
    async function settingsSnapshot() {
      const [blockList, searchSettings, status, stats, update] = await Promise.all([
        send({ type: "fewercunts-search:block-list" }), send({ type: "fewercunts-search:settings" }),
        send({ type: "fewercunts-search:status" }), send({ type: "fewercunts-search:stats" }),
        send({ type: "fewercunts-search:update-status" })
      ]);
      return transfer.create({ blockedUsernames: blockList.usernames,
        pagination: { rows: globalThis.NtForumPagination.storedRows(), mode: globalThis.NtForumPagination.storedMode() },
        search: { autoUpdate: searchSettings.enabled, refreshMinutes: searchSettings.refreshMinutes,
          fullReconcileDays: searchSettings.fullReconcileDays, replyReconcileDays: searchSettings.replyReconcileDays } },
      { phase: String(status.phase || "unknown"), source: String(stats.source || "local"),
        generationId: stats.generationId == null ? null : String(stats.generationId),
        documents: Number(stats.documents) || 0, threads: Number(stats.threads) || 0,
        lastUpdatedUtc: update.lastSuccessUtc || null });
    }
    async function exportSettings() {
      const snapshot = await settingsSnapshot();
      const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob); const anchor = element("a");
      anchor.href = url; anchor.download = `fewercunts-settings-v${transfer.VERSION}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      settingsStatus.textContent = "Local settings exported. Private activity and index content were excluded.";
    }
    async function markForumUnread() {
      const current = await send({ type: "fewercunts-search:unread-summary" });
      const indexed = (current.threads || []).reduce((total, thread) => total + (Number(thread.totalCount) || 0), 0);
      if (!indexed) {
        settingsStatus.textContent = "No visible indexed forum activity is available to mark unread."; return;
      }
      if (!confirm(`Mark all ${indexed} currently indexed visible forum ${indexed === 1 ? "item" : "items"} unread?\n\nThis changes only fewerCunts' local read state. Browser history and NTForum are not changed.`)) {
        settingsStatus.textContent = "Mark forum unread cancelled."; return;
      }
      const result = await send({ type: "fewercunts-search:mark-all-unread", confirmed: true });
      unreadSummary = result; decorateUnread();
      settingsStatus.textContent = result.marked
        ? `${result.marked} indexed forum ${result.marked === 1 ? "item is" : "items are"} now unread.`
        : "No visible indexed forum activity was available to mark unread.";
    }
    async function applyImportedSettings(value) {
      const before = await settingsSnapshot(); const next = value.settings;
      try {
        globalThis.NtForumPagination.storeRows(next.pagination.rows);
        globalThis.NtForumPagination.storeMode(next.pagination.mode);
        await send({ type: "fewercunts-search:settings", settings: { enabled: next.search.autoUpdate,
          refreshMinutes: next.search.refreshMinutes, fullReconcileDays: next.search.fullReconcileDays,
          replyReconcileDays: next.search.replyReconcileDays } });
        const blockList = await send({ type: "fewercunts-search:block-list-set", usernames: next.blockedUsernames });
        publishBlockList(blockList);
      } catch (error) {
        const old = before.settings;
        globalThis.NtForumPagination.storeRows(old.pagination.rows);
        globalThis.NtForumPagination.storeMode(old.pagination.mode);
        await send({ type: "fewercunts-search:settings", settings: { enabled: old.search.autoUpdate,
          refreshMinutes: old.search.refreshMinutes, fullReconcileDays: old.search.fullReconcileDays,
          replyReconcileDays: old.search.replyReconcileDays } }).catch(() => {});
        await send({ type: "fewercunts-search:block-list-set", usernames: old.blockedUsernames })
          .then(publishBlockList).catch(() => {});
        throw error;
      }
      await refreshControls();
    }
    importInput.addEventListener("change", async () => {
      const file = importInput.files && importInput.files[0]; importInput.value = "";
      if (!file) return;
      try {
        if (file.size > transfer.MAX_BYTES) throw new Error("Settings file exceeds 64 KiB");
        const value = transfer.parse(await file.text());
        if (!confirm(`Import these local settings?\n\n${transfer.summary(value)}\n\nCurrent settings will be replaced; private activity and local index data will remain untouched.`)) {
          settingsStatus.textContent = "Settings import cancelled."; return;
        }
        await applyImportedSettings(value);
        settingsStatus.textContent = "Local settings imported. Index metadata was not applied.";
      } catch (error) { settingsStatus.textContent = `Settings import failed safely: ${error.message}`; }
    });
    userMenu = menu("User", [
      ["Create Account", () => createAccountControl && createAccountControl.click()],
      ["Change Password", () => changePasswordControl && changePasswordControl.click()],
      ["Block list", () => { history.pushState({}, "", routeUrl({ view: "block-list" })); showBlockList(); }],
      ["Notifications", () => { history.pushState({}, "", routeUrl({ view: "notifications", page: 1 }));
        showNotifications(1).catch(error => showStatus(`Notification error: ${error.message}`, "error")); }],
      ["Mark forum unread", () => markForumUnread().catch(error => {
        settingsStatus.textContent = `Mark forum unread failed safely: ${error.message}`;
      })],
      ["Export settings", () => exportSettings().catch(error => { settingsStatus.textContent = `Settings export failed: ${error.message}`; })],
      ["Import settings", () => importInput.click()],
      ["Logout", () => logoutControl && logoutControl.click()]
    ]);
    const homeControl = element("button", "fewercunts-top-nav link-text", "Home");
    homeControl.type = "button";
    homeControl.addEventListener("click", () => {
      closeSearch();
      showHome(true);
    });
    const newTopic = element("button", "fewercunts-top-nav link-text", "New Topic");
    newTopic.type = "button"; newTopic.addEventListener("click", () => {
      closeSearch();
      newTopicControl && newTopicControl.click();
    });
    const searchControl = element("button", "fewercunts-top-nav link-text", "Search");
    searchControl.type = "button";
    searchControl.setAttribute("aria-expanded", "false");
    searchControl.setAttribute("aria-controls", "fewercunts-search-controls");
    form.id = "fewercunts-search-controls";
    function closeSearch() {
      form.hidden = true;
      searchControl.setAttribute("aria-expanded", "false");
    }
    viewMenu = menu("View", [
      ["Classic", () => { history.replaceState(null, "", "/"); showNative(); threadsControl && threadsControl.click(); }],
      ["Unread", () => { history.pushState(null, "", routeUrl({ view: "unread", page: 1 })); showUnread().catch(error => showStatus(`Unread error: ${error.message}`, "error")); }],
      ["Saved", () => { history.pushState(null, "", routeUrl({ view: "saved", page: 1 })); showSaved().catch(error => showStatus(`Saved error: ${error.message}`, "error")); }],
      ["Muted", () => { history.pushState(null, "", routeUrl({ view: "muted", page: 1 })); showMuted().catch(error => showStatus(`Muted error: ${error.message}`, "error")); }],
      ["Unloved", () => { history.pushState(null, "", routeUrl({ view: "unloved", page: 1 })); showUnloved().catch(error => showStatus(`Unloved error: ${error.message}`, "error")); }],
      ["Categories", () => { history.pushState(null, "", routeUrl({ view: "categories" })); showCategoryPicker(); }]
    ]);
    const aboutMenu = menu("About", [
      ["Readme", () => { history.pushState(null, "", routeUrl({ view: "about", section: "readme" })); showAbout("readme"); }],
      ["Version history", () => { history.pushState(null, "", routeUrl({ view: "about", section: "history" })); showAbout("history"); }]
    ]);
    const primaryNavigation = element("nav", "fewercunts-primary-nav");
    primaryNavigation.setAttribute("aria-label", "Forum");
    rowsSlot = element("span", "fewercunts-rows-nav");
    nativeRowsElement = document.querySelector(".fewercunts-rows-control");
    if (nativeRowsElement) {
      nativeRowsElement.classList.add("fewercunts-top-nav");
      rowsSlot.appendChild(nativeRowsElement);
    }
    revealStatus = element("span", "fewercunts-reveal-status", "");
    revealStatus.hidden = true; revealStatus.setAttribute("role", "status");
    primaryNavigation.append(homeControl, userMenu, newTopic, viewMenu, searchControl, aboutMenu, rowsSlot, revealStatus, settingsStatus, importInput);
    if (!nativeRowsElement) {
      const rowsObserver = new MutationObserver(() => {
        const candidate = document.querySelector(".fewercunts-rows-control");
        if (!candidate || candidate === activeRows?.element) return;
        nativeRowsElement = candidate;
        nativeRowsElement.classList.add("fewercunts-top-nav");
        if (results.hidden) rowsSlot.replaceChildren(nativeRowsElement);
        rowsObserver.disconnect();
      });
      rowsObserver.observe(document.getElementById("theforum"), { childList: true, subtree: true });
    }
    toolbarLine.replaceChildren(primaryNavigation, form);
    function alignPagerToNavigation() {
      const bounds = primaryNavigation.getBoundingClientRect();
      const listBounds = rightSide.getBoundingClientRect();
      document.documentElement.style.setProperty("--fewercunts-pager-left", `${Math.max(0, Math.round(bounds.left))}px`);
      document.documentElement.style.setProperty("--fewercunts-pager-width", `${Math.max(0, Math.round(bounds.width))}px`);
      document.documentElement.style.setProperty("--fewercunts-divider-left-offset", `${Math.round(listBounds.left - bounds.left)}px`);
      document.documentElement.style.setProperty("--fewercunts-divider-right-offset", `${Math.round(bounds.right - listBounds.right)}px`);
    }
    alignPagerToNavigation();
    requestAnimationFrame(alignPagerToNavigation);
    setTimeout(alignPagerToNavigation, 250);
    setTimeout(alignPagerToNavigation, 1000);
    window.addEventListener("resize", alignPagerToNavigation);
    if (typeof ResizeObserver === "function") {
      const pagerAlignmentObserver = new ResizeObserver(alignPagerToNavigation);
      pagerAlignmentObserver.observe(primaryNavigation);
      pagerAlignmentObserver.observe(rightSide);
    }

    document.addEventListener("click", event => {
      if (event.target.closest(".fewercunts-menu")) return;
      document.querySelectorAll(".fewercunts-menu-popup").forEach(node => { node.hidden = true; });
      document.querySelectorAll(".fewercunts-menu > button").forEach(node => node.setAttribute("aria-expanded", "false"));
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const open = Array.from(document.querySelectorAll(".fewercunts-menu-popup")).find(node => !node.hidden);
      document.querySelectorAll(".fewercunts-menu-popup").forEach(node => { node.hidden = true; });
      document.querySelectorAll(".fewercunts-menu > button").forEach(node => node.setAttribute("aria-expanded", "false"));
      if (open) open.closest(".fewercunts-menu").querySelector("button").focus();
      closeSearch();
    });

    searchControl.addEventListener("click", () => {
      const opening = form.hidden;
      form.hidden = !opening;
      searchControl.setAttribute("aria-expanded", String(opening));
      if (opening) { renderRecentSearches(); input.focus(); }
    });

    async function showSaved(page = 1) {
      closeSearch(); stopProgress(); showStatus("Loading saved threads…", "loading");
      const response = await send({ type: "fewercunts-search:saved", offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
      savedIds = new Set((await send({ type: "fewercunts-search:saved-ids" })).map(Number));
      nativeThreads.hidden = true; results.hidden = false;
      results.dataset.state = response.total ? "results" : "empty"; results.setAttribute("aria-busy", "false");
      const children = [statusPanel(response.total ? "results" : "empty",
        response.total ? `${response.total} saved ${response.total === 1 ? "thread" : "threads"}, newest saved first` : "No saved threads yet.")];
      const controls = element("div", "fewercunts-unread-controls");
      const clear = element("button", "fewercunts-unread-action link-text", "Clear saved");
      clear.type = "button"; clear.disabled = !response.total;
      clear.addEventListener("click", async () => {
        if (!confirm("Remove every thread from your local saved list?")) return;
        await send({ type: "fewercunts-search:saved-clear" }); savedIds.clear(); await showSaved(1);
      });
      controls.append(clear); children.push(controls);
      addRows(children, page, "Rows per page for saved threads", (target, replace) => {
        if (replace) history.replaceState({}, "", routeUrl({ view: "saved", page: target }));
        return showSaved(target);
      });
      const header = element("div", "all-threads-header thread-underline-gold row fewercunts-saved-header");
      for (const [classes, label] of [["col-xs-6 no-wrap", "Subject"], ["col-xs-2 no-wrap", "From"],
        ["col-xs-2 no-wrap", "Saved"], ["col-xs-2 no-wrap", "Action"]]) header.appendChild(element("div", classes, label));
      children.push(header);
      for (const item of response.items) {
        const row = element("div", "thread-header thread-underline row fewercunts-saved-thread");
        row.dataset.fewercuntsThreadId = String(item.threadId);
        const subject = element("div", "col-xs-6");
        if (item.missing) {
          const missing = element("span", "fewercunts-saved-missing", `${item.title} — unavailable`);
          missing.setAttribute("aria-label", `${item.title}; thread unavailable`); subject.appendChild(missing);
        } else {
          const title = element("a", "link-text", item.title || "Untitled thread");
          title.href = item.canonicalUrl; title.dataset.fewercuntsDocKey = item.docKey;
          title.dataset.fewercuntsThreadId = String(item.threadId);
          title.addEventListener("click", event => { event.preventDefault(); openResult(item, false)
            .catch(error => showStatus(`Saved navigation error: ${error.message}`, "error")); });
          subject.appendChild(title);
          if (item.unreadCount) subject.appendChild(unreadBadge(item.unreadCount));
        }
        const from = element("div", "col-xs-2", item.username || "Unknown");
        const saved = element("div", "col-xs-2", new Date(item.savedUtc).toLocaleDateString());
        const action = element("div", "col-xs-2");
        const remove = element("button", "fewercunts-unread-action link-text", "Remove"); remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${item.title} from saved threads`);
        remove.addEventListener("click", async () => {
          const state = await send({ type: "fewercunts-search:save-remove", threadId: item.threadId });
          savedIds = new Set(state.ids.map(Number)); await showSaved(page);
        });
        action.appendChild(remove); row.append(subject, from, saved, action); children.push(row);
      }
      addPagination(children, response.total, page, "Saved threads pagination", { view: "saved" }, target => showSaved(target));
      results.replaceChildren(...children); decorateUnread(); updateSavedControls();
    }

    async function showMuted(page = 1) {
      closeSearch(); stopProgress(); showStatus("Loading muted threads…", "loading");
      const response = await send({ type: "fewercunts-search:muted", offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
      mutedIds = new Set((await send({ type: "fewercunts-search:muted-ids" })).map(Number));
      nativeThreads.hidden = true; results.hidden = false;
      results.dataset.state = response.total ? "results" : "empty"; results.setAttribute("aria-busy", "false");
      const children = [statusPanel(response.total ? "results" : "empty",
        response.total ? `${response.total} locally muted ${response.total === 1 ? "thread" : "threads"}, newest muted first`
          : "No locally muted threads.")];
      const controls = element("div", "fewercunts-unread-controls");
      const reveal = element("button", "fewercunts-unread-action link-text", revealHidden ? "Hide again" : "Reveal hidden");
      reveal.type = "button"; reveal.setAttribute("aria-pressed", String(revealHidden));
      reveal.addEventListener("click", async () => {
        revealHidden = !revealHidden; publishVisibility(); await showMuted(page);
      });
      const clear = element("button", "fewercunts-unread-action link-text", "Clear muted");
      clear.type = "button"; clear.disabled = !response.total;
      clear.addEventListener("click", async () => {
        if (!confirm("Unmute every locally muted thread?")) return;
        await send({ type: "fewercunts-search:muted-clear" }); mutedIds.clear(); publishVisibility(); await showMuted(1);
      });
      controls.append(reveal, document.createTextNode(" | "), clear); children.push(controls);
      addRows(children, page, "Rows per page for muted threads", (target, replace) => {
        if (replace) history.replaceState({}, "", routeUrl({ view: "muted", page: target }));
        return showMuted(target);
      });
      const header = element("div", "all-threads-header thread-underline-gold row fewercunts-muted-header");
      for (const [classes, label] of [["col-xs-6 no-wrap", "Subject"], ["col-xs-2 no-wrap", "From"],
        ["col-xs-2 no-wrap", "Muted"], ["col-xs-2 no-wrap", "Action"]]) header.appendChild(element("div", classes, label));
      children.push(header);
      for (const item of response.items) {
        const row = element("div", "thread-header thread-underline row fewercunts-muted-thread");
        row.dataset.fewercuntsThreadId = String(item.threadId);
        const subject = element("div", "col-xs-6");
        const title = element("a", "link-text", item.title || "Untitled thread");
        title.href = item.canonicalUrl; title.dataset.fewercuntsDocKey = item.docKey;
        title.dataset.fewercuntsThreadId = String(item.threadId);
        title.addEventListener("click", event => { event.preventDefault(); openResult(item, false)
          .catch(error => showStatus(`Muted navigation error: ${error.message}`, "error")); });
        subject.appendChild(title);
        const from = element("div", "col-xs-2", item.username || "Unknown");
        const when = element("div", "col-xs-2", new Date(item.mutedUtc).toLocaleDateString());
        const action = element("div", "col-xs-2");
        const remove = element("button", "fewercunts-unread-action link-text", "Unmute"); remove.type = "button";
        remove.setAttribute("aria-label", `Unmute ${item.title}`);
        remove.addEventListener("click", async () => {
          const state = await send({ type: "fewercunts-search:mute-remove", threadId: item.threadId });
          mutedIds = new Set(state.ids.map(Number)); publishVisibility(); await showMuted(page);
        });
        action.appendChild(remove); row.append(subject, from, when, action); children.push(row);
      }
      addPagination(children, response.total, page, "Muted threads pagination", { view: "muted" }, target => showMuted(target));
      results.replaceChildren(...children); updateMuteControls();
    }

    function requestNotificationPermission() {
      if (!api.permissions?.request) return Promise.resolve(false);
      return new Promise(resolve => {
        let settled = false; const finish = value => { if (!settled) { settled = true; resolve(Boolean(value)); } };
        try {
          const promise = api.permissions.request({ permissions: ["notifications"] }, finish);
          if (promise?.then) promise.then(finish, () => finish(false));
        } catch (_error) { finish(false); }
      });
    }

    async function showNotifications(page = 1) {
      closeSearch(); stopProgress(); showStatus("Loading notifications…", "loading");
      const response = await send({ type: "fewercunts-search:notifications" });
      const settings = response.settings || { enabled: false, username: "", browser: false };
      if (!forumUsername && settings.username) forumUsername = settings.username;
      nativeThreads.hidden = true; results.hidden = false; results.dataset.state = "results";
      const children = [statusPanel("results", settings.enabled
        ? `${response.unread} unread repl${response.unread === 1 ? "y" : "ies"} for ${settings.username}`
        : "Reply notifications are off")];
      const controls = element("div", "fewercunts-notification-controls");
      if (!settings.enabled) {
        controls.appendChild(element("span", "fewercunts-notification-explanation",
          "Opt in to detect future public replies during the existing local incremental update. No server push or account scraping."));
        const enable = element("button", "fewercunts-unread-action link-text", "Enable notifications"); enable.type = "button";
        enable.addEventListener("click", () => {
          if (!forumUsername) document.dispatchEvent(new CustomEvent(IDENTITY_REQUEST_EVENT));
          if (!forumUsername) return showStatus("Log in to NTForum before enabling reply notifications.", "error");
          const permission = requestNotificationPermission();
          permission.then(browser => send({ type: "fewercunts-search:notification-settings",
            settings: { enabled: true, username: forumUsername, browser } }))
            .then(() => showNotifications(1)).catch(error => showStatus(`Notification error: ${error.message}`, "error"));
        });
        controls.append(document.createTextNode(" "), enable);
      } else {
        controls.appendChild(element("span", "fewercunts-notification-explanation",
          settings.browser ? "Forum centre and browser alerts are enabled." : "Forum centre enabled; browser alerts are unavailable or denied."));
        const disable = element("button", "fewercunts-unread-action link-text", "Disable notifications"); disable.type = "button";
        disable.addEventListener("click", () => send({ type: "fewercunts-search:notification-settings",
          settings: { enabled: false, username: settings.username, browser: false } }).then(() => showNotifications(1))
          .catch(error => showStatus(`Notification error: ${error.message}`, "error")));
        controls.append(document.createTextNode(" "), disable);
      }
      children.push(controls);
      const items = settings.enabled ? (response.items || []) : []; const total = items.length; const start = (page - 1) * PAGE_SIZE;
      for (const item of items.slice(start, start + PAGE_SIZE)) {
        const article = element("article", "post fewercunts-result fewercunts-notification-item");
        const heading = element("div", "post-title"); const link = element("a", "link-text", item.title || "Reply");
        link.href = item.canonicalUrl; link.dataset.fewercuntsDocKey = item.docKey; link.dataset.fewercuntsThreadId = String(item.threadId);
        link.addEventListener("click", event => {
          event.preventDefault(); send({ type: "fewercunts-search:notification-update", docKey: item.docKey, changes: { read: true } }).catch(() => {});
          openResult(item, false).catch(error => showStatus(`Visit error: ${error.message}`, "error"));
        });
        heading.append(link, document.createTextNode(` — reply from ${item.username} on ${new Date(item.createdUtc).toLocaleString()}`));
        if (!item.read) heading.appendChild(unreadBadge(1));
        const body = element("div", "post-body"); body.appendChild(linkedText("div", "post-message", item.snippet));
        const actions = element("div", "fewercunts-result-actions");
        if (!item.read) {
          const read = element("button", "fewercunts-unread-action link-text", "Mark read"); read.type = "button";
          read.addEventListener("click", () => send({ type: "fewercunts-search:notification-update",
            docKey: item.docKey, changes: { read: true } }).then(() => showNotifications(page)));
          actions.append(read, document.createTextNode(" | "));
        }
        const dismiss = element("button", "fewercunts-unread-action link-text", "Dismiss"); dismiss.type = "button";
        dismiss.addEventListener("click", () => send({ type: "fewercunts-search:notification-update",
          docKey: item.docKey, changes: { dismissed: true, read: true } }).then(() => showNotifications(page)));
        actions.appendChild(dismiss); body.appendChild(actions); article.append(heading, body); children.push(article);
      }
      addPagination(children, total, page, "Notifications pagination", { view: "notifications" }, target => showNotifications(target));
      results.replaceChildren(...children);
    }

    async function showUnread(page = 1) {
      closeSearch(); stopProgress(); showStatus("Loading unread activity…", "loading");
      const response = await send({ type: "fewercunts-search:unread", offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
      unreadSummary = await send({ type: "fewercunts-search:unread-summary" });
      nativeThreads.hidden = true; results.hidden = false;
      results.dataset.state = response.total ? "results" : "empty"; results.setAttribute("aria-busy", "false");
      viewMenu.trigger.textContent = "View all"; viewMenu.trigger.removeAttribute("aria-haspopup");
      viewMenu.directAction = () => { history.pushState({ fewercuntsPage: 1 }, "", "/"); showNative(); threadsControl && threadsControl.click(); };
      const children = [statusPanel(response.total ? "results" : "empty",
        response.total ? `${response.total} unread ${response.total === 1 ? "item" : "items"}, newest first` : "Everything currently visible is read.")];
      const controls = element("div", "fewercunts-unread-controls");
      const jump = element("button", "fewercunts-unread-action link-text", "Jump to first unread");
      jump.type = "button"; jump.disabled = !response.firstUnread;
      jump.addEventListener("click", () => { if (response.firstUnread) openResult(response.firstUnread, false)
        .then(() => markRead({ docKeys: [response.firstUnread.docKey] })).catch(error => showStatus(`Unread navigation error: ${error.message}`, "error")); });
      const markAll = element("button", "fewercunts-unread-action link-text", "Mark all read");
      markAll.type = "button"; markAll.disabled = !response.total;
      markAll.addEventListener("click", async () => { await markRead({ all: true }); await showUnread(1); });
      controls.append(jump, document.createTextNode(" | "), markAll, unreadBadge(response.total)); children.push(controls);
      addRows(children, page, "Rows per page for unread activity", (target, replace) => {
        if (replace) history.replaceState({}, "", routeUrl({ view: "unread", page: target }));
        return showUnread(target);
      });
      for (const item of response.items) {
        const article = element("article", "fewercunts-result fewercunts-unread-item post-container");
        article.dataset.fewercuntsDocKey = item.docKey; article.dataset.fewercuntsThreadId = String(item.threadId);
        const heading = element("div", "post-title");
        const link = element("a", "link-text fewercunts-unread", item.kind === "r" ? `Reply in ${item.threadTitle}` : item.title);
        link.href = item.canonicalUrl; link.dataset.fewercuntsDocKey = item.docKey; link.dataset.fewercuntsThreadId = String(item.threadId);
        link.addEventListener("click", event => { event.preventDefault(); openResult(item, false)
          .then(() => markRead({ docKeys: [item.docKey] })).catch(error => showStatus(`Unread navigation error: ${error.message}`, "error")); });
        heading.append(link, unreadBadge(1));
        const body = element("div", "post-body");
        body.append(element("div", "post-author", `${item.kind === "r" ? "Reply by" : "Thread started by"} ${item.username} on ${new Date(item.createdUtc).toLocaleString()}`),
          linkedText("div", "post-message", item.snippet));
        const actions = element("div", "fewercunts-result-actions");
        const markItem = element("button", "fewercunts-unread-action link-text", "Mark read"); markItem.type = "button";
        markItem.addEventListener("click", async () => { await markRead({ docKeys: [item.docKey] }); await showUnread(page); });
        const markThread = element("button", "fewercunts-unread-action link-text", "Mark thread read"); markThread.type = "button";
        markThread.addEventListener("click", async () => { await markRead({ threadId: item.threadId }); await showUnread(page); });
        actions.append(markItem, document.createTextNode(" | "), markThread); body.appendChild(actions); article.append(heading, body); children.push(article);
      }
      addPagination(children, response.total, page, "Unread activity pagination", { view: "unread" }, target => showUnread(target));
      results.replaceChildren(...children); decorateUnread();
    }

    const showUnloved = globalThis.FewerCuntsUiUnloved.create({ addPagination, addRows, authorControl, closeSearch,
      currentViewState, element, history, nativeThreads, openResult, pageSize: () => PAGE_SIZE, results, routeUrl,
      send, showStatus, statusPanel, stopProgress }).show;

    const categoryViews = globalThis.FewerCuntsUiCategories.create({ addPagination, categories: globalThis.FewerCuntsCategories,
      closeSearch, element, forumUsername: () => forumUsername, history, nativeThreads, openResult,
      pageSize: () => PAGE_SIZE, results, routeUrl, send, showStatus, statusPanel, stopProgress });
    const showCategoryPicker = categoryViews.picker; const showCategory = categoryViews.show;

    const forum = document.getElementById("theforum");
    function decorateAuthors() {
      for (const node of forum.querySelectorAll(".thread-header > .col-xs-2 .thread-header-text, .post-author .link-text")) {
        const username = node.textContent.trim();
        if (!username || isBlockedUsername(username) || node.dataset.fewercuntsAuthor) continue;
        node.dataset.fewercuntsAuthor = username;
        node.classList.add("fewercunts-author-link", "link-text");
        node.setAttribute("aria-label", `Show posts and replies by ${username}`);
        if (node.tagName !== "A") {
          node.tabIndex = 0;
          node.setAttribute("role", "button");
        }
      }
      decorateUnread();
      decorateSaved();
      updateMuteControls();
    }
    forum.addEventListener("click", event => {
      const control = event.target.closest("[data-fewercunts-author]");
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      history.pushState({}, "", routeUrl({ view: "author", user: control.dataset.fewercuntsAuthor, tab: "posts" }));
      showAuthor(control.dataset.fewercuntsAuthor).catch(error => showStatus(`Author view error: ${error.message}`, "error"));
    }, true);
    forum.addEventListener("keydown", event => {
      const control = event.target.closest("[data-fewercunts-author]");
      if (control && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        control.click();
      }
    });
    decorateAuthors();
    const authorObserver = new MutationObserver(decorateAuthors);
    authorObserver.observe(forum, { childList: true, subtree: true });
    refreshControls().catch(() => {});
    refreshUnread().catch(() => {});
    refreshSaved().catch(() => {});
    refreshMuted().catch(() => {});
    send({ type: "fewercunts-search:maintain" }).then(refreshControls).catch(() => {});
    function restoreSavedPosition(key = history.state && history.state.fewercuntsRestoreKey) {
      if (!key) return;
      let attempts = 0;
      const apply = () => {
        attempts += 1;
        if (globalThis.FewerCuntsNavigationState.restore({ storage: localStorage, key, document, window })) return;
        if (attempts < 80) setTimeout(apply, 25);
      };
      requestAnimationFrame(apply);
    }
    function withPosition(value, key) {
      if (value && typeof value.then === "function") return value.then(result => { restoreSavedPosition(key); return result; });
      restoreSavedPosition(key); return value;
    }
    function restoreRoute() {
      if (/^#page=\d+$/.test(location.hash) || document.documentElement.dataset.fewercuntsInitialPage && !location.hash.includes("view=")) return showNative();
      const preservedInitialRoute = document.documentElement.dataset.fewercuntsInitialRoute || "";
      const routeHash = location.hash.includes("view=") ? location.hash : preservedInitialRoute;
      if (routeHash && routeHash !== location.hash) history.replaceState(history.state, "", `${location.pathname}${location.search}${routeHash}`);
      delete document.documentElement.dataset.fewercuntsInitialRoute;
      const params = new URLSearchParams(routeHash.replace(/^#/, ""));
      const page = Math.max(1, Number(params.get("page")) || 1);
      const restoreKey = history.state && history.state.fewercuntsRestoreKey;
      if (params.get("view") === "unloved") return withPosition(showUnloved(page).catch(error => showStatus(`Unloved error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "categories") return showCategoryPicker();
      if (params.get("view") === "category") return withPosition(showCategory(params.get("category") || "uncategorised", page)
        .catch(error => showStatus(`Category error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "unread") return withPosition(showUnread(page).catch(error => showStatus(`Unread error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "saved") return withPosition(showSaved(page).catch(error => showStatus(`Saved error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "muted") return withPosition(showMuted(page).catch(error => showStatus(`Muted error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "notifications") return withPosition(showNotifications(page).catch(error => showStatus(`Notification error: ${error.message}`, "error")), restoreKey);
      if (params.get("view") === "block-list") return showBlockList();
      if (params.get("view") === "about") return showAbout(params.get("section") === "history" ? "history" : "readme");
      if (params.get("view") === "author") {
        const view = params.get("tab") === "replies" ? "replies" : "posts";
        return withPosition(showAuthor(params.get("user") || "", view, authorPageFromRoute(params, view)).catch(error => showStatus(`Author view error: ${error.message}`, "error")), restoreKey);
      }
      if (params.get("view") === "search") {
        input.value = params.get("q") || "";
        const wanted = new Set((params.get("scopes") || "user,post,replies").split(","));
        for (const [scope, control] of scopes) control.setAttribute("aria-pressed", String(wanted.has(scope)));
        const resultKind = params.get("tab") === "replies" ? "r" : "t";
        return withPosition(search(input.value, page, false, false, resultKind)
          .catch(error => showStatus(`Search error: ${error.message}`, "error")), restoreKey);
      }
      if (location.hash === "#unloved") return showUnloved().catch(error => showStatus(`Unloved error: ${error.message}`, "error"));
      if (location.pathname === "/") return showHome();
    }
    function restoreInitialRoute() {
      return Promise.resolve(restoreRoute()).finally(() => {
        if (location.hash.includes("view=") && !results.hidden) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            document.dispatchEvent(new CustomEvent(PLUGIN_VIEW_READY_EVENT));
          }));
        }
      });
    }
    window.addEventListener("popstate", restoreRoute);
    Promise.all([send({ type: "fewercunts-search:block-list" }), send({ type: "fewercunts-search:muted-ids" })]).then(([value, ids]) => {
      const next = globalThis.FewerCuntsBlockList.validate(value.usernames);
      blockedUsernames = next; blockedKeys = new Set(next.map(globalThis.FewerCuntsBlockList.normalise));
      mutedIds = new Set(ids.map(Number)); publishVisibility();
      restoreInitialRoute();
    }).catch(() => restoreInitialRoute());
    return true;
  }

  if (!attach()) {
    const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
