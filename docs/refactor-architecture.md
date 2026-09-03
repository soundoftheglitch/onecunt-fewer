# Refactor architecture

The refactor preserves the Manifest V3 package, public message names, persistent database schemas and signed-data contracts. It proceeds in independently testable slices; no slice may require clearing an existing browser profile.

## Runtime boundaries

- `content.js` is the main-world NTForum adapter. It owns Knockout observation and emits only the bounded page bridge used by the isolated extension UI.
- `search/ui.js` is the isolated-world composition root. View modules may render and request operations, but must not read forum credentials or own persistence.
- `background.js` is the service-worker composition root. Its message router delegates to application services and returns structured-cloneable values.
- `search/catalogue.js` is the canonical root-thread projection. It overlays the bounded recent delta on the signed base, removes tombstones, supplies canonical URLs, then applies blocked-author and muted-thread visibility. Catalogue-backed views must not reproduce this merge.
- Persistent repositories own one schema each. Refactoring may move orchestration around them but must not rename stores, alter keys, or migrate/delete data without a separately reviewed compatibility change.
- Signed compact readers and publishers remain fail-closed. No UI or catalogue abstraction may weaken signature, hash, watermark, identity, size or request-bound checks.

## Dependency direction

```text
NTForum page → content adapter → isolated UI → background router
                                            → application services
                                            → catalogue projection
                                            → persistent/signed repositories
```

Dependencies point toward data contracts. Repositories and pure projections do not import browser UI code. Feature views do not call IndexedDB or remote endpoints directly.

## Behavioural gates

Each slice retains focused Node characterization tests. Browser verification is divided into deterministic feature fixtures and a small live anonymous smoke layer. Final acceptance additionally requires an existing-profile Chromium run, a fresh profile, Firefox packaging, restart persistence, deterministic packages, credential scanning, published-release consistency and exact installation of the anonymous public ZIP.
