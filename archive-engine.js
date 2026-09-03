(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NtForumArchiveEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ARCHIVED_REPLY_COUNT = 999;
  const ARCHIVED_POST_COUNT = ARCHIVED_REPLY_COUNT + 1;

  function exactly(value, expected) {
    return typeof value === "number" && Number.isInteger(value) && value === expected;
  }

  function isArchivedReplyCount(value) {
    return exactly(value, ARCHIVED_REPLY_COUNT);
  }

  function isArchivedPostCount(value) {
    return exactly(value, ARCHIVED_POST_COUNT);
  }

  function stableIndex(value, length) {
    if (!Number.isSafeInteger(length) || length < 1) return 0;
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % length;
  }

  return { ARCHIVED_REPLY_COUNT, ARCHIVED_POST_COUNT, isArchivedReplyCount, isArchivedPostCount, stableIndex };
});
