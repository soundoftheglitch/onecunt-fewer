const test = require("node:test");
const assert = require("node:assert/strict");
const archive = require("../archive-engine.js");

test("archives exactly 999 replies, represented by 1000 total posts", () => {
  assert.equal(archive.isArchivedReplyCount(999), true);
  assert.equal(archive.isArchivedPostCount(1000), true);
});

test("does not archive either adjacent reply-count boundary", () => {
  for (const replies of [998, 1000, "999", null, undefined]) {
    assert.equal(archive.isArchivedReplyCount(replies), false);
  }
  for (const posts of [999, 1001, "1000", null, undefined]) {
    assert.equal(archive.isArchivedPostCount(posts), false);
  }
});

test("selects a stable bounded replacement offset", () => {
  assert.equal(archive.stableIndex("2:datedesc:8,9", 100), archive.stableIndex("2:datedesc:8,9", 100));
  assert.ok(archive.stableIndex("2:datedesc:8,9", 7) >= 0);
  assert.ok(archive.stableIndex("2:datedesc:8,9", 7) < 7);
  assert.equal(archive.stableIndex("anything", 0), 0);
});
