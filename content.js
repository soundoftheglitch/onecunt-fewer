(function () {
  "use strict";

  const STARTING_CLASS = "fewercunts-starting";
  let blockedUsernames = globalThis.FewerCuntsBlockList.defaults();
  let blockedKeys = new Set(blockedUsernames.map(globalThis.FewerCuntsBlockList.normalise));
  let mutedThreadIds = new Set();
  let revealHidden = false;
  const BLOCK_LIST_EVENT = "fewercunts:block-list-updated";
  const VISIBILITY_EVENT = "fewercunts:visibility-updated";
  const NAVIGATE_EVENT = "fewercunts:navigate-to-post";
  const NAVIGATE_RESULT_EVENT = "fewercunts:navigate-to-post-result";
  const PRESENTED_EVENT = "fewercunts:presented-posts";
  const PLUGIN_VIEW_READY_EVENT = "fewercunts:plugin-view-ready";
  const IDENTITY_EVENT = "fewercunts:forum-identity";
  const IDENTITY_REQUEST_EVENT = "fewercunts:forum-identity-request";
  const BACKFILL_EVENT = "fewercunts:blocked-thread-backfill";
  const BACKFILL_RESULT_EVENT = "fewercunts:blocked-thread-backfill-result";
  const CLASSIC_EVENT = "fewercunts:classic-page-request";
  const CLASSIC_RESULT_EVENT = "fewercunts:classic-page-result";
  const CLASSIC_READY_EVENT = "fewercunts:classic-page-ready";
  const DEVELOPER_POLICY_EVENT = "fewercunts:developer-reply-policy";
  const DEVELOPER_POLICY_REQUEST_EVENT = "fewercunts:developer-reply-policy-request";
  const HOME_EVENT = "fewercunts:home-request";
  const root = document.documentElement;
  const filter = globalThis.NtForumBlockerEngine.createFilter({
    targetUsernames: blockedUsernames,
    onThreadsRemoved: requestBackfill
  });
  let attached = false;
  let observer = null;
  let attempts = 0;
  let pagination = null;
  let archiveGuardInstalled = false;
  let pendingBackfill = null;
  let identityBridgeInstalled = false;
  let developerReplyPolicy = null;
  let developerPolicyRender = null;
  let lastDeveloperPolicyRequest = 0;
  let startupProgress = 0;
  let startupLoader = null;
  let startupReleased = false;
  let startupReleaseScheduled = false;
  let classicBridgeReady = false;
  const initialPageUrl = location.href;
  const initialPageMatch = new URL(initialPageUrl).hash.match(/^#page=(\d+)$/);
  const initialPluginRoute = new URL(initialPageUrl).hash.match(/^#view=.+/)?.[0] || "";

  root.classList.add(STARTING_CLASS);
  root.dataset.fewercuntsStartup = "loading";
  if (initialPageMatch) root.dataset.fewercuntsInitialPage = initialPageMatch[1];
  if (initialPluginRoute) root.dataset.fewercuntsInitialRoute = initialPluginRoute;

  function ensureStartupLoader() {
    if (startupReleased) return null;
    if (startupLoader) return startupLoader;
    const overlay = document.createElement("div"); overlay.className = "fewercunts-startup-loader";
    overlay.setAttribute("role", "status"); overlay.setAttribute("aria-live", "polite");
    const track = document.createElement("div"); track.className = "fewercunts-startup-track";
    const progress = document.createElement("progress"); progress.className = "fewercunts-startup-progress"; progress.max = 100;
    progress.value = 0; progress.setAttribute("aria-label", "Forum initialization: 0%");
    track.appendChild(progress); overlay.appendChild(track);
    root.appendChild(overlay);
    startupLoader = { overlay, progress }; return startupLoader;
  }

  function setStartupProgress(value) {
    if (startupReleased) return;
    startupProgress = Math.max(startupProgress, Math.min(100, Math.round(Number(value) || 0)));
    const loader = ensureStartupLoader(); if (!loader) return;
    loader.progress.value = startupProgress;
    loader.progress.setAttribute("aria-label", `Forum initialization: ${startupProgress}%`);
  }

  function revealForum() {
    if (startupReleased || startupReleaseScheduled) return;
    setStartupProgress(100); startupReleaseScheduled = true;
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        startupReleased = true; root.dataset.fewercuntsStartup = "ready";
        if (startupLoader) startupLoader.overlay.remove();
        startupLoader = null; root.classList.remove(STARTING_CLASS);
      })), 240);
  }

  ensureStartupLoader();
  const startingObserver = new MutationObserver(() => {
    if (document.getElementById("theforum")) {
      ensureStartupLoader(); requestAnimationFrame(() => setStartupProgress(10)); startingObserver.disconnect();
    }
  });
  if (document.getElementById("theforum")) requestAnimationFrame(() => setStartupProgress(10));
  else startingObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(CLASSIC_READY_EVENT, () => { classicBridgeReady = true; setStartupProgress(65); });
  document.addEventListener(PLUGIN_VIEW_READY_EVENT, () => {
    if (initialPluginRoute) revealForum();
  }, { once: true });
  setTimeout(revealForum, 180000);

  function findViewModel() {
    const forum = document.getElementById("theforum");
    if (!forum || !globalThis.ko || typeof globalThis.ko.dataFor !== "function") {
      return null;
    }
    return globalThis.ko.dataFor(forum);
  }

  function valueOf(item, name) {
    return item && typeof item[name] === "function" ? item[name]() : item && item[name];
  }

  function requestDeveloperReplyPolicy() {
    const now = Date.now();
    if (now - lastDeveloperPolicyRequest < 1000) return;
    lastDeveloperPolicyRequest = now;
    document.dispatchEvent(new CustomEvent(DEVELOPER_POLICY_REQUEST_EVENT));
  }

  document.addEventListener(DEVELOPER_POLICY_EVENT, function (event) {
    let value; try { value = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    const title = typeof value.title === "string" ? value.title : null;
    developerReplyPolicy = { ready: value.ready === true
      && globalThis.NtForumBlockerEngine.validDeveloperReplyTitle(title), title,
      message: String(value.message || "The signed search database is still preparing.") };
    if (developerPolicyRender) developerPolicyRender();
    if (!developerReplyPolicy.ready) setTimeout(requestDeveloperReplyPolicy, 2000);
  });

  function isBlockedUsername(value) {
    return !revealHidden && isConfiguredBlockedUsername(value);
  }

  function isMutedThreadId(value) {
    return !revealHidden && isConfiguredMutedThreadId(value);
  }

  function isConfiguredBlockedUsername(value) {
    return blockedKeys.has(globalThis.FewerCuntsBlockList.normalise(value));
  }

  function isConfiguredMutedThreadId(value) {
    return mutedThreadIds.has(Number(value));
  }

  function discardBackfill() {
    const viewModel = findViewModel();
    if (viewModel && typeof viewModel.threads === "function") {
      viewModel.threads(viewModel.threads().filter(thread => !thread.__fewercuntsBackfill));
    }
    pendingBackfill = null;
  }

  document.addEventListener(BLOCK_LIST_EVENT, function (event) {
    let detail;
    try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    let next;
    try { next = globalThis.FewerCuntsBlockList.validate(detail.usernames); } catch (_error) { return; }
    discardBackfill();
    blockedUsernames = next;
    blockedKeys = new Set(next.map(globalThis.FewerCuntsBlockList.normalise));
    filter.setVisibility({ targetUsernames: next });
  });

  document.addEventListener(VISIBILITY_EVENT, function (event) {
    let detail;
    try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    let nextUsers;
    try { nextUsers = globalThis.FewerCuntsBlockList.validate(detail.usernames); } catch (_error) { return; }
    const nextIds = Array.isArray(detail.mutedThreadIds)
      ? detail.mutedThreadIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0) : [];
    discardBackfill();
    blockedUsernames = nextUsers;
    blockedKeys = new Set(nextUsers.map(globalThis.FewerCuntsBlockList.normalise));
    mutedThreadIds = new Set(nextIds);
    revealHidden = Boolean(detail.revealHidden);
    filter.setVisibility({ targetUsernames: nextUsers, targetThreadIds: nextIds, revealHidden });
  });

  function requestBackfill(removed, kept) {
    const viewModel = findViewModel();
    if (!viewModel || !removed.length) return;
    const list = document.querySelector("#theforum .forum-right-side");
    if (list) list.style.minHeight = "";
    const baselineHeight = list ? list.getBoundingClientRect().height : 0;
    const requestId = crypto.randomUUID();
    const page = Number(valueOf(viewModel, "pageNumber")) || 1;
    const sort = String(valueOf(viewModel, "sortOrder") || "datedesc");
    pendingBackfill = { requestId, page, sort, slots: removed.map(item => item.index), list, baselineHeight };
    const blockedIds = removed.map(item => Number(valueOf(item.thread, "id"))).filter(Number.isSafeInteger);
    const visibleIds = kept.map(item => Number(valueOf(item, "id"))).filter(Number.isSafeInteger);
    const detail = JSON.stringify({
      requestId, count: removed.length, seed: `classic:${page}:${sort}:${blockedIds.join(",")}`,
      excludeIds: [...new Set([...blockedIds, ...visibleIds])]
    });
    queueMicrotask(() => document.dispatchEvent(new CustomEvent(BACKFILL_EVENT, { detail })));
  }

  document.addEventListener(BACKFILL_RESULT_EVENT, function (event) {
    let detail;
    try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    const pending = pendingBackfill;
    const viewModel = findViewModel();
    if (!pending || !viewModel || detail.requestId !== pending.requestId || !Array.isArray(detail.threads)) return;
    const page = Number(valueOf(viewModel, "pageNumber")) || 1;
    const sort = String(valueOf(viewModel, "sortOrder") || "datedesc");
    if (page !== pending.page || sort !== pending.sort) return;
    const current = viewModel.threads().slice();
    const used = new Set(current.map(item => Number(valueOf(item, "id"))));
    let inserted = 0;
    detail.threads.slice(0, pending.slots.length).forEach(function (data, index) {
      if (!data || !Number.isSafeInteger(data.Id) || data.PostCount !== 1 || used.has(data.Id)
          || isMutedThreadId(data.Id)
          || isBlockedUsername(data.PostedByUsername)) return;
      const slot = Math.min(Math.max(0, pending.slots[index]), current.length);
      const replacement = new theforum.Thread(data);
      replacement.__fewercuntsBackfill = true;
      current.splice(slot, 0, replacement);
      used.add(data.Id);
      inserted += 1;
    });
    pendingBackfill = null;
    viewModel.threads(current);
    if (pending.list) {
      pending.list.style.minHeight = inserted < pending.slots.length && pending.baselineHeight > 0
        ? `${pending.baselineHeight}px` : "";
    }
  });

  function installPagination(viewModel) {
    if (pagination || !globalThis.NtForumPagination) return;
    const footer = document.querySelector("#theforum .thread-footer > .col-xs-12");
    if (!footer || typeof viewModel.pageNumber !== "function" || typeof viewModel.totalPages !== "function" || typeof viewModel.loadPage !== "function") return;

    const api = globalThis.NtForumPagination;
    let rowsControl = null;
    let requestedRows = 25;
    let classicRequest = Promise.resolve(false);
    let catalogueRetryTimer = null;

    function pinWelcomeThread() {
      if (Number(viewModel.pageNumber()) !== 1
          || String(viewModel.sortOrder() || "datedesc").toLowerCase() !== "datedesc") return;
      const threads = viewModel.threads();
      const welcome = threads.findIndex(item => Number(valueOf(item, "id")) === 15249);
      if (welcome > 0) viewModel.threads([threads[welcome], ...threads.slice(0, welcome), ...threads.slice(welcome + 1)]);
    }

    function rawThread(item) {
      return { Id: Number(item.threadId), Title: String(item.title || "Untitled thread"),
        Message: String(item.body || ""), PostedByUsername: String(item.username || ""), PostedByEmailAddress: "",
        CreatedDateTimeUtc: item.createdUtc, LastPostDateTimeUtc: item.lastPostUtc || item.createdUtc,
        PostCount: Math.max(1, Number(item.replyCount) + 1 || 1) };
    }
    function waitForClassicPresentation(expectedItems, target, size) {
      const expectedIds = expectedItems.map(item => Number(item.threadId)).sort((a, b) => a - b);
      let frames = 0; let stableFrames = 0;
      return new Promise(resolve => {
        const inspect = () => {
          frames += 1;
          const viewIds = viewModel.threads().map(item => Number(valueOf(item, "id")));
          const renderedIds = Array.from(document.querySelectorAll("#theforum .thread-header"))
            .filter(node => node.getClientRects().length)
            .map(node => Number(valueOf(globalThis.ko.dataFor(node), "id")));
          const rightSide = document.querySelector("#theforum .forum-right-side");
          const exactSource = JSON.stringify([...viewIds].sort((a, b) => a - b)) === JSON.stringify(expectedIds);
          const exactPaint = JSON.stringify(renderedIds) === JSON.stringify(viewIds);
          const controlsReady = Boolean(rowsControl?.element?.isConnected
            && pager.element.isConnected && rightSide?.classList.contains("fewercunts-density-scroll"));
          const stateReady = Number(viewModel.pageNumber()) === target && Number(viewModel.pageSize()) === size;
          stableFrames = exactSource && exactPaint && controlsReady && stateReady ? stableFrames + 1 : 0;
          if (stableFrames >= 2) return resolve(true);
          if (frames >= 300) return resolve(false);
          requestAnimationFrame(inspect);
        };
        requestAnimationFrame(inspect);
      });
    }
    function closeExpandedThreadForPageChange() {
      const expanded = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
      if (expanded && typeof expanded.isExpanded === "function") expanded.isExpanded(false);
      if (typeof viewModel.expandedThread === "function") viewModel.expandedThread(null);
      if (typeof viewModel.selectedPost === "function") viewModel.selectedPost(null);
      if (typeof viewModel.postToReplyTo === "function") viewModel.postToReplyTo(null);
    }
    function requestClassicPage(page, rows) {
      setStartupProgress(70);
      const target = Math.max(1, Number(page) || 1); const size = Math.max(1, Number(rows) || 25);
      classicRequest = classicRequest.catch(() => false).then(() => new Promise(resolve => {
        const requestId = crypto.randomUUID(); let settled = false; let presenting = false;
        const finish = value => { if (settled) return; settled = true; clearTimeout(timer);
          document.removeEventListener(CLASSIC_RESULT_EVENT, receive);
          document.removeEventListener(CLASSIC_READY_EVENT, dispatch); resolve(value); };
        const receive = event => { let detail; try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
          if (detail.requestId !== requestId) return;
          if (!detail.ok || !detail.value || !Array.isArray(detail.value.items)) return finish(false);
          if (presenting) return; presenting = true;
          const total = Math.max(0, Number(detail.value.total) || 0); setStartupProgress(90);
          viewModel.pageSize(size); viewModel.threadCount(total); viewModel.pageNumber(target);
          viewModel.threads(detail.value.items.map(item => new theforum.Thread(rawThread(item))));
          waitForClassicPresentation(detail.value.items, target, size).then(presented => {
            if (!presented) return finish(false);
            revealForum(); finish(true);
          }); };
        const dispatch = () => {
          classicBridgeReady = true;
          document.removeEventListener(CLASSIC_READY_EVENT, dispatch);
          document.dispatchEvent(new CustomEvent(CLASSIC_EVENT, { detail: JSON.stringify({ requestId,
            offset: (target - 1) * size, limit: size, sortOrder: String(viewModel.sortOrder() || "datedesc") }) }));
        };
        document.addEventListener(CLASSIC_RESULT_EVENT, receive);
        const timer = setTimeout(() => finish(false), 150000);
        if (classicBridgeReady) dispatch();
        else document.addEventListener(CLASSIC_READY_EVENT, dispatch, { once: true });
      }));
      return classicRequest;
    }

    function sync() {
      const current = api.clampPage(viewModel.pageNumber(), viewModel.totalPages()) || 1;
      const pages = Math.max(1, Number(viewModel.totalPages()) || 1);
      pager.sync();
    }

    const nativeLoadPage = viewModel.loadPage.bind(viewModel);
    const pageState = api.createPageState({ page: () => viewModel.pageNumber(), pages: () => viewModel.totalPages(),
      onPage: target => { closeExpandedThreadForPageChange();
        requestClassicPage(target, requestedRows).then(ok => { if (!ok) nativeLoadPage(target); sync(); }); }, route: { mode: "classic" } });
    const pager = api.create({ label: "Thread list pagination", state: pageState });
    setStartupProgress(55);
    viewModel.pageNumber.subscribe(sync);
    viewModel.totalPages.subscribe(sync);
    window.addEventListener("popstate", function () { pageState.restore(); });

    footer.replaceChildren(pager.element);
    const header = document.querySelector("#theforum .all-threads-header");
    if (header && typeof viewModel.pageSize === "function") {
      const rightSide = header.closest(".forum-right-side");
      let visibleRows = 25;
      function threadIsExpanded() {
        const expanded = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
        return Boolean(expanded);
      }
      function releaseViewport() {
        if (!rightSide) return;
        rightSide.style.removeProperty("height");
        rightSide.classList.remove("fewercunts-density-scroll");
      }
      function applyViewport(next, _previous, mode) {
        if (!rightSide) return;
        if (threadIsExpanded()) {
          releaseViewport();
          return;
        }
        const rows = Array.from(rightSide.querySelectorAll(".thread-header")).filter(node => node.getClientRects().length);
        if (!rows.length) return;
        const heights = rows.map(node => node.getBoundingClientRect().height).filter(Boolean).sort((a, b) => a - b);
        const rowHeight = heights[Math.floor(heights.length / 2)] || 22;
        const firstTop = rows[0].getBoundingClientRect().top;
        const fixedTop = rightSide.getBoundingClientRect().top;
        const availableHeight = document.querySelector(".fewercunts-pagination").getBoundingClientRect().top - fixedTop;
        const manualHeight = firstTop - fixedTop + rowHeight * next;
        visibleRows = next;
        rightSide.style.height = `${Math.max(80, mode === "auto" ? availableHeight : manualHeight)}px`;
        rightSide.style.setProperty("--fewercunts-toolbar-height", `${rightSide.querySelector(".top-toolbar")?.getBoundingClientRect().height || 0}px`);
        rightSide.classList.add("fewercunts-density-scroll");
        rightSide.scrollTop = 0;
      }
      function applyRows(next, previous, mode) {
        const target = api.pageForAnchor(viewModel.pageNumber(), previous || requestedRows, next);
        requestedRows = next;
        return requestClassicPage(target, next).then(ok => {
          if (!ok) {
            viewModel.pageSize(25); clearTimeout(catalogueRetryTimer);
            catalogueRetryTimer = setTimeout(() => applyRows(next, previous, mode), 5000);
          } else clearTimeout(catalogueRetryTimer);
          applyViewport(next, previous, mode); sync(); return ok;
        });
      }
      rowsControl = api.createRows({ label: "Rows visible in Classic", rows: () => visibleRows,
        container: document.getElementById("theforum"), rowSelector: ".thread-header",
        maximum: 50, onRows: applyRows });
      header.parentNode.insertBefore(rowsControl.element, header);
      viewModel.threads.subscribe(() => { pinWelcomeThread(); rowsControl.schedule();
        setTimeout(() => applyViewport(rowsControl.rows(), null, rowsControl.preference()), 0); });
      if (typeof viewModel.expandedThread === "function" && typeof viewModel.expandedThread.subscribe === "function") {
        viewModel.expandedThread.subscribe(thread => {
          if (thread) releaseViewport();
          else setTimeout(() => applyViewport(rowsControl.rows(), null, rowsControl.preference()), 0);
        });
      }
      if (typeof viewModel.setSortOrder === "function") {
        viewModel.setSortOrder = sortOrder => {
          if (sortOrder === viewModel.sortOrder()) return;
          viewModel.sortOrder(sortOrder); requestClassicPage(1, requestedRows).then(sync);
        };
      }
    }
    pagination = { go: pageState.navigate, sync: sync };
    document.addEventListener(HOME_EVENT, () => {
      requestClassicPage(1, requestedRows).then(ok => {
        if (!ok) nativeLoadPage(1);
        sync();
      });
    });
    pinWelcomeThread();
    sync();
    const requestedInitialPage = initialPageMatch ? Number(initialPageMatch[1]) : 1;
    let initialClassicAttempts = 0;
    const loadInitialClassic = () => {
      initialClassicAttempts += 1;
      requestClassicPage(requestedInitialPage, requestedRows).then(ok => {
        if (!ok && !startupReleased && initialClassicAttempts < 90) setTimeout(loadInitialClassic, 2000);
      });
    };
    loadInitialClassic();
    if (requestedInitialPage > 1) {
      let restoreAttempts = 0;
      const restore = function () {
        restoreAttempts += 1;
        const loaded = typeof viewModel.isLoaded !== "function" || viewModel.isLoaded();
        const loading = typeof viewModel.isLoadingThreads === "function" && viewModel.isLoadingThreads();
        const initialPage = api.clampPage(requestedInitialPage, viewModel.totalPages());
        if (loaded && !loading && initialPage !== null) {
          pageState.navigate(initialPage, "none");
          history.replaceState({ fewercuntsPage: initialPage }, "", pageState.url(initialPage, initialPageUrl));
        }
        else if (restoreAttempts < 400) setTimeout(restore, 25);
      };
      restore();
    }
  }

  function installArchiveGuard(viewModel) {
    if (archiveGuardInstalled || !globalThis.NtForumArchiveEngine || typeof viewModel.showReplyForm !== "function") return;
    const archive = globalThis.NtForumArchiveEngine;
    const originalShowReplyForm = viewModel.showReplyForm;
    const replacedControls = new WeakMap();
    function isDeveloperThread() {
      return Number(valueOf(valueOf(viewModel, "expandedThread"), "id")) === 15249;
    }
    function archived() {
      const thread = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
      const postCount = thread && typeof thread.postCount === "function" ? thread.postCount() : null;
      return archive.isArchivedPostCount(postCount);
    }
    function hiddenReadOnly(post) {
      const thread = valueOf(viewModel, "expandedThread");
      return revealHidden && (isConfiguredMutedThreadId(valueOf(thread, "id"))
        || isConfiguredBlockedUsername(valueOf(thread, "postedByUsername"))
        || isConfiguredBlockedUsername(valueOf(post, "postedByUsername")));
    }
    function render() {
      const isArchived = archived();
      const selected = valueOf(viewModel, "selectedPost");
      const isReadOnly = hiddenReadOnly(selected);
      const developerUnavailable = isDeveloperThread() && !developerReplyPolicy?.ready;
      if (developerUnavailable) requestDeveloperReplyPolicy();
      if (isArchived || isReadOnly || developerUnavailable) {
        for (const control of document.querySelectorAll("#theforum .post-container .post-reply-button > .link-text")) {
          if (control.textContent.trim() !== "Reply") continue;
          const label = document.createElement("span");
          label.className = `${isArchived ? "fewercunts-native-archived " : ""}fewercunts-native-reply-guard fewercunts-archived`;
          label.textContent = isArchived ? "Archived" : isReadOnly ? "View only" : "Preparing…";
          label.setAttribute("aria-label", isArchived ? "Thread archived; replies are closed" : isReadOnly
            ? "Hidden content is temporarily view only" : developerReplyPolicy?.message || "Developer reply title is preparing");
          replacedControls.set(label, control);
          control.replaceWith(label);
        }
      } else {
        for (const label of document.querySelectorAll("#theforum .fewercunts-native-reply-guard")) {
          const control = replacedControls.get(label);
          if (control) label.replaceWith(control);
        }
      }
      const titleInput = document.querySelector("#theforum .post-input-form input[data-bind*='newMessageTitle']");
      if (isDeveloperThread() && developerReplyPolicy?.ready && valueOf(viewModel, "isShowingNewPostForm")) {
        if (viewModel.newMessageTitle() !== developerReplyPolicy.title) viewModel.newMessageTitle(developerReplyPolicy.title);
        if (titleInput) { titleInput.readOnly = true; titleInput.setAttribute("aria-readonly", "true");
          titleInput.classList.add("fewercunts-developer-title"); }
      } else if (titleInput?.classList.contains("fewercunts-developer-title")) {
        titleInput.readOnly = false; titleInput.removeAttribute("aria-readonly"); titleInput.classList.remove("fewercunts-developer-title");
      }
    }
    function closeReplyForm() {
      if (typeof viewModel.isShowingNewPostForm === "function") viewModel.isShowingNewPostForm(false);
      if (typeof viewModel.postToReplyTo === "function") viewModel.postToReplyTo(null);
    }
    viewModel.showReplyForm = function (post) {
      if (archived() || hiddenReadOnly(post) || (isDeveloperThread() && !developerReplyPolicy?.ready)) {
        if (isDeveloperThread()) requestDeveloperReplyPolicy();
        closeReplyForm();
        render();
        return false;
      }
      const result = originalShowReplyForm.call(viewModel, post);
      if (isDeveloperThread()) queueMicrotask(render);
      return result;
    };
    if (typeof viewModel.expandedThread === "function" && typeof viewModel.expandedThread.subscribe === "function") viewModel.expandedThread.subscribe(render);
    if (typeof viewModel.selectedPost === "function" && typeof viewModel.selectedPost.subscribe === "function") viewModel.selectedPost.subscribe(render);
    if (typeof viewModel.isShowingNewPostForm === "function" && typeof viewModel.isShowingNewPostForm.subscribe === "function") viewModel.isShowingNewPostForm.subscribe(render);
    if (typeof viewModel.newMessageTitle === "function" && typeof viewModel.newMessageTitle.subscribe === "function") {
      viewModel.newMessageTitle.subscribe(() => {
        if (isDeveloperThread() && developerReplyPolicy?.ready
            && viewModel.newMessageTitle() !== developerReplyPolicy.title) viewModel.newMessageTitle(developerReplyPolicy.title);
      });
    }
    new MutationObserver(render).observe(document.getElementById("theforum"), { childList: true, subtree: true });
    archiveGuardInstalled = true;
    developerPolicyRender = render;
    render();
  }

  function attach() {
    const viewModel = findViewModel();
    if (!viewModel || typeof viewModel.threads !== "function") {
      return false;
    }
    setStartupProgress(25);

    attached = filter.attach(viewModel);
    if (attached) {
      setStartupProgress(40);
      installPagination(viewModel);
      installArchiveGuard(viewModel);
      installPresentedObserver(viewModel);
      installIdentityBridge(viewModel);
      if (!pagination) revealForum();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }
    return attached;
  }

  function installIdentityBridge(viewModel) {
    if (identityBridgeInstalled || typeof viewModel.username !== "function") return;
    identityBridgeInstalled = true;
    function publish() {
      document.dispatchEvent(new CustomEvent(IDENTITY_EVENT, {
        detail: JSON.stringify({ username: String(viewModel.username() || "").trim() })
      }));
    }
    if (typeof viewModel.username.subscribe === "function") viewModel.username.subscribe(publish);
    document.addEventListener(IDENTITY_REQUEST_EVENT, publish);
    publish();
  }

  function installPresentedObserver(viewModel) {
    if (document.documentElement.dataset.fewercuntsPresentedObserver || typeof IntersectionObserver !== "function") return;
    document.documentElement.dataset.fewercuntsPresentedObserver = "true";
    const observed = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      const docKeys = [];
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < .55) continue;
        const data = globalThis.ko && globalThis.ko.dataFor(entry.target);
        const id = data && typeof data.id === "function" ? Number(data.id()) : null;
        const selected = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
        const threadId = selected && typeof selected.id === "function" ? Number(selected.id()) : null;
        if (Number.isSafeInteger(id) && Number.isSafeInteger(threadId)) docKeys.push(`${id === threadId ? "t" : "r"}:${id}`);
      }
      if (docKeys.length) {
        const visibleDocKeys = [];
        for (const node of document.querySelectorAll("#theforum .post-container")) {
          if (!node.getClientRects().length) continue;
          const data = globalThis.ko && globalThis.ko.dataFor(node);
          const id = data && typeof data.id === "function" ? Number(data.id()) : null;
          const selected = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
          const threadId = selected && typeof selected.id === "function" ? Number(selected.id()) : null;
          if (Number.isSafeInteger(id) && Number.isSafeInteger(threadId)) visibleDocKeys.push(`${id === threadId ? "t" : "r"}:${id}`);
        }
        document.dispatchEvent(new CustomEvent(PRESENTED_EVENT, {
          detail: JSON.stringify({ docKeys, visibleDocKeys: [...new Set(visibleDocKeys)] })
        }));
      }
    }, { threshold: [.55] });
    const scan = () => {
      for (const node of document.querySelectorAll("#theforum .post-container")) {
        let data = null;
        if (globalThis.ko) {
          for (const candidate of [node, ...node.querySelectorAll("*")]) {
            const bound = globalThis.ko.dataFor(candidate);
            if (Number.isSafeInteger(Number(valueOf(bound, "id")))) { data = bound; break; }
          }
        }
        const id = Number(valueOf(data, "id"));
        const selected = typeof viewModel.expandedThread === "function" ? viewModel.expandedThread() : null;
        const threadId = selected && typeof selected.id === "function" ? Number(selected.id()) : null;
        if (Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(threadId) && threadId > 0) {
          node.dataset.fewercuntsDocKey = `${id === threadId ? "t" : "r"}:${id}`;
          node.dataset.fewercuntsThreadId = String(threadId);
        }
        if (!observed.has(node)) { observed.add(node); observer.observe(node); }
      }
    };
    new MutationObserver(scan).observe(document.getElementById("theforum"), { childList: true, subtree: true });
    scan();
  }

  function retryAttach() {
    if (attached || attach()) {
      return;
    }

    attempts += 1;
    if (attempts < 300) {
      setTimeout(retryAttach, 20);
    } else {
      revealForum();
      console.warn("NTForum user blocker could not find the forum view model.");
    }
  }

  function navigationResult(requestId, ok, error) {
    document.dispatchEvent(new CustomEvent(NAVIGATE_RESULT_EVENT, {
      detail: JSON.stringify({ requestId: requestId, ok: ok, error: error || null })
    }));
  }

  function renderedPost(postId) {
    if (!Number.isSafeInteger(Number(postId))) return null;
    for (const node of document.querySelectorAll("#theforum .post-container")) {
      const bound = node.querySelector(".post-title, .post-message") || node;
      const data = globalThis.ko && globalThis.ko.dataFor(bound);
      if (Number(valueOf(data, "id")) === Number(postId)) return node;
    }
    return null;
  }

  document.addEventListener(NAVIGATE_EVENT, function (event) {
    let detail = {};
    try { detail = JSON.parse(event.detail || "{}"); } catch (_error) { return; }
    const data = detail.thread;
    const viewModel = findViewModel();
    if (!viewModel || !data || !Number.isSafeInteger(data.Id) || typeof theforum !== "object") {
      navigationResult(detail.requestId, false, "The forum view is unavailable");
      return;
    }
    if (isBlockedUsername(data.PostedByUsername) || isMutedThreadId(data.Id)) {
      navigationResult(detail.requestId, false, isMutedThreadId(data.Id) ? "That thread is muted" : "That thread is blocked");
      return;
    }
    let thread = viewModel.threads().find(function (candidate) { return candidate.id() === data.Id; });
    if (!thread) {
      thread = new theforum.Thread(data);
      viewModel.threads.unshift(thread);
    }
    viewModel.expandThread(thread, detail.targetPostId || undefined);
    const archived = globalThis.NtForumArchiveEngine
      && globalThis.NtForumArchiveEngine.isArchivedPostCount(typeof thread.postCount === "function" ? thread.postCount() : null);
    if (archived && detail.reply) {
      if (typeof viewModel.isShowingNewPostForm === "function") viewModel.isShowingNewPostForm(false);
      if (typeof viewModel.postToReplyTo === "function") viewModel.postToReplyTo(null);
    }
    let attempts = 0;
    let stableChecks = 0;
    const timer = setInterval(function () {
      attempts += 1;
      const selected = viewModel.selectedPost();
      const selectedId = selected && typeof selected.id === "function" ? selected.id() : null;
      const wantedId = detail.targetPostId || data.Id;
      if (selectedId === wantedId) {
        const selectedUsername = String(valueOf(selected, "postedByUsername") || "").trim().toLowerCase();
        if (isBlockedUsername(selectedUsername)) {
          clearInterval(timer);
          if (typeof viewModel.selectedPost === "function") viewModel.selectedPost(null);
          navigationResult(detail.requestId, false, "That post is blocked");
          return;
        }
        if (detail.reply && !archived && !viewModel.isShowingNewPostForm()) {
          viewModel.showReplyForm(selected);
          stableChecks = 0;
        } else {
          stableChecks += 1;
        }
        if (stableChecks >= 5) {
          clearInterval(timer);
          const targetPath = detail.targetPostId
            ? `/thread/${data.Id}/reply/${detail.targetPostId}`
            : `/thread/${data.Id}`;
          history.replaceState(null, "", targetPath);
          const visibleTarget = detail.reply && !archived
            ? document.querySelector("#theforum .new-post-header")
            : renderedPost(wantedId);
          if (visibleTarget) visibleTarget.scrollIntoView({ block: "start" });
          if (!detail.reply && visibleTarget && Array.isArray(detail.highlightTerms)) {
            globalThis.FewerCuntsNavigationHighlight.highlight(visibleTarget, detail.highlightTerms);
          }
          navigationResult(detail.requestId, true);
        }
      } else if (attempts >= 200) {
        clearInterval(timer);
        navigationResult(detail.requestId, false, "The requested post could not be loaded");
      }
    }, 50);
  });

  observer = new MutationObserver(function () {
    if (!attached) {
      attach();
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  retryAttach();
})();
