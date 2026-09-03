(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsMemberStats = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalise(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .trim().toLocaleLowerCase();
  }
  function later(left, right) { return String(left || "") > String(right || "") ? String(left) : String(right || ""); }
  function addContribution(values, document) {
    const key = normalise(document?.username); if (!key) return values;
    const createdUtc = String(document.createdUtc || ""); const display = String(document.username || "").trim();
    const old = values.get(key) || { key, username: display, topicCount: 0, replyCount: 0,
      latestTopicUtc: "", latestReplyUtc: "", latestUsernameUtc: "" };
    if (document.kind === "t") { old.topicCount += 1; old.latestTopicUtc = later(old.latestTopicUtc, createdUtc); }
    else if (document.kind === "r") { old.replyCount += 1; old.latestReplyUtc = later(old.latestReplyUtc, createdUtc); }
    else return values;
    if (createdUtc > old.latestUsernameUtc || (createdUtc === old.latestUsernameUtc
        && display.localeCompare(old.username) < 0)) { old.username = display; old.latestUsernameUtc = createdUtc; }
    values.set(key, old); return values;
  }
  function threadContributions(documents) {
    const values = new Map(); for (const document of documents || []) addContribution(values, document); return values;
  }
  function record(value) {
    return { username: value.username, normalisedUsername: value.key, topicCount: value.topicCount,
      replyCount: value.replyCount, latestTopicUtc: value.latestTopicUtc,
      latestReplyUtc: value.latestReplyUtc, lastActiveUtc: later(value.latestTopicUtc, value.latestReplyUtc) };
  }

  class MemberStatistics {
    constructor() { this.threads = new Map(); this.users = new Map(); this.records = new Map(); }
    recompute(key) {
      const contributions = this.users.get(key);
      if (!contributions?.size) { this.users.delete(key); this.records.delete(key); return; }
      const total = { key, username: "", topicCount: 0, replyCount: 0,
        latestTopicUtc: "", latestReplyUtc: "", latestUsernameUtc: "" };
      for (const value of contributions.values()) {
        total.topicCount += value.topicCount; total.replyCount += value.replyCount;
        total.latestTopicUtc = later(total.latestTopicUtc, value.latestTopicUtc);
        total.latestReplyUtc = later(total.latestReplyUtc, value.latestReplyUtc);
        if (value.latestUsernameUtc > total.latestUsernameUtc || (value.latestUsernameUtc === total.latestUsernameUtc
            && value.username.localeCompare(total.username) < 0)) {
          total.username = value.username; total.latestUsernameUtc = value.latestUsernameUtc;
        }
      }
      this.records.set(key, record(total));
    }
    replaceThreadContributions(threadId, contributions, returnSnapshot = true) {
      const id = Number(threadId); if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("Invalid thread ID");
      const next = contributions instanceof Map ? new Map(contributions) : new Map(contributions || []);
      const previous = this.threads.get(id) || new Map(); const touched = new Set([...previous.keys(), ...next.keys()]);
      for (const key of previous.keys()) this.users.get(key)?.delete(id);
      for (const [key, value] of next) {
        if (!this.users.has(key)) this.users.set(key, new Map()); this.users.get(key).set(id, value);
      }
      if (next.size) this.threads.set(id, next); else this.threads.delete(id);
      for (const key of touched) this.recompute(key); return returnSnapshot ? this.snapshot() : null;
    }
    replaceThread(threadId, documents) { return this.replaceThreadContributions(threadId, threadContributions(documents)); }
    replaceThreads(entries) {
      const touched = new Set();
      for (const [threadId, contributions] of entries || []) {
        const id = Number(threadId); if (!Number.isSafeInteger(id) || id < 1) continue;
        const next = contributions instanceof Map ? new Map(contributions) : new Map(contributions || []);
        const previous = this.threads.get(id) || new Map();
        for (const key of [...previous.keys(), ...next.keys()]) touched.add(key);
        for (const key of previous.keys()) this.users.get(key)?.delete(id);
        for (const [key, value] of next) {
          if (!this.users.has(key)) this.users.set(key, new Map()); this.users.get(key).set(id, value);
        }
        if (next.size) this.threads.set(id, next); else this.threads.delete(id);
      }
      for (const key of touched) this.recompute(key);
      return this.snapshot();
    }
    deleteThread(threadId) { return this.replaceThreadContributions(threadId, new Map()); }
    clone() {
      const copy = new MemberStatistics(); copy.replaceThreads(this.threads); return copy;
    }
    snapshot(blockedUsernames = []) {
      const blocked = new Set((blockedUsernames || []).map(normalise).filter(Boolean));
      return [...this.records.values()].filter(value => !blocked.has(value.normalisedUsername))
        .map(value => ({ ...value })).sort((left, right) => right.lastActiveUtc.localeCompare(left.lastActiveUtc)
          || left.normalisedUsername.localeCompare(right.normalisedUsername));
    }
  }

  return { MemberStatistics, addContribution, normalise, threadContributions };
});
