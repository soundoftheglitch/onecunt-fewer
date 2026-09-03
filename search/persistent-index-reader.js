(function (root, factory) {
  const contract = typeof module === "object" && module.exports
    ? require("./persistent-index-contract.js") : root.FewerCuntsPersistentIndexContract;
  const storageApi = typeof module === "object" && module.exports
    ? require("./persistent-index-storage.js") : root.FewerCuntsPersistentIndexStorage;
  const memberApi = typeof module === "object" && module.exports
    ? require("./member-stats.js") : root.FewerCuntsMemberStats;
  const unansweredApi = typeof module === "object" && module.exports
    ? require("./unanswered-state.js") : root.FewerCuntsUnansweredState;
  const api = factory(contract, storageApi, memberApi, unansweredApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsPersistentIndexReader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract, storageApi, memberApi, unansweredApi) {
  "use strict";

  const MAGIC = [0x4e, 0x54, 0x46, 0x53, 0x49, 0x44, 0x58, 0x00];
  const HEADER_BYTES = 44;
  const FOOTER_BYTES = 32;
  const WINDOW_BYTES = contract.MAX_READ_BYTES;
  const FIELDS = ["user", "title", "body"];
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function equalBytes(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  class WindowCursor {
    constructor(storage, generationId, totalBytes, position = 0, windowLoader = null) {
      this.storage = storage; this.generationId = generationId; this.totalBytes = totalBytes;
      this.position = position; this.window = null; this.windowStart = -1; this.windowLoader = windowLoader;
    }
    ensure() {
      if (this.position >= this.totalBytes) throw new Error("Truncated compact index");
      if (this.window && this.position >= this.windowStart
          && this.position < this.windowStart + this.window.byteLength) return null;
      const start = Math.floor(this.position / WINDOW_BYTES) * WINDOW_BYTES;
      const length = Math.min(WINDOW_BYTES, this.totalBytes - start);
      const loading = this.windowLoader
        ? this.windowLoader(start, length) : this.storage.read(this.generationId, start, length);
      return Promise.resolve(loading).then(value => {
        this.windowStart = start;
        this.window = value instanceof Uint8Array ? value : new Uint8Array(value);
      });
    }
    byte() {
      const loading = this.ensure();
      if (loading) return loading.then(() => this.byte());
      return this.window[this.position++ - this.windowStart];
    }
    varint(value = 0, shift = 0, count = 0) {
      for (; count < 10; count += 1) {
        const loading = this.ensure();
        if (loading) return loading.then(() => this.varint(value, shift, count));
        const byte = this.window[this.position++ - this.windowStart]; value += (byte & 0x7f) * (2 ** shift);
        if (!Number.isSafeInteger(value)) throw new Error("Oversized compact-index varint");
        if (!(byte & 0x80)) return value;
        shift += 7;
      }
      throw new Error("Oversized compact-index varint");
    }
    bytes(length) {
      if (!Number.isSafeInteger(length) || length < 0 || this.position > this.totalBytes - length) {
        throw new Error("Compact-index field outside bounds");
      }
      const output = new Uint8Array(length); let written = 0;
      const read = () => {
        while (written < length) {
          const loading = this.ensure();
          if (loading) return loading.then(read);
        const available = Math.min(length - written, this.windowStart + this.window.byteLength - this.position);
        output.set(this.window.subarray(this.position - this.windowStart,
          this.position - this.windowStart + available), written);
        this.position += available; written += available;
        }
        return output;
      };
      return read();
    }
    blob({ decode = false } = {}) {
      const finish = length => {
        const value = this.bytes(length);
        if (value?.then) return value.then(data => decode ? decoder.decode(data) : data);
        return decode ? decoder.decode(value) : value;
      };
      const length = this.varint();
      return length?.then ? length.then(finish) : finish(length);
    }
    skipBlob() {
      const skip = length => {
        if (!Number.isSafeInteger(length) || length < 0 || this.position > this.totalBytes - length) {
          throw new Error("Compact-index field outside bounds");
        }
        this.position += length;
      }
      const length = this.varint();
      return length?.then ? length.then(skip) : skip(length);
    }
  }

  class PersistentIndexReader {
    constructor({ storage, cryptoImpl = crypto } = {}) {
      if (!storage) throw new Error("Persistent index storage is required");
      this.storage = storage; this.crypto = cryptoImpl; this.opened = null; this.windowCache = new Map();
    }

    async window(start, length) {
      if (this.windowCache.has(start)) {
        const value = this.windowCache.get(start); this.windowCache.delete(start); this.windowCache.set(start, value); return value;
      }
      const value = new Uint8Array(await this.storage.read(this.openingGenerationId
        || this.opened?.generation.generationId, start, length));
      this.windowCache.set(start, value);
      while (this.windowCache.size > 64) this.windowCache.delete(this.windowCache.keys().next().value);
      return value;
    }

    async verifyChunks(generation) {
      for (let index = 0; index < generation.chunks.length; index += 1) {
        const data = await this.storage.readChunk(generation.generationId, index);
        const actual = await storageApi.sha256(data, this.crypto);
        if (actual !== generation.chunks[index].sha256) throw new Error(`Persistent index checksum mismatch in chunk ${index}`);
      }
    }

    async open(generationId) {
      const generation = await this.storage.generation(generationId);
      if (!generation || generation.state !== "complete") throw new Error("Complete persistent generation is unavailable");
      await this.verifyChunks(generation);
      this.windowCache.clear(); this.openingGenerationId = generationId;
      const header = new Uint8Array(await this.storage.read(generationId, 0, HEADER_BYTES));
      if (!equalBytes(Array.from(header.subarray(0, 8)), MAGIC)) throw new Error("Unsupported compact-index header");
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const version = view.getUint16(8, true); const flags = view.getUint16(10, true);
      const documentCount = view.getUint32(12, true); const termCount = view.getUint32(16, true);
      const watermarkBytes = view.getUint32(20, true); const reserved = view.getUint32(24, true);
      const metadataOffset = Number(view.getBigUint64(28, true));
      const lexiconOffset = Number(view.getBigUint64(36, true));
      if (version !== contract.SOURCE_SCHEMA_VERSION || flags || reserved
          || documentCount !== generation.documentCount || termCount !== generation.termCount
          || metadataOffset !== HEADER_BYTES + watermarkBytes
          || metadataOffset > lexiconOffset || lexiconOffset > generation.bytes - FOOTER_BYTES) {
        throw new Error("Invalid compact-index structure");
      }
      const watermark = decoder.decode(new Uint8Array(await this.storage.read(generationId, HEADER_BYTES, watermarkBytes)));
      if (watermark !== generation.watermark) throw new Error("Compact-index watermark mismatch");
      const cursor = new WindowCursor(this.storage, generationId, generation.bytes - FOOTER_BYTES,
        metadataOffset, (start, length) => this.window(start, length));
      const documents = new Map(); const catalogue = new Map(); const memberThreads = new Map();
      const conversationBuilder = new unansweredApi.ConversationBuilder();
      let previousId = 0; let threadCount = 0;
      const addMember = (id, document) => {
        if (!memberThreads.has(id)) memberThreads.set(id, new Map());
        memberApi.addContribution(memberThreads.get(id), document);
      };
      for (let index = 0; index < documentCount; index += 1) {
        const recordOffset = cursor.position; let delta = cursor.varint();
        if (delta?.then) delta = await delta;
        const id = previousId + delta;
        if (!delta || !Number.isSafeInteger(id)) throw new Error("Invalid compact-index document order");
        previousId = id; documents.set(id, recordOffset);
        let threadId = cursor.varint(); if (threadId?.then) threadId = await threadId;
        let parentId = cursor.varint(); if (parentId?.then) parentId = await parentId;
        let kind = cursor.byte(); if (kind?.then) kind = await kind;
        if (kind > 1) throw new Error("Invalid compact-index document kind");
        if (kind === 0) {
          threadCount += 1;
          let username = cursor.blob({ decode: true }); if (username?.then) username = await username;
          let title = cursor.blob({ decode: true }); if (title?.then) title = await title;
          let value = cursor.skipBlob(); if (value?.then) await value;
          let createdUtc = cursor.blob({ decode: true }); if (createdUtc?.then) createdUtc = await createdUtc;
          let canonicalUrl = cursor.blob({ decode: true }); if (canonicalUrl?.then) canonicalUrl = await canonicalUrl;
          catalogue.set(threadId, { docKey: `t:${id}`, postId: id, threadId, parentPostId: parentId || null,
            kind: "t", username, title, body: "", createdUtc, lastPostUtc: createdUtc,
            replyCount: 0, canonicalUrl });
          addMember(threadId, { kind: "t", username, createdUtc });
          conversationBuilder.add({ docKey: `t:${id}`, postId: id, threadId, parentPostId: null,
            kind: "t", username, title, body: "", createdUtc, canonicalUrl });
        } else {
          let username = cursor.blob({ decode: true }); if (username?.then) username = await username;
          let title = cursor.blob({ decode: true }); if (title?.then) title = await title;
          let body = cursor.blob({ decode: true }); if (body?.then) body = await body;
          let createdUtc = cursor.blob({ decode: true }); if (createdUtc?.then) createdUtc = await createdUtc;
          let canonicalUrl = cursor.blob({ decode: true }); if (canonicalUrl?.then) canonicalUrl = await canonicalUrl;
          addMember(threadId, { kind: "r", username, createdUtc });
          conversationBuilder.add({ docKey: `r:${id}`, postId: id, threadId, parentPostId: parentId || null,
            kind: "r", username, title, body, createdUtc, canonicalUrl });
          const root = catalogue.get(threadId);
          if (root) {
            root.replyCount += 1;
            if (createdUtc > root.lastPostUtc) root.lastPostUtc = createdUtc;
          }
        }
        if (cursor.position > lexiconOffset) throw new Error("Compact-index metadata crosses lexicon boundary");
      }
      if (cursor.position !== lexiconOffset) throw new Error("Compact-index metadata boundary mismatch");
      const lexicon = new Map(); let previousTerm = ""; let maximumPostingEnd = 0;
      for (let index = 0; index < termCount; index += 1) {
        let fieldId = cursor.byte(); if (fieldId?.then) fieldId = await fieldId;
        let stop = cursor.byte(); if (stop?.then) stop = await stop;
        let common = cursor.varint(); if (common?.then) common = await common;
        let suffix = cursor.blob({ decode: true }); if (suffix?.then) suffix = await suffix;
        let documentFrequency = cursor.varint(); if (documentFrequency?.then) documentFrequency = await documentFrequency;
        let postingOffset = cursor.varint(); if (postingOffset?.then) postingOffset = await postingOffset;
        let postingBytes = cursor.varint(); if (postingBytes?.then) postingBytes = await postingBytes;
        if (fieldId >= FIELDS.length || stop > 1 || common > previousTerm.length || !documentFrequency || !postingBytes) {
          throw new Error("Invalid compact-index lexicon entry");
        }
        const term = previousTerm.slice(0, common) + suffix;
        const key = `${FIELDS[fieldId]}\u0000${term}`;
        if (lexicon.has(key)) throw new Error("Duplicate compact-index term");
        lexicon.set(key, { field: FIELDS[fieldId], term, stop: Boolean(stop), documentFrequency,
          postingOffset, postingBytes });
        maximumPostingEnd = Math.max(maximumPostingEnd, postingOffset + postingBytes); previousTerm = term;
      }
      const postingsBase = cursor.position;
      if (postingsBase + maximumPostingEnd !== generation.bytes - FOOTER_BYTES) {
        throw new Error("Compact-index posting coverage mismatch");
      }
      const memberStatistics = new memberApi.MemberStatistics(); memberStatistics.replaceThreads(memberThreads);
      const conversationCatalogue = new unansweredApi.ConversationCatalogue(conversationBuilder.finish());
      this.opened = { generation, documents, catalogue, lexicon, postingsBase, watermark,
        memberStatistics, conversationCatalogue };
      this.openingGenerationId = null;
      return { generationId, documentCount, threadCount, termCount, watermark, bytes: generation.bytes };
    }

    requireOpen() { if (!this.opened) throw new Error("Persistent index reader is not open"); return this.opened; }

    catalogueThreads() {
      return [...this.requireOpen().catalogue.values()].map(item => ({ ...item }));
    }

    memberRecords(blockedUsernames = []) {
      return this.requireOpen().memberStatistics.snapshot(blockedUsernames);
    }

    memberStatistics() {
      return this.requireOpen().memberStatistics.clone();
    }

    conversationCatalogue() {
      return this.requireOpen().conversationCatalogue.clone();
    }

    termInfo(field, term) {
      return this.requireOpen().lexicon.get(`${field}\u0000${term}`) || null;
    }

    terms(field, prefix, limit = 128) {
      const matches = [];
      for (const entry of this.requireOpen().lexicon.values()) {
        if (entry.field === field && entry.term.startsWith(prefix)) {
          matches.push(entry);
          if (matches.length > limit) throw new Error("Prefix query is too broad; type more characters");
        }
      }
      return matches;
    }

    async *postingEntries(field, term) {
      const state = this.requireOpen(); const entry = state.lexicon.get(`${field}\u0000${term}`);
      if (!entry) return;
      const cursor = new WindowCursor(this.storage, state.generation.generationId,
        state.generation.bytes - FOOTER_BYTES, state.postingsBase + entry.postingOffset,
        (start, length) => this.window(start, length));
      const end = cursor.position + entry.postingBytes; let previousId = 0;
      for (let index = 0; index < entry.documentFrequency; index += 1) {
        const id = previousId + await cursor.varint(); previousId = id;
        const frequency = await cursor.varint(); const positions = []; let previousPosition = 0;
        for (let item = 0; item < frequency; item += 1) {
          const delta = await cursor.varint(); const position = item ? previousPosition + delta : delta;
          positions.push(position); previousPosition = position;
        }
        yield { documentId: id, termFrequency: frequency, positions };
      }
      if (cursor.position !== end) throw new Error("Compact-index posting boundary mismatch");
    }

    async posting(field, term) {
      const results = [];
      for await (const entry of this.postingEntries(field, term)) results.push(entry);
      return results;
    }

    async document(id) {
      const state = this.requireOpen(); const offset = state.documents.get(Number(id));
      if (offset === undefined) return null;
      const cursor = new WindowCursor(this.storage, state.generation.generationId,
        state.generation.bytes - FOOTER_BYTES, offset, (start, length) => this.window(start, length));
      await cursor.varint(); const threadId = await cursor.varint(); const parentId = await cursor.varint();
      const kind = await cursor.byte(); const values = [];
      for (let field = 0; field < 5; field += 1) values.push(await cursor.blob({ decode: true }));
      return { id: Number(id), threadId, parentId: parentId || null, kind: kind ? "reply" : "thread",
        username: values[0], title: values[1], body: values[2], createdUtc: values[3], canonicalUrl: values[4] };
    }
  }

  return { FOOTER_BYTES, HEADER_BYTES, PersistentIndexReader, WindowCursor };
});
