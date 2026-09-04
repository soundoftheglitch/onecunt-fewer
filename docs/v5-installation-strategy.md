# v5 installation strategy

## Decision

The beginner target is a signed, one-click store installation with automatic
updates. Chrome Web Store is phase 1 because Chromium-family browsers are the
current recommended platform. Mozilla-signed Firefox follows. GitHub unpacked
packages remain an advanced fallback and verification artifact.

Chrome documents the Web Store and managed self-hosting as supported distribution
paths; unpacked loading is for trusted development use. Windows and macOS cannot
directly install a self-hosted extension outside enterprise policy. See
[Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute).
Firefox release and beta require Mozilla signing, while temporary add-ons end at
restart and are not an end-user flow. See [Firefox signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
and [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

## Phases

### 0. Make 4.5.x survivable now

Keep one Chromium path; explain extraction, verification, update, recovery,
privacy, and uninstall; label Firefox tester-only; test documentation links and
version references; preserve public 4.5.x.

### 1. Chrome Web Store v5

- Use a least-privilege publisher identity with two-factor authentication.
- Prepare store copy, screenshots, support URL, and privacy disclosure from the
  exact reviewed source, then upload through a guarded publisher step.
- Verify clean install, permissions, NTForum activation, automatic update from a
  staged predecessor, restart persistence, disable/enable, uninstall, and
  anonymous listing access on Chrome and another Chromium-family browser.
- Only then point the README at the store and publish v5; keep ZIP installation
  under an advanced/manual section.

This removes downloading, extraction, Developer mode, folder management, and
manual updates from the beginner journey.

### 2. Mozilla-signed Firefox

- Prefer a public AMO listing unless policy requires signed unlisted distribution.
- Submit the deterministic build and disclosures through a guarded publisher.
- Verify standard Firefox install, restart, automatic update, permissions,
  NTForum activation, and uninstall before recommending Firefox to beginners.

### 3. Automation and support

- Derive documentation/store versions and release notes from the manifest.
- Fail publication on missing assets, store/version disagreement, unexpected
  privacy changes, or packages differing from reviewed build inputs.
- Add a no-permission first-run confirmation on NTForum with version and help.
- Add safe settings export/import before making recovery claims; never export
  cookies, credentials, private content, or the public search corpus.

## v5 release gate

Do not publish v5 merely because it builds. The chosen installer must be publicly
reachable and verified from a clean profile through install, first run,
automatic update, restart, troubleshooting, and uninstall. Package identity,
permissions, privacy disclosure, store listing, source tag, and release must
agree. Until then, 4.5.x remains stable.

