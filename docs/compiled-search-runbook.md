# Compiled search publication and rollback

The public extension can only download and verify releases. Publishing is a local `x0ar` systemd operation from `/home/x0ar/Worktrees/ntforum-publisher`; see the separate administrative-boundary document for authorization details.

## Daily publication

1. Confirm the dedicated checkout is clean, on `main`, and identical to `origin/main`.
2. Run `python3 scripts/publisher_guard.py --compact`. Stop on any mismatch.
3. Let `fewercunts-snapshot-publish.timer` run at 23:00. Both publishers compare local and remote watermarks before building; equal or older local data is a successful no-op.
4. Publish the all-public-author compact data and update its signed 4.5.0 release pointer only after signature, checksum, decode, no-email privacy, count and watermark verification passes.
5. Download the pointer and assets anonymously and run `node scripts/verify_compact_reader.js`. Check the journal contains metadata and no secret material.

The extension downloads no historical forum pages. After installing the base it checks only the bounded recent Today/Yesterday delta.

## Plugin release

Build from the manifest and run the complete Node, Chromium and package gates. Keep the version change in the final release commit. Run `python3 scripts/verify_release_consistency.py --update-kind <bugfix|minor|major>`; it compares the manifest with GitHub's latest public stable release and the commit's first parent. It requires exactly `x.y.(z+1)`, `x.(y+1).0`, or `(x+1).0.0`, respectively. Install the tracked hook with `git config core.hooksPath .githooks`, then push public `main` and the `v*` tag only with the matching `FEWERCUNTS_UPDATE_KIND` environment value. Create a stable release containing exactly the matching Chromium ZIP and Firefox XPI. Fast-forward the dedicated publisher checkout to that exact `origin/main` commit, run `python3 scripts/publisher_guard.py --compact`, then finish with `python3 scripts/verify_release_consistency.py --published --update-kind <kind>`. The final verifier fails on branch, tag, package, asset-set, publisher-HEAD, source, or SemVer drift.

## Rollback

- Plugin: do not rewrite an existing tag. Publish a new version that reverts the faulty commit, verify its anonymous ZIP, and leave the bad prerelease identified in release notes.
- Search pointer: restore `v4.5.0/search-latest.json` to the last anonymously verified signed generation.
- Browser: a failed replacement automatically retains the previous complete generation. If the active generation itself is unusable, select **Clear index**, reload the extension, and reinstall from the restored pointer.
- Publisher: disable the user timer when authorization, signing, archive validation or remote watermark evidence is uncertain. Re-enable it only after the guard and a manual no-op fixture pass.

Record the generation tag, watermarks, commit, release ZIP SHA-256, anonymous verification and service invocation in the Kanban card before completion.
