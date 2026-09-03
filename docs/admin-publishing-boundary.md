# Administrative publishing boundary

`dog hat` is the forum identity associated with the local operator, but a forum username is not an authorization secret. Public extension code can be inspected or modified, so the extension contains no GitHub token, upload command, native-messaging bridge, privileged HTTP endpoint or publisher message. Ordinary users only download and validate signed public index assets.

Publishing is an operating-system task on the operator's laptop. The user-level `fewercunts-snapshot-publish.timer` starts at 23:00 and runs as `x0ar` inside a hardened systemd sandbox. It uses the dedicated `/home/x0ar/Worktrees/ntforum-publisher` checkout on `main`, so an active development branch cannot suppress or alter a scheduled publication. Before reading the archive or making a GitHub mutation, both publishers call `publisher_guard.preflight()` and fail closed unless all of these are true:

- effective local user is exactly `x0ar`;
- repository checkout is exactly `/home/x0ar/Worktrees/ntforum-publisher`;
- publisher scripts, service, timer and GitHub CLI configuration are owned by `x0ar` and not group- or world-writable;
- compact signing key is owned by `x0ar` and mode `0600` or stricter;
- GitHub CLI's keyring identity is exactly `soundoftheglitch`; environment and plaintext-config tokens are rejected;
- API repository identity is exactly `soundoftheglitch/onecunt-fewer`, on active default branch `main`;
- local Git remote is the exact allowlisted GitHub repository;
- local checkout is on branch `main` (development branches cannot publish);
- local `HEAD` exactly equals GitHub's current `main` commit (stale or divergent checkouts cannot publish);
- release tags and asset basenames match the snapshot/compact allowlists.

Extension releases use the same fail-closed module through `validate_extension_release`: the operator must
declare bugfix, minor, or major; the proposed manifest is compared with GitHub's latest public stable version;
and the tag plus exact Chromium ZIP/Firefox XPI pair must match that version. The tracked pre-push hook applies
the same classification gate to public `main` and `v*` pushes, so a release commit cannot rely on an earlier,
unverified version bump.

The service has no writable home access beyond `/home/x0ar/.local/state`, uses a private temporary directory and device namespace, and enables kernel/control-group/system-call hardening. Logs contain result metadata and watermarks, never tokens or signing-key contents.

Changing an NTForum username, patching the public extension, or imitating `dog hat` therefore cannot acquire publisher authority. GitHub CLI must use secure OS storage with a fine-grained token restricted to `soundoftheglitch/onecunt-fewer` and the minimum release/content permissions. The publisher fails closed while that credential is absent. Credential creation or rotation requires the account owner; the token must never be committed or placed in a service environment. The current laptop credential is operational but still uses broader classic OAuth `repo` scope, so rotating it remains an explicit least-privilege task.
