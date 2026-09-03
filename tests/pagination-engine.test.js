const test = require("node:test");
const assert = require("node:assert/strict");
const { clampPage, formatPage, pageFromUrl, urlForPage, createPageState, normaliseRows, pageForAnchor, fitRows, normaliseMode } = require("../pagination-engine.js");

test("formats one-digit pages with a leading zero", () => {
  assert.equal(formatPage(1), "01");
  assert.equal(formatPage(9), "09");
  assert.equal(formatPage(10), "10");
  assert.equal(formatPage(123), "123");
});

test("normalises persisted density and preserves the first visible result", () => {
  assert.equal(normaliseRows("auto"), "auto");
  assert.equal(normaliseRows("20"), 20);
  assert.equal(normaliseRows("17"), "auto");
  assert.equal(pageForAnchor(4, 25, 10), 8);
  assert.equal(pageForAnchor(8, 10, 25), 3);
});

test("canonicalises legacy pagination modes to always-visible page controls", () => {
  assert.equal(normaliseMode(), "pages");
  assert.equal(normaliseMode("incremental"), "pages");
  assert.equal(normaliseMode("pages"), "pages");
  assert.equal(normaliseMode("untrusted"), "pages");
});

test("auto density selects whole rows without exceeding the available area", () => {
  assert.equal(fitRows(219, [40, 40, 41], 50), 5);
  assert.equal(fitRows(1000, [40], 25), 25);
  assert.equal(fitRows(10, [40], 25), 1);
});

test("validates bounded one-based page input", () => {
  assert.equal(clampPage(" 4 ", 20), 4);
  assert.equal(clampPage("0", 20), null);
  assert.equal(clampPage("999", 20), null);
  assert.equal(clampPage("2.5", 20), null);
  assert.equal(clampPage("hello", 20), null);
  assert.equal(clampPage("", 20), null);
});

test("round-trips list pages without disturbing other query values or hashes", () => {
  assert.equal(urlForPage("https://ntforum.net/?sort=date#page=4", 7), "/?sort=date#page=7");
  assert.equal(urlForPage("https://ntforum.net/?sort=date#page=4", 1), "/?sort=date");
  assert.equal(pageFromUrl("https://ntforum.net/#page=0", 50), 1);
  assert.equal(pageFromUrl("https://ntforum.net/#page=999", 50), 1);
});

test("preserves view-specific hash query state while changing only its page", () => {
  const route = { mode: "hash-params", pageKey: "page" };
  const source = "https://ntforum.net/#view=search&q=artisinal&sort=newest&page=4";
  assert.equal(urlForPage(source, 7, route), "/#view=search&q=artisinal&sort=newest&page=7");
  assert.equal(urlForPage(source, 1, route), "/#view=search&q=artisinal&sort=newest");
  assert.equal(pageFromUrl(source, 12, route), 4);
});

test("keeps author Posts and Replies page parameters independent", () => {
  const source = "https://ntforum.net/#view=author&user=Alice&tab=posts&sort=newest&postsPage=4&repliesPage=7";
  assert.equal(urlForPage(source, 5, { mode: "hash-params", pageKey: "postsPage" }),
    "/#view=author&user=Alice&tab=posts&sort=newest&postsPage=5&repliesPage=7");
  assert.equal(urlForPage(source, 9, { mode: "hash-params", pageKey: "repliesPage" }),
    "/#view=author&user=Alice&tab=posts&sort=newest&postsPage=4&repliesPage=9");
  assert.equal(pageFromUrl(source, 12, { mode: "hash-params", pageKey: "postsPage" }), 4);
  assert.equal(pageFromUrl(source, 12, { mode: "hash-params", pageKey: "repliesPage" }), 7);
});

test("central page state validates navigation and owns URL/history behavior", () => {
  let current = 2;
  const calls = [];
  const history = {
    pushState(state, _title, url) { calls.push(["push", state, url]); },
    replaceState(state, _title, url) { calls.push(["replace", state, url]); }
  };
  const state = createPageState({ page: () => current, pages: () => 12,
    onPage: page => { current = page; }, history, location: { href: "https://ntforum.net/#view=unloved&sort=oldest&page=2" },
    route: { mode: "hash-params" }, historyState: { fewercuntsView: "unloved" } });
  assert.equal(state.navigate(""), false);
  assert.equal(state.navigate("2.5"), false);
  assert.equal(state.navigate(13), false);
  assert.deepEqual(calls, []);
  assert.equal(state.navigate(10), true);
  assert.equal(current, 10);
  assert.deepEqual(calls[0], ["push", { fewercuntsView: "unloved", fewercuntsPage: 10 },
    "/#view=unloved&sort=oldest&page=10"]);
  assert.equal(state.navigate(1, "replace"), true);
  assert.deepEqual(calls[1].slice(0, 2), ["replace", { fewercuntsView: "unloved", fewercuntsPage: 1 }]);
  assert.equal(calls[1][2], "/#view=unloved&sort=oldest");
});
