(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsAbout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const README = Object.freeze([
    { heading: "What fewerCunts adds", paragraphs: [
      "fewerCunts upgrades NTForum without changing the forum server. It keeps the original visual language while adding editable blocking, muted and saved threads, unread state, reply notifications, modern pagination, responsive row density, author views, Unloved threads and full-forum search."
    ] },
    { heading: "Navigation", paragraphs: [
      "Home returns to the current Classic thread list. User contains account actions, the editable Block list, notifications and private settings transfer. New Topic opens the native composer. View contains Classic, Unread, Saved, Muted and Unloved. Search opens the local search controls. Rows changes list density across supported views."
    ] },
    { heading: "Blocking, saving and muting", paragraphs: [
      "Soulisdead and monkeybutler are initial Block-list defaults, not mandatory blocks: remove either or both, keep an empty list, or restore them with Reset defaults. Blocking hides an author's roots and reply subtrees. S and M beside a thread mean Save and Mute; their full action appears on hover or keyboard focus."
    ] },
    { heading: "Search and local data", paragraphs: [
      "Search uses a signed compact forum index downloaded from the project's GitHub releases, then applies a small recent delta. Posts and replies have an editable local category; replies inherit their thread unless overridden, and category: filters combine with ordinary local searches. The index, category overrides and preferences remain on this device."
    ] },
    { heading: "Privacy and recovery", paragraphs: [
      "Settings export contains only supported preferences. It excludes post bodies, email addresses, search history, browser history, read history, notifications, drafts and index contents. Import is parsed locally; the Choose file dialog never uploads the file. Clearing extension/site storage or uninstalling the extension can remove device-local state."
    ] },
    { heading: "Compatibility", paragraphs: [
      "The extension targets current Chromium and Firefox builds of NTForum. It uses the forum's native account and posting actions; it does not grant administrative access or alter server permissions. Threads with exactly 999 replies are presented as Archived and cannot be replied to through the extension."
    ] }
  ]);

  const HISTORY = Object.freeze([
    ["4.5.2", "2026-09-04", "Replaced the technical README with a beginner-first installation, verification, recovery, update, privacy and uninstall guide."],
    ["4.5.1", "2026-09-03", "Plugin deep links now reveal only after their rendered view is ready instead of remaining behind the Classic startup mask."],
    ["4.5.0", "2026-09-03", "Clean first release with the refactored signed catalogue, modular UI lifecycle, local search, categories and privacy boundary."]
  ]);

  return { README, HISTORY };
});
