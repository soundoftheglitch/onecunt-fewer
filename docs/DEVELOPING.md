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

## Release policy

4.5.0 is the intentionally clean first release. Each subsequent correction increments the patch component. A release is accepted only when its source commit, `main`, version tag, Chromium ZIP, Firefox XPI, anonymous downloads, and publisher checkout agree byte-for-byte. Credential scanning and package allowlists run before publication.

Version 5 must not be published until its beginner installation path is implemented and verified. The preferred distribution endpoints are the Chrome Web Store and a Mozilla-signed Firefox package; GitHub remains the transparent source and manual fallback.
