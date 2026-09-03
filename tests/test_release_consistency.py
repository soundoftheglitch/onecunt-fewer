#!/usr/bin/env python3

import io
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from verify_release_consistency import (ConsistencyError, published_predecessor_version,
                                        resolve_remote_tag_commit)  # noqa: E402


class Response(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *_args): self.close()


class ReleaseConsistencyTests(unittest.TestCase):
    def test_accepts_lightweight_and_annotated_tags(self):
        commit = "a" * 40
        tag_object = "b" * 40
        self.assertEqual(resolve_remote_tag_commit(
            f"{commit}\trefs/tags/v7.1.1\n", "v7.1.1"), commit)
        self.assertEqual(resolve_remote_tag_commit(
            f"{tag_object}\trefs/tags/v7.1.1\n{commit}\trefs/tags/v7.1.1^{{}}\n",
            "v7.1.1"), commit)

    def test_wrong_target_and_malformed_tag_responses_fail_closed(self):
        head = "a" * 40
        wrong = resolve_remote_tag_commit(f"{'c' * 40}\trefs/tags/v7.1.1\n", "v7.1.1")
        self.assertNotEqual(wrong, head)
        for output in ("", f"{head}\trefs/tags/v7.1.0\n",
                       f"{head}\trefs/tags/v7.1.1\n{head}\trefs/tags/v7.1.1\n"):
            with self.assertRaises(ConsistencyError):
                resolve_remote_tag_commit(output, "v7.1.1")

    def test_post_publication_uses_released_versions_predecessor(self):
        releases = [
            {"tag_name": "v7.1.1", "draft": False, "prerelease": False},
            {"tag_name": "v7.1.0", "draft": False, "prerelease": False},
            {"tag_name": "v7.0.11", "draft": False, "prerelease": False},
            {"tag_name": "v9.0.0", "draft": True, "prerelease": False},
        ]
        opener = lambda *_args, **_kwargs: Response(json.dumps(releases).encode())
        self.assertEqual(published_predecessor_version("7.1.1", opener), "7.1.0")

    def test_post_publication_fails_when_current_release_is_absent(self):
        opener = lambda *_args, **_kwargs: Response(json.dumps([
            {"tag_name": "v7.1.0", "draft": False, "prerelease": False}
        ]).encode())
        with self.assertRaises(ConsistencyError):
            published_predecessor_version("7.1.1", opener)

    def test_clean_first_release_has_no_predecessor(self):
        opener = lambda *_args, **_kwargs: Response(json.dumps([
            {"tag_name": "v4.5.0", "draft": False, "prerelease": False}
        ]).encode())
        self.assertEqual(
            published_predecessor_version("4.5.0", opener),
            None,
        )


if __name__ == "__main__": unittest.main()
