# Test and security gates

The default release gate is intentionally layered rather than running every historical browser script.

- Fast required suite: `python3 scripts/test.py` runs all `tests/*.test.js`, all `tests/test_*.py`, both package validators, and the security gate. Use `--release` to add the live Chromium release smoke verification.
- Required security suite: `scripts/security_gate.py` scans every commit introduced by a protected push, applies retired password/cookie/bridge rules to committed runtime files, and scans both version-derived packages. It reports only rule and path metadata, never matching secret text.
- Required publication boundaries: `.githooks/pre-push`, `publisher_guard.py`, and `verify_release_consistency.py` all invoke the security gate.
- Focused browser release smoke tests cover live blocker behaviour and current Chromium/Firefox packaging. Feature-specific `verify_*_chromium.py` scripts remain diagnostics and run when their feature changes; they are not a mandatory all-at-once matrix.

The security audit removed the obsolete draft runtime, redundant fixtures, historical packages and credential-bearing paths. Each retained browser script targets a distinct feature. Broad live fixtures can fail when NTForum test content changes, so failures must be diagnosed rather than masked by repeatedly running unrelated scripts.
