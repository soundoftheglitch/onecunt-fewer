"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const transfer = require("../local-settings-transfer.js");

const settings = { legacyTheme: { mode: "dark", token: "secret" }, blockedUsernames: ["Alice", "alice", "Bob"],
  pagination: { rows: 25, mode: "incremental", route: "private" },
  search: { autoUpdate: true, refreshMinutes: 60, fullReconcileDays: 7, replyReconcileDays: 30, query: "secret" } };
const index = { phase: "complete", source: "compiled", generationId: "sha256-abc", documents: 20, threads: 4,
  lastUpdatedUtc: "2026-09-01T00:00:00.000Z", body: "must not export", email: "no@example.test" };

test("creates a versioned whitelist-only settings export", () => {
  const value = transfer.create(settings, index, new Date("2026-09-01T01:00:00.000Z"));
  assert.equal(value.schema, transfer.SCHEMA); assert.equal(value.version, 3);
  assert.deepEqual(value.settings.blockedUsernames, ["Alice", "Bob"]);
  assert.equal(value.settings.pagination.mode, "pages");
  assert.equal(JSON.stringify(value).includes("secret"), false);
  assert.equal(JSON.stringify(value).includes("example.test"), false);
  assert.equal(value.settings.theme, undefined);
  assert.deepEqual(value.index, { phase: "complete", source: "compiled", generationId: "sha256-abc",
    documents: 20, threads: 4, lastUpdatedUtc: "2026-09-01T00:00:00.000Z" });
});

test("parses only supported validated files and strips unknown fields", () => {
  const raw = transfer.create(settings, index);
  raw.privateBrowserData = { history: ["x"] }; raw.settings.drafts = [{ body: "x" }];
  const parsed = transfer.parse(JSON.stringify(raw));
  assert.equal(parsed.privateBrowserData, undefined); assert.equal(parsed.settings.drafts, undefined);
  assert.match(transfer.summary(parsed), /informational/);
});

test("fails safely for malformed, unsupported, oversized and invalid input", () => {
  assert.throws(() => transfer.parse("not json"), /valid JSON/);
  assert.throws(() => transfer.parse(JSON.stringify({ schema: transfer.SCHEMA, version: 99 })), /Unsupported settings version/);
  assert.throws(() => transfer.parse("x".repeat(transfer.MAX_BYTES + 1)), /64 KiB/);
  const raw = transfer.create(settings, index); raw.settings.search.refreshMinutes = 1;
  assert.throws(() => transfer.parse(JSON.stringify(raw)), /refresh interval/);
  raw.settings.search.refreshMinutes = 60; raw.settings.blockedUsernames = ["\u0000bad"];
  assert.throws(() => transfer.parse(JSON.stringify(raw)), /blocked username/);
});
