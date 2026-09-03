const test = require("node:test");
const assert = require("node:assert/strict");
const { createFilter, normalizeUsername, validDeveloperReplyTitle } = require("../filter-engine.js");

function observable(initialValue) {
  let value = initialValue;
  const subscribers = [];
  function result(nextValue) {
    if (arguments.length) {
      value = nextValue;
      subscribers.slice().forEach((subscriber) => subscriber(value));
      return result;
    }
    return value;
  }
  result.subscribe = (subscriber) => {
    subscribers.push(subscriber);
  };
  return result;
}

function reply(id, author, children = [], title = "") {
  return {
    id: observable(id),
    postedByUsername: observable(author),
    title: observable(title),
    replies: observable(children),
    isSelected: observable(false)
  };
}

function thread(id, author, replies = []) {
  return {
    id: observable(id),
    postedByUsername: observable(author),
    replies: observable(replies),
    isExpanded: observable(false),
    isSelected: observable(false)
  };
}

function viewModel(threads) {
  return {
    threads: observable(threads),
    selectedPost: observable(undefined),
    expandedThread: observable(undefined)
  };
}

test("normalizes usernames case-insensitively and trims whitespace", () => {
  assert.equal(normalizeUsername("  SOULISDEAD "), "soulisdead");
});

test("accepts only strict version plus real UTC date developer titles", () => {
  for (const title of ["7.0.20+20260801", "8.0.10+20260901", "7.0.36+20260229"]) {
    assert.equal(validDeveloperReplyTitle(title), title !== "7.0.36+20260229");
  }
  for (const title of ["Re: 8.0.10+20260901", "8.0.10 + 20260901", "8.0+20260901",
    "8.0.10+20261301", "8.0.10+20260229", "8.0.10+19991231", "8.0.10+20260901 extra"]) {
    assert.equal(validDeveloperReplyTitle(title), false, title);
  }
});

test("developer thread keeps dog hat or strict release replies and removes invalid descendant branches", () => {
  const owner = reply(1, " DOG HAT ", [], "anything");
  const release = reply(2, "Alice", [], "7.0.20+20260801");
  const hidden = reply(3, "Bob", [reply(4, "dog hat", [], "anything")], "Re: 8.0.10+20260901");
  const developer = thread(15249, "dog hat", [owner, release, hidden]);
  const ordinaryInvalid = reply(5, "Bob", [], "ordinary subject");
  const ordinary = thread(99, "Alice", [ordinaryInvalid]);
  createFilter().attach(viewModel([developer, ordinary]));
  assert.deepEqual(developer.replies(), [owner, release]);
  assert.deepEqual(ordinary.replies(), [ordinaryInvalid]);
});

test("does not block anyone when no username list is configured", () => {
  const allowed = thread(1, "Soulisdead");
  const vm = viewModel([allowed]);

  createFilter().attach(vm);

  assert.deepEqual(vm.threads(), [allowed]);
});

test("removes target-authored threads completely", () => {
  const blocked = thread(1, "Soulisdead", [reply(10, "Alice")]);
  const allowed = thread(2, "Alice");
  const vm = viewModel([blocked, allowed]);

  createFilter({ targetUsernames: ["Soulisdead"] }).attach(vm);

  assert.deepEqual(vm.threads(), [allowed]);
});

test("removes threads from every configured username", () => {
  const soulisdead = thread(1, "Soulisdead");
  const monkeybutler = thread(2, " MONKEYBUTLER ");
  const allowed = thread(3, "Alice");
  const vm = viewModel([soulisdead, monkeybutler, allowed]);

  createFilter({ targetUsernames: ["Soulisdead", "monkeybutler"] }).attach(vm);

  assert.deepEqual(vm.threads(), [allowed]);
});

test("reports exact blocked thread slots for deterministic backfill", () => {
  const first = thread(1, "Alice");
  const blockedOne = thread(2, "Soulisdead");
  const middle = thread(3, "Bob");
  const blockedTwo = thread(4, "monkeybutler");
  const last = thread(5, "Cara");
  const vm = viewModel([first, blockedOne, middle, blockedTwo, last]);
  let report;
  createFilter({ targetUsernames: ["Soulisdead", "monkeybutler"],
    onThreadsRemoved: (removed, kept) => { report = { removed, kept }; } }).attach(vm);
  assert.deepEqual(report.removed.map(item => item.index), [1, 3]);
  assert.deepEqual(report.removed.map(item => item.thread), [blockedOne, blockedTwo]);
  assert.deepEqual(report.kept, [first, middle, last]);
});

test("removes a target reply and its entire descendant subtree", () => {
  const hiddenGrandchild = reply(4, "Charlie");
  const hiddenChild = reply(3, "Bob", [hiddenGrandchild]);
  const blocked = reply(2, "sOuLiSdEaD", [hiddenChild]);
  const visibleChild = reply(5, "Dana");
  const visible = reply(1, "Alice", [blocked, visibleChild]);
  const rootThread = thread(100, "Alice", [visible]);
  const vm = viewModel([rootThread]);

  createFilter({ targetUsernames: ["Soulisdead"] }).attach(vm);

  assert.deepEqual(rootThread.replies(), [visible]);
  assert.deepEqual(visible.replies(), [visibleChild]);
});

