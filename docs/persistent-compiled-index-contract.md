# Persistent compiled-index contract

Status: accepted implementation contract for compact source schema 1 and browser storage schema 1.

## Scope and authority

The only source is the project's already-published, anonymously readable GitHub compact-index generation. Its stable pointer, canonical manifest, Ed25519 signature, bundled-key fingerprint, release chunk sizes and SHA-256 values are verified as specified in `compact-search-index-v1.md` and `search/compact-reader.js`. Persistence starts only after those checks. It never crawls historical NTForum pages or APIs and never materialises documents, terms or postings as per-term IndexedDB records.

The source and storage schemas are separate compatibility keys. This contract accepts source `(ntforum-compact-search, 1)` and stores `(fewercunts-persisted-compact-index, 1)`. Unsupported values fail closed; storage schema changes require a new cache/namespace and explicit migration.

## Browser-owned representation

Use extension-origin Cache Storage (or an adapter with the same key/value and atomic single-key replacement semantics). The logical namespace contains:

- one active pointer at `meta/active.json`;
- one generation record at `generations/<generationId>/generation.json`;
- raw immutable chunks at `generations/<generationId>/raw-0000.bin`, increasing without gaps;
- optional staging progress at `staging/<generationId>/progress.json`, which is never search-visible and is deleted on completion or recovery.

`generationId` is `v1-<manifestSha256>`, where `manifestSha256` is the lowercase SHA-256 of the exact signed canonical source manifest. Keys are derived locally, never accepted as arbitrary source URLs. The source manifest bytes and signature may be retained for audit, but the generation record is authoritative for local layout.

The raw verified binary is split from byte zero into 8 MiB (`8,388,608`) chunks; only the final chunk may be shorter. A generation has 1–32 chunks and is therefore limited to 256 MiB. Chunk names are exactly `raw-%04d.bin`. Every chunk record contains `{name, offset, bytes, sha256}`; offsets start at zero, are contiguous, and cover exactly `generation.bytes`. The current 102,374,417-byte GitHub generation occupies 13 raw chunks. A source exceeding any bound is rejected before writing payload data.

## Records

The generation record is canonical JSON with these required fields:

```text
storageFormat, storageSchemaVersion
sourceFormat, sourceSchemaVersion
generationId, state (staging | complete)
manifestSha256, watermark, bytes, sha256
documentCount, termCount
chunkBytes (= 8388608), chunks[] {name, offset, bytes, sha256}
createdUtc, completedUtc (required only when complete)
source {generationTag, manifestUrl}
```

`manifestSha256`, `bytes`, `sha256`, counts, watermark and source identity must equal the verified GitHub pointer/manifest. Each local raw-chunk checksum is computed while writing. A `complete` record is valid only after every named chunk exists, its size/hash matches, chunk coverage is exact, and the reconstructed binary passes the source whole-file SHA-256, header/schema/count checks and payload-footer SHA-256. Once complete, the record and chunks are immutable.

The active pointer is canonical JSON containing only `{storageFormat, storageSchemaVersion, generationId, activatedUtc}`. It may name only a re-opened and revalidated `complete` generation. Replacing this one cache entry is the atomic commit point; payload writes, staging metadata, completion, cleanup and UI status are not activation.

## Bounded random access

The reader accepts integer `(offset, length)` ranges wholly inside `[0, generation.bytes)`. `length` is 1–1 MiB. A read resolves arithmetically to at most two 8 MiB chunks, fetches only those objects, slices locally, concatenates if necessary and returns exactly `length` bytes. Missing objects, extra/short data, invalid metadata, or any checksum failure close that generation and do not fall through to unverified bytes.

Opening a generation may read the small pointer and generation record plus bounded binary header/footer/section-directory ranges. It must not assemble the complete binary merely to answer a query. Full verification is required once during installation; later opens verify record structure and required object existence, while reads may re-check chunk hashes on first use and cache only a bounded number of verified chunks.

## Lifecycle and atomic switching

1. Read and validate the existing active pointer and complete generation; keep that reader open.
2. Fetch and verify the stable GitHub pointer, public-key fingerprint, signed canonical manifest and all source declarations. An equal or older acceptable watermark is a no-op.
3. Reject unsupported schema, over-limit sizes/counts, privacy violations or insufficient estimated headroom before payload writes.
4. Create a new `staging` record. Stream download, hash, decompress and split into the deterministic raw chunk keys. Repeated writes are allowed only while staging and must replace identical deterministic bytes.
5. Verify every local chunk and the reconstructed source binary. Write the final `complete` generation record as the last generation-local operation. Do not modify it afterward.
6. Re-open the complete generation through the normal reader. Only then atomically replace `meta/active.json`.
7. After the new pointer is durably readable, delete staging metadata and non-active old generations. Cleanup is best-effort and must never delete the generation named by the pointer or a prior complete generation still serving an open reader.

At all steps before 6, searches continue through the prior complete generation. A failed replacement never changes the pointer. If there is no prior generation, search reports unavailable without starting an NTForum crawl.

## Startup recovery and failures

On startup, validate the pointer and its target before exposing search. If the pointer is missing, malformed, unsupported or names a missing/non-complete generation, scan only generation records (bounded to 32 records), select the newest compatible complete generation by watermark then generation ID, validate it, and atomically repair the pointer. Never promote staging data. If no complete generation validates, report a closed index and retain corrupt objects for the current diagnostic session; cleanup may remove them after reporting.

Delete staging generations that are not owned by the current install attempt. Interruption recovery may resume only when its source manifest hash, deterministic layout and already-written chunk hashes all match; otherwise delete and restart that staging generation. Cleanup failures are warnings, not reasons to deactivate a complete generation.

Quota is checked with `navigator.storage.estimate()` as an early warning, reserving the entire new raw generation plus 15% working headroom while retaining the old active generation. The write path must also translate `QuotaExceededError` (including operation, generation ID, attempted bytes, usage/quota when exposed, and `recoverable: true`) because estimates are advisory. On quota failure, stop staging, preserve and continue serving the old active generation, best-effort delete only the failed staging generation, and present a retry/clear-space status. Automatic cleanup must not delete the active generation to make space.

Network, signature, schema, structure, checksum, decompression, storage and quota failures are distinct actionable errors. None may change the active pointer. Explicit user clearing is a separate confirmed operation and is the only path allowed to remove the active generation without first activating another complete one.

`search/persistent-index-contract.js` is the shared executable declaration of identifiers, limits and structural/range validation for the storage and reader implementation cards.
