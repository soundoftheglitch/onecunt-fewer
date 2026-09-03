# Optional forum search architecture

Status: 4.5.0 refactored Chromium and Firefox implementation

## Release rule

Search is an optional local feature backed by a signed compact public-forum catalogue. Stable packages use a three-component Chromium-compatible semantic version and must pass the complete Chromium and Firefox release gate.

The future `Dossier` feature is not part of this release.

## Confirmed source behaviour

- The existing search control is an unbound `<input class="search-bar">`; the forum JavaScript contains no search implementation.
- The public catalogue endpoint is `/api/forum/threads/page/{page}`. It currently returns 25 threads per page and reports the total thread count.
- A thread catalogue item contains the root post. `/api/forum/thread/{threadId}/replies` returns the nested reply tree.
- The API also exposes author email-address fields. With the user's explicit approval, these may be stored only in the device-local index and searched only through the explicit `email:` field; they are not included in ordinary search or displayed in results.
- The forum publishes its palette as CSS custom properties and already supplies the structural classes used by its thread and post views. The replacement control and results can therefore inherit the active forum theme instead of copying fixed colours.

## Components

1. A page adapter replaces only the inert `.search-bar`, handles search navigation, and renders accessible result states inside `#theforum`.
2. A browser adapter provides Chromium and Firefox messaging, background execution and alarms without leaking browser-specific APIs into the indexer.
3. A synchroniser reads anonymous public endpoints with bounded concurrency, retries and resumable checkpoints.
4. An IndexedDB repository, owned by the extension background context, stores sanitised documents, thread state, token postings and sync metadata.
5. A query engine supports unqualified terms and phrases plus `user:`, `title:`, `body:` and explicit `email:` field filters. Candidate ranking favours title, then username, then body matches; phrases are verified against stored text. Bare terms match complete Unicode word tokens, while a trailing `*` explicitly requests a token-prefix match.
6. Author activity uses an indexed `(document kind, normalised username)` lookup and presents separate forum-themed Posts and Replies tabs without scanning the full document store.
7. A persistent Unloved toolbar view uses indexed thread metadata to list visible zero-reply threads oldest-first without network requests.

The content script never receives a complete database dump. It requests bounded result pages from the background context.

## IndexedDB schema

The extension-origin database is `fewercunts-search-v2`, schema version 3:

| Store | Primary key | Contents and indexes |
| --- | --- | --- |
| `documents` | `docKey` (`t:101` or `r:201`) | allowed source fields, normalised field text and token count; indexes on `threadId` and `createdUtc` |
| `terms` | `[term, field, docKey]` | delta-encoded sorted positions and frequency; index on `[term, field]` |
| `threads` | `threadId` | last-post timestamp, advertised/imported post counts and deterministic content fingerprint; index on `lastPostUtc` |
| `sync` | named singleton | phase, catalogue page cursor, pending thread IDs, retry time, counts, cancellation flag, schema/index version and completed watermark |
| `settings` | named singleton | explicit enabled flag, refresh interval and last successful reconciliation |

Each catalogue page or reply tree and its checkpoint commit in one transaction.
Replacing a changed thread deletes its prior documents/postings and inserts the
new snapshot atomically. Integrity checks reject dangling postings, duplicate
document keys and mismatched per-thread counts before a generation is ready.

## Stored public fields

Only these fields may cross the ingestion boundary:

- post ID, thread ID and parent post ID;
- public username and author email address;
- title and message body;
- creation and last-post timestamps;
- thread post count and reply count;
- canonical thread/result location;
- local fetch and index metadata.

All other response keys are rejected. Authentication material and account metadata are never stored or indexed. Email addresses remain local, are excluded from ordinary queries and result rendering, and require an explicit `email:` query.

## Initial import

Search starts disabled. Activating it explains the approximate storage and download cost and asks for a deliberate confirmation. Before importing, the extension estimates available quota through `navigator.storage.estimate()` and refuses cleanly when headroom is inadequate.

The catalogue is fetched newest-first. Each page is sanitised immediately. Alpha.5 fetches reply trees sequentially (bounded concurrency of one) with a configurable delay. Each successful thread is committed in its own short transaction with a checkpoint, so closing the browser or termination of a Manifest V3 worker loses at most the active request. Progress distinguishes the forum-reported total, raw catalogue records checked, blocked roots skipped and searchable threads completed. The UI also reports indexed documents and browser-origin storage usage and offers pause/resume and confirmed clearing. A pause requested during a request leaves that thread pending and commits no partial record.

## Incremental updates

Every submitted search requests a background freshness check after returning current local results. A durable timestamp debounces network checks to no more than once every 15 minutes. The newest catalogue pages are read until the previous completed-sync watermark is reached. New threads and threads whose post count or last-post timestamp changed are refreshed; unchanged reply trees are not downloaded. Relevant visible results may refresh after the update, while offline or API failure leaves the last complete index searchable.

