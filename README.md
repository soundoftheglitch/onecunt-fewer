# fewerCunts 4.5.1

`fewerCunts` is a privacy-focused Manifest V3 extension for [ntforum.net](https://ntforum.net/). It preserves the forum's visual language while adding local full-forum search, categories, author activity, unread state, saved and muted threads, notifications, responsive pagination, and an editable block list.

This repository begins at version **4.5.0**. Version **4.5.1** is the current supported release.

> This independent project is not affiliated with or endorsed by ntforum.net.

## Install on Chromium

1. Download [`fewerCunts-4.5.1.zip`](https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.1/fewerCunts-4.5.1.zip).
2. Extract it to a permanent directory.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted directory containing `manifest.json`.
5. Reload [ntforum.net](https://ntforum.net/).

## Install temporarily on Firefox

1. Download [`fewerCunts-firefox-4.5.1.xpi`](https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v4.5.1/fewerCunts-firefox-4.5.1.xpi).
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on** and choose the XPI.
4. Reload [ntforum.net](https://ntforum.net/).

Firefox removes unsigned temporary extensions when it closes. Permanent installation requires Mozilla signing.

## Features

- Filters threads, replies, and descendant reply branches from locally configured blocked authors.
- Searches a signed compact public-forum index, overlaid with a bounded recent delta and deletion tombstones.
- Provides Posts and Replies author views, Classic, Categories, Unread, Saved, Muted, Notifications, and Unloved views.
- Adds hierarchical category selection without changing native post-body or title typography.
- Restores route, page, result focus, and scroll position when returning from a result.
- Marks threads with exactly 999 replies as archived and prevents reply actions from the extension.

## Privacy and security

The extension has no login UI and never reads, stores, relays, or publishes passwords, cookies, private drafts, or browser history. Forum authentication and posting remain native NTForum actions. Search data, category overrides, block settings, read state, saved items, muted items, and notifications remain in extension-owned local storage.

Public search and category data are signed. The client validates the pinned public-key fingerprint, Ed25519 signature, hashes, generation identity, sizes, and binary structure before activation. Failed updates retain the last verified local generation. Administrative publishing is restricted to a local allowlisted publisher using OS-keyring authentication and an offline signing key.

See [Privacy](store/PRIVACY.md), [Architecture](docs/refactor-architecture.md), [Publishing boundary](docs/admin-publishing-boundary.md), and [Recovery runbook](docs/compiled-search-runbook.md).

## Architecture

```text
NTForum page → content adapter → isolated UI → background message router
                                            → application services
                                            → catalogue projection
                                            → signed/persistent repositories
```

- `content.js` integrates with NTForum's Knockout model and exposes a bounded event bridge.
- `search/ui.js` composes cohesive route, element, category, Unloved, and DOM-lifecycle modules.
- `background.js` maps stable message names to application services through a declarative router.
- `search/catalogue.js` is the single signed-base + recent-delta + tombstone + visibility projection for catalogue-backed views.
- Persistent stores retain their established schema and fail closed on malformed or unsigned data.

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

Browser verification scripts in `scripts/verify_*_chromium.py` and `scripts/verify_*_firefox.py` cover focused fixtures and the anonymous live forum. Build output is deterministic and contains only files on the package allowlist.

## Release policy

4.5.0 is the intentionally clean first release. Each subsequent correction increments the patch component. A release is accepted only when its source commit, `main`, version tag, Chromium ZIP, Firefox XPI, anonymous downloads, and publisher checkout agree byte-for-byte. Credential scanning and package allowlists run before publication.
