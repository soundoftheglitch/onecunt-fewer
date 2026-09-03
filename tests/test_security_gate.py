#!/usr/bin/env python3

import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from security_gate import (SecurityGateError, findings, release_packages,
                           scan_package, verify)  # noqa: E402


class SecurityGateTests(unittest.TestCase):
    def test_rejects_credentials_without_returning_their_value(self):
        secret = b"github_pat_" + b"A" * 30
        result = findings("runtime.js", b"const token='" + secret + b"';", packaged=False)
        self.assertEqual(result, [{"rule": "github-token", "path": "runtime.js"}])
        self.assertNotIn(secret.decode(), repr(result))

    def test_rejects_private_keys_and_sensitive_filenames(self):
        self.assertEqual(findings(".env.production", b"safe=true", packaged=False)[0]["rule"], "sensitive-filename")
        private_key = b"-----BEGIN " + b"PRIVATE KEY-----"
        self.assertEqual(findings("key.txt", private_key, packaged=False)[0]["rule"], "private-key")

    def test_allows_only_the_packaged_public_verification_key(self):
        self.assertEqual(findings("search/index-signing-public.pem", b"-----BEGIN PUBLIC KEY-----", packaged=True), [])

    def test_rejects_retired_sensitive_bridges_in_packages(self):
        for source in (b'input.type="password"', b"fewercunts:account-action", b"fewercunts:draft-request", b"document.cookie"):
            self.assertTrue(findings("content.js", source, packaged=True))

    def test_source_runtime_files_use_the_same_sensitive_rules(self):
        self.assertEqual(findings("content.js", b"document.cookie", packaged=True),
                         [{"rule": "cookie-access", "path": "content.js"}])

    def test_release_packages_are_derived_from_revision_manifest(self):
        packages = release_packages("HEAD")
        self.assertEqual([item.name for item in packages],
                         ["fewerCunts-4.5.0.zip", "fewerCunts-firefox-4.5.0.xpi"])

    def test_archive_reports_metadata_not_secret_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "bad.zip"
            secret = "ghp_" + "B" * 30
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr("background.js", secret.encode())
            result = scan_package(package)
            self.assertEqual(result[0]["rule"], "github-token")
            self.assertNotIn(secret, repr(result))
            with self.assertRaises(SecurityGateError) as rejected:
                verify(packages=[package])
            self.assertNotIn(secret, str(rejected.exception))


if __name__ == "__main__": unittest.main()
