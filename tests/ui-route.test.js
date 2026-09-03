"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const route = require("../search/ui-route.js");

test("route serialization omits defaults but preserves view-specific state", () => {
  assert.equal(route.routeUrl({ view: "search", q: "coffee", page: 1, scopes: "post,replies" }),
    "/#view=search&q=coffee&scopes=post%2Creplies");
  assert.deepEqual(route.currentViewState("#view=search&q=coffee&page=3", "search", { page: 4 }),
    { view: "search", q: "coffee", page: 4 });
  assert.deepEqual(route.currentViewState("#view=saved&page=2", "search"), { view: "search" });
});

test("author routes retain independent Posts and Replies pages", () => {
  assert.equal(route.authorPageKey("posts"), "postsPage");
  assert.equal(route.authorPageKey("replies"), "repliesPage");
  assert.deepEqual(route.authorRouteState("#view=author&user=Alice&postsPage=3", "Alice", "replies", { repliesPage: 2 }),
    { view: "author", user: "Alice", postsPage: "3", tab: "replies", repliesPage: 2 });
  assert.equal(route.authorPageFromRoute(new URLSearchParams("repliesPage=4"), "replies"), 4);
  assert.equal(route.authorPageFromRoute(new URLSearchParams("postsPage=invalid"), "posts"), 1);
});
