# Developer documentation

This document is for contributors and release maintainers. End users should follow the [beginner installation guide](../README.md).

## Architecture

```text
NTForum page → content adapter → isolated UI → background message router
                                            → application services
                                            → catalogue projection
                                            → signed/persistent repositories
```

- `content.js` integrates with NTForum's Knockout model and exposes a bounded event bridge.
- `search/ui.js` composes route, element, category, Unloved, and DOM-lifecycle modules.
- `background.js` maps stable message names to application services through a declarative router.
- `search/catalogue.js` is the signed-base, recent-delta, tombstone, and visibility projection for catalogue-backed views.
- Persistent stores retain their established schemas and fail closed on malformed or unsigned data.

See [Refactor architecture](refactor-architecture.md), [Search architecture](search-architecture.md), [Publishing boundary](admin-publishing-boundary.md), and [Recovery runbook](compiled-search-runbook.md).

## Build and verify

Run the maintained test profile with the Python interpreter available on your
platform:

```sh
python scripts/test.py
```

On Unix-like systems the equivalent command may be `python3 scripts/test.py`.
The local publisher authorization boundary is intentionally Linux-only; it
depends on the allowlisted `x0ar` account, filesystem ownership and systemd
units on the publisher host.

```sh
node --test tests/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/build.py
python3 scripts/build_firefox.py
python3 scripts/validate_store.py
python3 scripts/validate_firefox.py
python3 scripts/security_gate.py --revision HEAD
```

Browser verification scripts in `scripts/verify_*_chromium.py` and `scripts/verify_*_firefox.py` cover deterministic fixtures and the anonymous live forum. Build output is deterministic and restricted to the package allowlist.

The live Chromium smoke test requires Chromium or Chrome for Testing. Ordinary
Google Chrome 137 and later no longer accept `--load-extension`. If the test
browser is not on `PATH`, set `CHROMIUM_BINARY` to its executable before running
`python scripts/test.py --release`. On Windows, Chrome for Testing uses the
ordinary `chrome.exe` filename, so `CHROMIUM_BINARY` is always required to
distinguish it from branded Google Chrome.

## Release policy

4.5.0 is the intentionally clean first release. Each subsequent correction increments the patch component. A release is accepted only when its source commit, `main`, version tag, Chromium ZIP, Firefox XPI, anonymous downloads, and publisher checkout agree byte-for-byte. Credential scanning and package allowlists run before publication.

Version 5 must not be published until its beginner installation path is implemented and verified. The preferred distribution endpoints are the Chrome Web Store and a Mozilla-signed Firefox package; GitHub remains the transparent source and manual fallback.


## Category and search recovery (4.5.4)

The daily publisher and deep campaign must use the same deployed checkout and schema-aware `update_categories.update` merge. Both serialise active category replacement with `fewercunts-category-update.lock`; the publisher rejects a missing reply-decision table. Category maps/manifests use content-addressed filenames and the signed pointer switches after anonymous verification. Do not restore the retired standalone deep database builder.

`deep_category_campaign.py --limit 6 --request-timeout 240` retries failed inference with persistent backoff and rechecks uncertain threads with up to eight bounded public replies. `refine_reply_categories.py --limit 2 --request-timeout 240` checkpoints real reply-level model decisions, prioritising new/edited replies over the historical queue. Run the schema-aware merge after refinement and before publication. Completed prefilter rows are not completed model analysis: published `replyModelDecisions` and `replyPendingAnalysis` expose the distinction. Valid uncertain results retain inheritance; failed calls remain retryable. Device-local overrides take precedence over shared reply categories.

Host boot cleanup must preserve the exact extension origins in both IndexedDB and CacheStorage. `scripts/preserve_chromium_index.py` recognises approved installation-path IDs, preserves only those origins, rejects symlinks/nested mounts, and resumes interrupted move/restore operations. Verify with a disposable Chromium profile: write a real extension cache, close the browser, clean the profile, reopen and read the same data; unrelated history and site storage must disappear. Never run the whole host cleanup service as a live test.

The extension checks the signed search pointer at a bounded interval when automatic updates are enabled. Successful checks and failed attempts survive worker restarts; unchanged generations do not redownload. The search controls distinguish the base database watermark, last check, recent-post refresh, and failed/pending replacement. Pause and clear remain respected by scheduled checks.
