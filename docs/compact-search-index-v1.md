# NTForum compact search index v1

Status: accepted fixture contract. The production compiler/importer is a separate task.

## Decision

Use a deterministic, immutable, privacy-filtered binary asset (`ntforum-compact-search`, schema 1), wrapped in deterministic gzip for distribution. The binary stores integer document IDs, front-coded normalised terms, delta-coded document IDs and positions, and a compact document-to-display-metadata table. Stop words remain in positional postings so quoted phrases are exact, but an ordinary unquoted query does not use a stop word to select or score candidates.

The asset is generated offline from the archive. It contains no author-email field or value. A blocked root author removes the entire thread; a blocked reply removes itself and every descendant before IDs, counts, terms, checksums or the watermark manifest are emitted. The compiler fails closed if any input key contains `email`.

## Byte contract

All integers are unsigned. Fixed integers are little-endian; variable integers are canonical unsigned LEB128. Strings are UTF-8 encoded as `varint byte_length + bytes`. There is no alignment padding.

The file is:

1. A 40-byte `<8sHHIIIIQQ` header: magic `NTFSIDX\0`; `u16 schema_version=1`; `u16 flags=0`; `u32 document_count`; `u32 term_count`; `u32 watermark_utf8_bytes`; `u32 reserved=0`; `u64 metadata_offset`; `u64 lexicon_offset`.
2. The UTF-8 watermark, whose end must equal `metadata_offset`.
3. Exactly `document_count` metadata records. Each is `doc_id_delta`, `thread_id`, `parent_doc_id_or_zero`, one kind byte (`0` thread, `1` reply), followed by username, title, body, created UTC and canonical URL strings. IDs are positive, globally unique and increasing; the compiler assigns them deterministically after privacy filtering. Forum thread/reply IDs remain in metadata/navigation fields and are not the index document ID namespace.
4. Exactly `term_count` lexicon records, globally sorted by `(field, normalised_term)`. Each is: one field byte (`0 user`, `1 title`, `2 body`), one stop-word byte, `common_prefix_characters`, UTF-8 suffix, document frequency, posting-list byte offset and posting-list byte length. The prefix is relative to the previous lexicon term; terms use deterministic HTML visible-text extraction with character-reference conversion, NFKD, removal of combining marks, Unicode case-folding, and contiguous Unicode letter/number tokens.
5. Concatenated posting lists. Each contains exactly document-frequency entries: delta from the prior document ID, term frequency, then that many token positions (first absolute, subsequent delta). Positions are zero-based within the field. Posting boundaries must exactly cover the section.
6. A 32-byte SHA-256 of every preceding byte. Any checksum, count, boundary, UTF-8 or version failure rejects the complete asset before persistent state changes.

`scripts/compact_search_index.py` is the normative fixture codec. `manifest_json()` emits canonical sorted compact JSON. The manifest fields are `format`, `schemaVersion`, `documentCount`, `termCount`, `watermark`, `bytes`, `sha256` (whole binary), `payloadSha256` (footer value), and the privacy declaration. Publication additionally signs the canonical manifest; signature transport and key rotation belong to the publisher task.

## Query path

Normal terms binary-search the front-coded lexicon (or a sparse lexicon checkpoint built while loading), read only their bounded posting spans, intersect the smallest document-frequency lists first, and fetch metadata for the remaining integer IDs. Ranking uses field weight, IDF from document frequency and term frequency. Phrase queries also load stop-word postings and intersect adjacent positions. Ordinary unquoted stop words are discarded before lookup/ranking. Prefix queries seek the first lexicon term and scan only the matching range under an explicit result/candidate bound.

The current schema-3 IndexedDB snapshot instead inflates gzip/NDJSON, parses complete thread JSON, inserts document records, and writes JSON-like three-character term shards containing string keys such as `t:101`; it has no snapshot TF/positions. The binary path avoids per-term IndexedDB keys and JSON parsing, supports direct bounded reads, and supplies phrase/ranking data without re-tokenising every document.

## Version and migration contract

- `(format, schemaVersion)` is the compatibility key. Unknown magic, flags or versions are rejected; readers never guess or partially import.
- Version 1 is immutable. Any byte-layout, normalisation, stop-word-set, field-set, privacy, ID-assignment or checksum change increments `schemaVersion` and uses a distinct versioned asset name.
- The stable manifest switches only after the complete asset, byte length, checksum, signature, counts, privacy tests and watermark have been verified. Its watermark must be newer than the installed complete generation.
- Import writes a new generation beside the current complete generation. Only a verified end marker atomically switches the active generation; interruption leaves the old generation searchable. Old generations are removed after the switch.
- IndexedDB schema 3/sharded bootstrap and compact schema 1 do not migrate records in place. The importer builds a new generation from the compact asset, preserves consent/update settings only, switches atomically, then deletes legacy search stores. On failure it retains the old complete index and may fall back to the forum importer.
- Downgrade never interprets a newer generation. It retains it untouched and either uses a compatible older complete generation or reports that a compatible rebuild is required.

## Measured size estimate

Measurement used the immutable 2026-08-28 archive (363,129 FTS documents) and the first 10,000 deterministically ordered thread/reply rows. Privacy filtering retained 9,915. The v1 fixture encoded 2,853,614 bytes (287.81 bytes per retained document); deterministic gzip-9 was 1,172,544 bytes. Linear projection is 104,511,346 bytes (99.7 MiB) raw or approximately 41.0 MiB distributed.

The current full schema-2 gzip is 49,241,073 bytes (47.0 MiB). The sampled projection is therefore about 8.2 MiB/17% smaller on the wire while additionally retaining term frequency and positions. This is an estimate, not a full-corpus build: vocabulary mix and blocked-subtree frequency can change the final figure. The compiler task must record the exact full-corpus size and peak memory before publication.

Reproduce the normative behaviour with:

```sh
python3 -m unittest tests/test_compact_search_index.py -v
```
