(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.NtForumBlockerEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function read(value) {
    return typeof value === "function" ? value() : value;
  }

  function normalizeUsername(value) {
    return String(value == null ? "" : value).normalize("NFKC").trim().toLowerCase();
  }

  function validDeveloperReplyTitle(value) {
    const match = /^(\d+\.\d+\.\d+(?:\.\d+)?)\+(\d{4})(\d{2})(\d{2})$/.exec(String(value == null ? "" : value));
    if (!match) return false;
    const year = Number(match[2]); const month = Number(match[3]); const day = Number(match[4]);
    if (year < 2000 || year > 2100) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function developerReplyAllowed(threadId, username, title) {
    if (Number(threadId) !== 15249) return true;
    return normalizeUsername(username) === "dog hat" || validDeveloperReplyTitle(title);
  }

  function createFilter(options) {
    const configuredUsernames = options && Array.isArray(options.targetUsernames)
      ? options.targetUsernames
      : [];
    let targetUsernames = new Set(configuredUsernames.map(normalizeUsername).filter(Boolean));
    let targetThreadIds = new Set((options && Array.isArray(options.targetThreadIds)
      ? options.targetThreadIds : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
    let revealHidden = Boolean(options && options.revealHidden);
    const onThreadsRemoved = options && typeof options.onThreadsRemoved === "function"
      ? options.onThreadsRemoved : null;
    let hiddenItems = new WeakSet();
    const observedLists = new WeakSet();
    const listStates = new WeakMap();
    let filtering = false;
    let viewModel = null;
    let totals = { threads: 0, replies: 0 };

    function isTarget(item) {
      return !revealHidden && Boolean(item) && targetUsernames.has(normalizeUsername(read(item.postedByUsername)));
    }

    function isMutedThread(item) {
      return !revealHidden && Boolean(item)
        && targetThreadIds.has(Number(read(item.id)));
    }

    function rememberSubtree(reply) {
      if (!reply || typeof reply !== "object") {
        return;
      }

      hiddenItems.add(reply);
      const children = read(reply.replies);
      if (Array.isArray(children)) {
        children.forEach(rememberSubtree);
      }
    }

    function subscribeToList(observableList) {
      if (
        typeof observableList !== "function" ||
        typeof observableList.subscribe !== "function" ||
        observedLists.has(observableList)
      ) {
        return;
      }

      observedLists.add(observableList);
      listStates.set(observableList, { all: Array.isArray(read(observableList)) ? read(observableList).slice() : [], visible: [] });
      observableList.subscribe(function () {
        if (!filtering) {
          const state = listStates.get(observableList);
          const current = Array.isArray(read(observableList)) ? read(observableList).slice() : [];
          const overlap = state.visible.some(item => current.includes(item));
          if (!overlap && state.visible.length && current.length) {
            state.all = current;
            state.visible = [];
          }
          else {
            const previous = state.all.slice();
            const retained = previous.filter(item => hiddenItems.has(item));
            state.all = current.slice();
            for (const item of retained) if (!state.all.includes(item)) {
              const priorIndex = Math.max(0, previous.indexOf(item));
              state.all.splice(Math.min(priorIndex, state.all.length), 0, item);
            }
          }
        }
        apply();
      });
    }

    function pruneReplies(observableList, threadId) {
      subscribeToList(observableList);
      const state = listStates.get(observableList);
      const replies = state ? state.all : read(observableList);
      if (!Array.isArray(replies)) {
        return;
      }

      const kept = [];
      let changed = false;

      replies.forEach(function (reply) {
        if (isTarget(reply) || !developerReplyAllowed(threadId,
          read(reply && reply.postedByUsername), read(reply && reply.title))) {
          rememberSubtree(reply);
          totals.replies += 1;
          changed = true;
          return;
        }

        pruneReplies(reply && reply.replies, threadId);
        kept.push(reply);
      });

      if (state) state.visible = kept.slice();
      if ((changed || kept.length !== read(observableList).length) && typeof observableList === "function") {
        observableList(kept);
      }
    }

    function clearHiddenSelection() {
      if (!viewModel) {
        return;
      }

      const selected = read(viewModel.selectedPost);
      if (selected && (hiddenItems.has(selected) || isTarget(selected))) {
        if (typeof selected.isSelected === "function") {
          selected.isSelected(false);
        }
        if (typeof viewModel.selectedPost === "function") {
          viewModel.selectedPost(undefined);
        }
      }

      const expanded = read(viewModel.expandedThread);
      if (expanded && (hiddenItems.has(expanded) || isTarget(expanded))) {
        if (typeof expanded.isExpanded === "function") {
          expanded.isExpanded(false);
        }
        if (typeof viewModel.expandedThread === "function") {
          viewModel.expandedThread(undefined);
        }
      }
    }

    function apply() {
      if (filtering || !viewModel) {
        return totals;
      }

      filtering = true;
      totals = { threads: 0, replies: 0 };
      hiddenItems = new WeakSet();

      try {
        const observableThreads = viewModel.threads;
        subscribeToList(observableThreads);
        const threadState = listStates.get(observableThreads);
        const threads = threadState ? threadState.all : read(observableThreads);

        if (Array.isArray(threads)) {
          const kept = [];
          const removed = [];
          let changed = false;

          threads.forEach(function (thread, index) {
            if (isTarget(thread) || isMutedThread(thread)) {
              hiddenItems.add(thread);
              const replies = read(thread.replies);
              if (Array.isArray(replies)) {
                replies.forEach(rememberSubtree);
              }
              totals.threads += 1;
              removed.push({ thread: thread, index: index });
              changed = true;
              return;
            }

            pruneReplies(thread && thread.replies, read(thread && thread.id));
            kept.push(thread);
          });

          const previouslyVisible = threadState ? threadState.visible : read(observableThreads);
          const newlyRemoved = removed.filter(item => !previouslyVisible.length || previouslyVisible.includes(item.thread));
          if (threadState) threadState.visible = kept.slice();
          if ((changed || kept.length !== read(observableThreads).length) && typeof observableThreads === "function") {
            if (onThreadsRemoved && newlyRemoved.length) onThreadsRemoved(newlyRemoved, kept.slice());
            observableThreads(kept);
          }
        }

        clearHiddenSelection();
        return totals;
      } finally {
        filtering = false;
      }
    }

    function attach(nextViewModel) {
      viewModel = nextViewModel;
      apply();
      return Boolean(viewModel && typeof viewModel.threads === "function");
    }

    function setTargetUsernames(usernames) {
      const values = Array.isArray(usernames) ? usernames : [];
      targetUsernames = new Set(values.map(normalizeUsername).filter(Boolean));
      apply();
      return [...targetUsernames];
    }

    function setVisibility(settings) {
      const value = settings && typeof settings === "object" ? settings : {};
      if (Object.prototype.hasOwnProperty.call(value, "targetUsernames")) {
        const usernames = Array.isArray(value.targetUsernames) ? value.targetUsernames : [];
        targetUsernames = new Set(usernames.map(normalizeUsername).filter(Boolean));
      }
      if (Object.prototype.hasOwnProperty.call(value, "targetThreadIds")) {
        const ids = Array.isArray(value.targetThreadIds) ? value.targetThreadIds : [];
        targetThreadIds = new Set(ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
      }
      if (Object.prototype.hasOwnProperty.call(value, "revealHidden")) revealHidden = Boolean(value.revealHidden);
      apply();
      return { targetUsernames: [...targetUsernames], targetThreadIds: [...targetThreadIds], revealHidden };
    }

    return {
      apply: apply,
      attach: attach,
      isTarget: isTarget,
      isMutedThread: isMutedThread,
      setTargetUsernames: setTargetUsernames,
      setVisibility: setVisibility
    };
  }

  return {
    createFilter: createFilter,
    normalizeUsername: normalizeUsername,
    validDeveloperReplyTitle: validDeveloperReplyTitle,
    developerReplyAllowed: developerReplyAllowed
  };
});
