"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lifecycle = require("../search/dom-lifecycle.js");

test("collect retries the owning decorated container when asynchronous descendants arrive", () => {
  const post = { nodeType: 1, matches: value => value === ".post", closest: () => null, querySelectorAll: () => [] };
  const message = { nodeType: 1, matches: () => false, closest: value => value === ".post" ? post : null, querySelectorAll: () => [] };
  const root = { contains: node => node === post, querySelectorAll: () => [post] };
  assert.deepEqual(lifecycle.collect(root, ".post", []), [post]);
  assert.deepEqual(lifecycle.collect(root, ".post", [{ target: message, addedNodes: [] }]), [post]);
});

test("collect deduplicates matching targets and newly added descendants", () => {
  const post = { nodeType: 1, matches: value => value === ".post", closest: () => null, querySelectorAll: () => [] };
  const wrapper = { nodeType: 1, matches: () => false, closest: () => null, querySelectorAll: () => [post] };
  const root = { contains: () => true, querySelectorAll: () => [] };
  assert.deepEqual(lifecycle.collect(root, ".post", [{ target: post, addedNodes: [wrapper, post] }]), [post]);
});
