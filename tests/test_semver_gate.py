#!/usr/bin/env python3

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from semver_gate import SemVerError, expected, parse, verify, verify_release_shape  # noqa: E402
from publisher_guard import PublisherPolicyError, validate_extension_release  # noqa: E402


class SemVerGateTests(unittest.TestCase):
    def test_exact_transitions(self):
        self.assertEqual(expected("7.8.11", "bugfix"), "7.8.12")
        self.assertEqual(expected("7.8.11", "minor"), "7.9.0")
        self.assertEqual(expected("7.8.11", "major"), "8.0.0")
        for previous, current, kind in (("7.8.11", "7.8.12", "bugfix"),
                                        ("7.8.11", "7.9.0", "minor"),
                                        ("7.8.11", "8.0.0", "major")):
            self.assertEqual(verify(previous, current, kind)["result"], "pass")

    def test_rejects_skips_resets_and_mismatched_classification(self):
        for previous, current, kind in (("7.8.11", "7.8.13", "bugfix"),
                                        ("7.8.11", "7.9.1", "minor"),
                                        ("7.8.11", "8.1.0", "major"),
                                        ("7.8.11", "7.9.0", "bugfix"),
                                        ("7.8.11", "7.8.12", "minor")):
            with self.assertRaises(SemVerError): verify(previous, current, kind)

    def test_requires_three_canonical_numeric_components(self):
        for value in ("7", "7.8", "7.8.9.1", "v7.8.9", "7.08.9", "7.8-beta.1", "7.8.-1"):
            with self.assertRaises(SemVerError): parse(value)

    def test_requires_exact_tag_browser_assets_and_allowlisted_data(self):
        assets = ["fewerCunts-7.9.0.zip", "fewerCunts-firefox-7.9.0.xpi"]
        verify_release_shape("7.9.0", "v7.9.0", assets)
        verify_release_shape("7.9.0", "v7.9.0", assets + ["search-latest.json"])
        for tag, proposed_assets in (("7.9.0", assets), ("v7.9.0", assets[:1]),
                                     ("v7.9.0", assets + ["extra.txt"])):
            with self.assertRaises(SemVerError): verify_release_shape("7.9.0", tag, proposed_assets)

    def test_publisher_gate_uses_public_stable_and_fails_closed(self):
        assets = ["fewerCunts-7.9.0.zip", "fewerCunts-firefox-7.9.0.xpi"]
        self.assertEqual(validate_extension_release("minor", "7.9.0", "v7.9.0", assets,
                                                   public_version="7.8.11")["result"], "pass")
        with self.assertRaises(PublisherPolicyError):
            validate_extension_release("minor", "7.10.0", "v7.10.0", assets, public_version="7.8.11")

    def test_publisher_accepts_only_4_5_0_as_the_initial_release(self):
        assets = ["fewerCunts-4.5.0.zip", "fewerCunts-firefox-4.5.0.xpi"]
        self.assertEqual(validate_extension_release("initial", "4.5.0", "v4.5.0", assets)["result"], "pass")
        with self.assertRaises(PublisherPolicyError):
            validate_extension_release("initial", "4.5.1", "v4.5.1", assets)


if __name__ == "__main__": unittest.main()
