#!/usr/bin/env python3
"""Unit tests for the local administrative publisher allowlist."""

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from publisher_guard import (DEFAULT_BRANCH, GITHUB_LOGIN, PublisherPolicyError, REPOSITORY,
                             preflight, validate_checkout_path, validate_release_target)  # noqa: E402
import publisher_guard  # noqa: E402
import publish_compact_search_index as compact_publisher  # noqa: E402


class PublisherGuardTests(unittest.TestCase):
    def test_release_allowlist_accepts_only_expected_tags_and_assets(self):
        validate_release_target("v4.5.0", ["search-latest.json", "categories-latest.json",
                                          "ntforum-search-v1.manifest.json",
                                          "ntforum-search-v1.manifest.sig",
                                          "ntforum-search-v1-0000.gz.part",
                                          "ntforum-categories-v1.json.gz"])
        for tag in ("v4.6.0", "main", "../v4.5.0"):
            with self.assertRaises(PublisherPolicyError): validate_release_target(tag)
        with self.assertRaises(PublisherPolicyError): validate_release_target("v4.5.0", ["token.txt"])

    def test_identity_constants_are_exact(self):
        self.assertEqual(GITHUB_LOGIN, "soundoftheglitch")
        self.assertEqual(REPOSITORY, "soundoftheglitch/onecunt-fewer")
        self.assertEqual(DEFAULT_BRANCH, "main")

    def test_preflight_rejects_wrong_account_repository_and_origin(self):
        def runner(account=GITHUB_LOGIN, repository=REPOSITORY,
                   origin=f"https://github.com/{REPOSITORY}.git", branch="main",
                   head="a" * 40, remote_head="a" * 40):
            def execute(*arguments):
                if arguments[:3] == ("gh", "api", "user"): return account
                if arguments[:2] == ("gh", "api"):
                    return __import__("json").dumps(
                        {"full_name": repository, "default_branch": "main", "archived": False})
                if arguments[:3] == ("git", "-C", str(publisher_guard.ROOT)):
                    if arguments[3:] == ("branch", "--show-current"): return branch
                    if arguments[3:] == ("remote", "get-url", "origin"): return origin
                    if arguments[3:] == ("rev-parse", "HEAD"): return head
                    if arguments[3:] == ("status", "--porcelain=v1"): return ""
                if arguments[:2] == ("git", "ls-remote"): return f"{remote_head}\trefs/heads/main"
                raise AssertionError(arguments)
            return execute
        for execute in (runner(account="someone-else"), runner(repository="someone/else"),
                        runner(origin="https://github.com/someone/else.git"), runner(branch="feature/unsafe"),
                        runner(remote_head="b" * 40)):
            with patch.object(publisher_guard, "validate_checkout_path"), self.assertRaises(PublisherPolicyError):
                preflight(runner=execute, effective_uid=1000)
        with patch.object(publisher_guard, "validate_checkout_path"):
            self.assertEqual(preflight(runner=runner(), effective_uid=1000)["result"], "authorized")

    def test_preflight_rejects_a_dirty_publisher_checkout(self):
        def execute(*arguments):
            if arguments[:3] == ("gh", "api", "user"): return GITHUB_LOGIN
            if arguments[:2] == ("gh", "api"):
                return __import__("json").dumps({"full_name": REPOSITORY, "default_branch": "main", "archived": False})
            if arguments[:3] == ("git", "-C", str(publisher_guard.ROOT)):
                values = {("branch", "--show-current"): "main", ("remote", "get-url", "origin"):
                          f"https://github.com/{REPOSITORY}.git", ("rev-parse", "HEAD"): "a" * 40,
                          ("status", "--porcelain=v1"): "?? unsafe.tmp"}
                return values[arguments[3:]]
            raise AssertionError(arguments)
        with patch.object(publisher_guard, "validate_checkout_path"), self.assertRaisesRegex(
                PublisherPolicyError, "uncommitted or untracked"):
            preflight(runner=execute, effective_uid=1000)

    def test_dry_run_rejects_wrong_checkout_path(self):
        with self.assertRaises(PublisherPolicyError):
            validate_checkout_path(Path("/tmp"))

    def test_public_extension_contains_no_publisher_authority(self):
        root = Path(__file__).resolve().parents[1]
        manifest = (root / "manifest.json").read_text()
        background = (root / "background.js").read_text()
        self.assertNotIn("nativeMessaging", manifest)
        self.assertNotIn("github-upload", background)
        self.assertNotIn("gh release", background)

    def test_correct_noop_fixtures_do_not_upload(self):
        with patch.object(compact_publisher, "preflight"), \
             patch.object(compact_publisher, "remote_pointer", return_value={
                 "schemaVersion": 1, "watermark": "2026-08-31T11:00:00Z", "generationTag": "fixture"}), \
             patch.object(compact_publisher, "local_watermark", return_value="2026-08-31T10:00:00Z"), \
             patch.object(compact_publisher, "run") as upload:
            self.assertEqual(compact_publisher.publish()["result"], "unchanged")
            upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
