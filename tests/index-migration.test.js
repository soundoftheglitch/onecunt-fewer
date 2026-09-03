"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { IndexMigrationCoordinator } = require("../search/index-migration.js");

class State {
  constructor(value = {}) { this.value = { phase: "pending", cleared: false, pendingThreadIds: [], ...value }; }
  async get() { return structuredClone(this.value); }
  async put(value) { this.value = structuredClone(value); return this.get(); }
}
class Legacy {
  constructor(schemaVersion, phase = "complete") {
    this.status = { schemaVersion, phase, cancelled: phase === "paused" }; this.retired = false;
    this.items = new Map([[7, { thread: { threadId: 7, root: { docKey: "t:7" },
      lastPostUtc: "2026-09-01T01:00:00Z", advertisedPostCount: 2 }, replies: [{ docKey: "r:8" }] }]]);
  }
  async getSync() { return this.status; }
  async getSettings() { return { enabled: true, refreshMinutes: 15 }; }
  async migrationSnapshot() { return [...this.items.values()]; }
  async migrationThread(id) { return this.items.get(id); }
  async retireSearchPostings() { this.retired = true; }
}
class Manager {
  constructor() { this.active = null; this.installs = 0; }
  async startup() { return this.active ? { phase: "ready", active: this.active } : { phase: "empty" }; }
  async install() { this.installs += 1; this.active = { generationId: "v1-good", watermark: "2026-09-01T00:00:00Z" };
    return { phase: "ready", active: this.active }; }
}
class Delta {
  constructor(failOnce = false) { this.ids = []; this.failOnce = failOnce; }
  async replaceThread(thread) { if (this.failOnce) { this.failOnce = false; throw new Error("interrupted"); } this.ids.push(thread.threadId); }
}
const query = (valid = true) => ({ search: async () => valid ? { items: [{}], total: 4 } : { items: [], total: 0 } });
const coordinator = (schema, options = {}) => {
  const state = options.state || new State(); const legacy = options.legacy || new Legacy(schema);
  const manager = options.manager || new Manager(); const delta = options.delta || new Delta();
  return { state, legacy, manager, delta, migration: new IndexMigrationCoordinator({ state, legacy,
    compactManager: manager, compiledQuery: options.query || query(), delta,
    now: () => "2026-09-01T02:00:00Z" }) };
};

for (const schema of [2, 3, 7]) test(`migrates schema-${schema} without forum ingestion`, async () => {
  const fixture = coordinator(schema); const result = await fixture.migration.run();
  assert.equal(result.phase, "complete"); assert.equal(result.legacySchemaVersion, schema);
  assert.deepEqual(fixture.delta.ids, [7]); assert.equal(fixture.legacy.retired, true);
});

test("interrupted migration resumes its durable pending list after restart", async () => {
  const state = new State(); const manager = new Manager(); const legacy = new Legacy(3); const delta = new Delta(true);
  await assert.rejects(coordinator(3, { state, manager, legacy, delta }).migration.run(), /interrupted/);
  assert.deepEqual((await state.get()).pendingThreadIds, [7]);
  const restarted = coordinator(3, { state, manager, legacy, delta });
  assert.equal((await restarted.migration.run()).phase, "complete"); assert.deepEqual(delta.ids, [7]);
});

test("failed smoke test rolls back without retiring the searchable legacy generation", async () => {
  const fixture = coordinator(3, { query: query(false) });
  await assert.rejects(fixture.migration.run(), /smoke test/);
  assert.equal(fixture.legacy.retired, false); assert.equal((await fixture.state.get()).phase, "smoke-testing");
});

test("compiled smoke test uses the query engine's default scopes", async () => {
  let receivedScopes = "not called";
  const fixture = coordinator(3, { query: { search: async (_query, _limit, scopes) => {
    receivedScopes = scopes;
    return { items: [{}], total: 4 };
  } } });
  assert.equal((await fixture.migration.run()).phase, "complete");
  assert.equal(receivedScopes, undefined);
});

test("explicit pause and clear survive restart and perform no download", async () => {
  const pausedLegacy = new Legacy(3, "paused"); const paused = coordinator(3, { legacy: pausedLegacy });
  assert.equal((await paused.migration.run()).phase, "paused"); assert.equal(paused.manager.installs, 0);
  const state = new State({ phase: "cleared", cleared: true }); const cleared = coordinator(3, { state });
  assert.equal((await cleared.migration.run()).phase, "cleared"); assert.equal(cleared.manager.installs, 0);
});

test("pause returns immediately during an active install and prevents retirement", async () => {
  let release;
  const manager = new Manager();
  manager.install = async () => new Promise(resolve => { release = () => {
    manager.active = { generationId: "v1-good", watermark: "2026-09-01T00:00:00Z" };
    resolve({ phase: "ready", active: manager.active });
  }; });
  const fixture = coordinator(7, { manager }); const running = fixture.migration.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fixture.migration.pause()).phase, "paused");
  release();
  assert.equal((await running).phase, "paused");
  assert.equal(fixture.legacy.retired, false);
});

test("pause during final legacy retirement cannot be overwritten by completion", async () => {
  let release; const legacy = new Legacy(7);
  legacy.retireSearchPostings = async () => new Promise(resolve => { release = resolve; });
  const fixture = coordinator(7, { legacy }); const running = fixture.migration.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fixture.migration.pause()).phase, "paused"); release();
  assert.equal((await running).phase, "paused");
});

test("completed spotless-boot profile reopens without migration or download", async () => {
  const state = new State({ phase: "complete", activeGenerationId: "v1-good", completedUtc: "earlier" });
  const manager = new Manager(); manager.active = { generationId: "v1-good", watermark: "2026-09-01T00:00:00Z" };
  const fixture = coordinator(7, { state, manager }); const result = await fixture.migration.run();
  assert.equal(result.phase, "complete"); assert.equal(manager.installs, 0); assert.equal(fixture.legacy.retired, false);
});
