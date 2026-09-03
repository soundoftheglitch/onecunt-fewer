"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseSearchResponse } = require("../search/ui-response.js");

test("normalises current, legacy and empty search responses", () => {
  const artisinal = [{ title: "Artisinal thread" }];
  assert.deepEqual(normaliseSearchResponse({ items: artisinal, total: 7 }), { items: artisinal, total: 7 });
  assert.deepEqual(normaliseSearchResponse({ items: artisinal, total: 1000, truncated: true }),
    { items: artisinal, total: 1000, truncated: true });
  assert.deepEqual(normaliseSearchResponse(artisinal), { items: artisinal, total: 1 });
  assert.deepEqual(normaliseSearchResponse([]), { items: [], total: 0 });
  assert.deepEqual(normaliseSearchResponse({ items: [], total: 0 }), { items: [], total: 0 });
});

test("repairs invalid totals and rejects malformed worker responses clearly", () => {
  const items = [{ title: "Artisinal thread" }];
  assert.deepEqual(normaliseSearchResponse({ items, total: undefined }), { items, total: 1 });
  assert.deepEqual(normaliseSearchResponse({ items, total: 0 }), { items, total: 1 });
  assert.throws(() => normaliseSearchResponse(undefined), /Reload the extension/);
  assert.throws(() => normaliseSearchResponse({ total: 0 }), /Reload the extension/);
});