test("removes a monkeybutler reply and its entire descendant subtree", () => {
  const blocked = reply(2, "MonkeyButler", [reply(3, "Bob")]);
  const allowed = reply(4, "Alice");
  const rootThread = thread(100, "Alice", [blocked, allowed]);
  const vm = viewModel([rootThread]);

  createFilter({ targetUsernames: ["Soulisdead", "monkeybutler"] }).attach(vm);

  assert.deepEqual(rootThread.replies(), [allowed]);
});

test("reactively filters replies loaded after attachment", () => {
  const rootThread = thread(100, "Alice");
  const vm = viewModel([rootThread]);
  createFilter({ targetUsernames: ["Soulisdead"] }).attach(vm);

  const allowed = reply(1, "Alice");
  rootThread.replies([reply(2, "Soulisdead", [reply(3, "Bob")]), allowed]);

  assert.deepEqual(rootThread.replies(), [allowed]);
});

test("reactively filters a newly loaded page of threads", () => {
  const vm = viewModel([]);
  createFilter({ targetUsernames: ["Soulisdead"] }).attach(vm);
  const allowed = thread(2, "Alice");

  vm.threads([thread(1, " Soulisdead "), allowed]);

  assert.deepEqual(vm.threads(), [allowed]);
});

test("clears a selected descendant when its blocked ancestor is removed", () => {
  const selected = reply(3, "Alice");
  selected.isSelected(true);
  const blocked = reply(2, "Soulisdead", [selected]);
  const rootThread = thread(1, "Alice", [blocked]);
  const vm = viewModel([rootThread]);
  vm.selectedPost(selected);

  createFilter({ targetUsernames: ["Soulisdead"] }).attach(vm);

  assert.equal(vm.selectedPost(), undefined);
  assert.equal(selected.isSelected(), false);
});

test("editable targets remove and restore roots and complete reply subtrees immediately", () => {
  const descendant = reply(3, "Bob");
  const targetReply = reply(2, "Alice", [descendant]);
  const targetThread = thread(10, "Alice");
  const allowedThread = thread(11, "Cara", [targetReply, reply(4, "Dana")]);
  const vm = viewModel([targetThread, allowedThread]);
  const reports = [];
  const filter = createFilter({ targetUsernames: [], onThreadsRemoved: removed => reports.push(removed) });
  filter.attach(vm);

  filter.setTargetUsernames([" alice "]);
  assert.deepEqual(vm.threads(), [allowedThread]);
  assert.deepEqual(allowedThread.replies().map(item => item.id()), [4]);
  assert.equal(reports.length, 1);

  filter.setTargetUsernames([]);
  assert.deepEqual(vm.threads(), [targetThread, allowedThread]);
  assert.deepEqual(allowedThread.replies(), [targetReply, allowedThread.replies()[1]]);
  assert.deepEqual(targetReply.replies(), [descendant]);
});

test("a newly loaded page replaces retained hidden roots from the prior page", () => {
  const oldBlocked = thread(1, "Alice"); const oldVisible = thread(2, "Bob");
  const vm = viewModel([oldBlocked, oldVisible]); const filter = createFilter({ targetUsernames: ["Alice"] });
  filter.attach(vm); assert.deepEqual(vm.threads(), [oldVisible]);
  const nextVisible = thread(3, "Cara"); const nextBlocked = thread(4, "Alice");
  vm.threads([nextVisible, nextBlocked]);
  assert.deepEqual(vm.threads(), [nextVisible]);
  filter.setTargetUsernames([]);
  assert.deepEqual(vm.threads(), [nextVisible, nextBlocked]);
});

test("muted roots hide complete threads and temporary reveal restores them without changing configuration", () => {
  const muted = thread(10, "Alice", [reply(11, "Bob")]);
  const blocked = thread(20, "Soulisdead");
  const visible = thread(30, "Cara");
  const vm = viewModel([muted, blocked, visible]);
  const filter = createFilter({ targetUsernames: ["Soulisdead"], targetThreadIds: [10] });
  filter.attach(vm);
  assert.deepEqual(vm.threads(), [visible]);

  const revealed = filter.setVisibility({ revealHidden: true });
  assert.deepEqual(vm.threads(), [muted, blocked, visible]);
  assert.deepEqual(revealed.targetThreadIds, [10]);
  assert.deepEqual(revealed.targetUsernames, ["soulisdead"]);

  filter.setVisibility({ revealHidden: false });
  assert.deepEqual(vm.threads(), [visible]);
  filter.setVisibility({ targetThreadIds: [] });
  assert.deepEqual(vm.threads(), [muted, visible]);
});
