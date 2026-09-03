"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const recent = require("../recent-searches.js");

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), dump: () => Object.fromEntries(values) };
}

test("recent searches deduplicate query and scopes while preserving display text", () => {
  const local = storage();
  recent.add(local, "  Artisinal  ", ["replies", "post"], 10);
  recent.add(local, "artisinal", ["post", "replies", "post"], 20);
  recent.add(local, "user:Dog Hat", ["user"], 30);
  assert.deepEqual(recent.list(local, 30).map(item => [item.query, item.scopes]), [
    ["user:Dog Hat", ["user"]], ["artisinal", ["post", "replies"]]
  ]);
});

test("recent searches are bounded, expiring, removable and independently clearable", () => {
  const local = storage({ unrelated: "preserved" });
  for (let index = 0; index < 15; index += 1) recent.add(local, `query ${index}`, ["post"], index + 1);
  let values = recent.list(local, 15);
  assert.equal(values.length, recent.MAX_ENTRIES);
  values = recent.remove(local, values[0].id, 15);
  assert.equal(values.length, recent.MAX_ENTRIES - 1);
  assert.equal(recent.list(local, recent.MAX_AGE_MS + 100).length, 0);
  assert.equal(recent.clear(local), true);
  assert.equal(local.dump().unrelated, "preserved");
});

test("malformed, future, empty and unsupported-scope records fail safely", () => {
  const local = storage({ [recent.STORAGE_KEY]: JSON.stringify([
    null, { query: "", scopes: ["post"], savedAt: 1 },
    { query: "secret", scopes: ["admin"], savedAt: 1 },
    { query: "future", scopes: ["post"], savedAt: 100 },
    { query: "valid", scopes: ["POST", "invalid"], savedAt: 2 }
  ]) });
  assert.deepEqual(recent.list(local, 10).map(item => item.query), ["valid"]);
  local.setItem(recent.STORAGE_KEY, "not json");
  assert.deepEqual(recent.list(local, 10), []);
});