A slower reconciliation samples older threads and periodically performs a complete catalogue comparison so edits, removals and count anomalies eventually converge. A sync is marked complete only after every scheduled update and affected posting-list change commits successfully.

The global limiter permits at most two requests per second. Catalogue pages are
sequential; reply trees use at most two requests in flight. Responses with
`Retry-After` are honoured, while 429, 5xx and network failures use exponential
backoff capped at five minutes. Other 4xx responses do not retry automatically.
The worker adds 0–250 ms jitter and pauses while offline. Incremental scans use
a two-page overlap; weekly full-catalogue and monthly reply-tree reconciliation
eventually detect old edits and deletions without a full download per visit.

## Search and result behaviour

- Empty queries remain on the normal forum view.
- Submitting a query opens an extension-owned results view while preserving normal navigation and browser history.
- Results show the thread title, public username, timestamp, a short safely generated text snippet and a canonical link.
- User content is always inserted with `textContent`; neither message HTML nor query text is interpreted as markup.
- Result pages are bounded and cancellable. Query text never leaves the device. A search may independently trigger the debounced public-index freshness check described above, but the query itself is never sent to ntforum.
- Existing blocked-user filtering remains authoritative: results authored by blocked users, and descendants hidden because of a blocked ancestor, are excluded.

## Theme and accessibility contract

The replacement retains the forum's `.search-bar` placement and derives colour, borders and backgrounds from its custom properties. Results reuse the visual grammar of `.post-title`, `.post-body`, `.post-author`, `.link-text`, divider classes and Bootstrap grid breakpoints, with extension-prefixed selectors to avoid altering the native page.

The form receives an accessible label, keyboard submission, visible focus, status announcements and deterministic loading, disabled, empty, error and results states. Responsive tests cover the forum's narrow and desktop layouts. Automated colour checks enforce WCAG AA contrast for extension-added text and controls.

## Failure and recovery rules

- Network failure leaves the last complete index searchable and offers resume.
- Schema changes stop ingestion with a visible compatibility error; unexpected fields are ignored and missing required fields reject that record.
- An interrupted index migration keeps the prior database until the replacement passes integrity checks.
- Clearing the index is an explicit, confirmed UI action. It first pauses and drains the active importer, closes the background database connection and deletes the extension-owned IndexedDB database. It does not affect forum data, cookies or existing blocker configuration.
- Installation and upgrade never start a crawl without user consent.

Quota is estimated before consent with `navigator.storage.estimate()`. Import
requires headroom of 3.5 times projected searchable source text plus 25 MiB and
warns at 80% quota use. The measured 51 MB current corpus therefore starts with
a conservative estimate of roughly 204 MiB. If ordinary quota is insufficient,
the UI may offer the optional `unlimitedStorage` permission; it never requests
that permission silently. Actual IndexedDB usage is reported during and after
import. Disabling search offers explicit deletion of the local database.

## Query grammar and deterministic ranking

- Bare terms use AND semantics: `warp records`.
- Double quotes require adjacent normalised tokens in one field:
  `"artificial intelligence"`.
- `user:`, `title:` and `body:` restrict a term or quoted phrase to one public display field; `email:` explicitly searches the locally stored full address.
- Bare terms match complete word tokens, so `test` does not match `hottest` or `testing`; a trailing `*` requests prefix matching, so `test*` matches `test`, `tests` and `testing`.
- Unknown prefixes remain ordinary terms. Empty field values, unmatched quotes,
  queries over 512 code points and tokens over 64 code points are validation
  errors.

Text is NFKC-normalised, lower-cased without locale dependence and split into
Unicode letter/number runs, with diacritics folded for matching but original
text retained for display. Ranking uses BM25-style term scoring with weights 5
for username, 4 for thread title, 2 for reply title and 1 for body; an exact
phrase adds 6 and exact username adds 8. Ties resolve by newest creation time,
then `docKey`. Results are capped at 100 and paged in sets of 25. Snippets are
at most 240 characters around the first match and are rendered only through
text nodes and `<mark>` elements, never `innerHTML`.

## Verification gates

Fixtures must cover nested replies, Unicode, punctuation, phrases, duplicate terms, blocked authors, changed threads, removed posts, hostile markup, malformed API records, quota failure and worker interruption. Live tests compare a bounded set of queries with the existing independently built SQLite archive.

Release requires successful fresh import, restart/resume, incremental update, query accuracy, safe themed rendering and persistence tests in Chromium and Firefox. Blocker and visited-link tests must remain green, deterministic packages must validate, and privacy documentation must match observed behaviour.
