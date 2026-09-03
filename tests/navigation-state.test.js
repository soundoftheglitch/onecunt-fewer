"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../navigation-state.js");

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("navigation snapshots are local, bounded, expiring and clearable", () => {
  const local = storage();
  for (let index = 0; index < 40; index += 1) state.save(local, { url: `/#view=search&q=craft&page=${index + 1}`, scrollY: index, resultKey: `r:${index}` }, index + 1);
  assert.equal(state.safeEntries(local, 40).length, state.MAX_ENTRIES);
  assert.equal(state.safeEntries(local, state.MAX_AGE_MS + 100).length, 0);
  assert.equal(state.clear(local), true);
  assert.deepEqual(state.safeEntries(local), []);
});

test("capture preserves the complete route and result position in history state", () => {
  const local = storage(); let replaced;
  const history = { state: { existing: true }, replaceState(value, _title, url) { replaced = { value, url }; } };
  const snapshot = state.capture({ storage: local, history,
    location: { pathname: "/", search: "", hash: "#view=search&q=artisinal&scopes=post&page=4" },
    scrollY: 713, resultKey: "r:88", resultIndex: 7 });
  assert.equal(replaced.url, "/#view=search&q=artisinal&scopes=post&page=4");
  assert.equal(replaced.value.existing, true);
  assert.equal(state.get(local, snapshot.key).scrollY, 713);
  assert.equal(state.get(local, snapshot.key).resultIndex, 7);
});

test("missing result anchors fail safely without moving the page", () => {
  const local = storage(); const snapshot = state.save(local,
    { url: "/#view=saved&page=3", scrollY: 640, resultKey: "t:99", resultIndex: 4 }, 10);
  let moved = false;
  assert.equal(state.restore({ storage: local, key: snapshot.key,
    document: { querySelector: () => null }, window: { scrollTo: () => { moved = true; } } }), false);
  assert.equal(moved, false);
});
