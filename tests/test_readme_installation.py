from pathlib import Path
import json
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class BeginnerReadmeTests(unittest.TestCase):
    def setUp(self):
        self.readme = (ROOT / "README.md").read_text()
        self.version = json.loads((ROOT / "manifest.json").read_text())["version"]

    def test_downloads_match_the_current_release(self):
        expected = {
            f"https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v{self.version}/fewerCunts-{self.version}.zip",
            f"https://github.com/soundoftheglitch/onecunt-fewer/releases/download/v{self.version}/fewerCunts-firefox-{self.version}.xpi",
        }
        links = set(re.findall(r"https://[^)]+", self.readme))
        self.assertTrue(expected.issubset(links))
        packaged_versions = set(re.findall(
            r"fewerCunts(?:-firefox)?-(\d+\.\d+\.\d+)\.(?:zip|xpi)", self.readme))
        self.assertEqual(packaged_versions, {self.version})

    def test_beginner_path_covers_the_complete_lifecycle(self):
        for heading in (
            "## Install", "### Chromium installation", "### Firefox installation",
            "## If something goes wrong", "## Update", "## Uninstall", "## Privacy",
        ):
            self.assertIn(heading, self.readme)
        for checkpoint in ("manifest.json", "Developer mode", "Load unpacked", "Installation is complete"):
            self.assertIn(checkpoint, self.readme)

    def test_developer_commands_are_kept_out_of_the_beginner_guide(self):
        for command in ("node --test", "python3 scripts/build.py", "security_gate.py"):
            self.assertNotIn(command, self.readme)
        self.assertIn("docs/DEVELOPING.md", self.readme)

    def test_relative_links_exist(self):
        links = re.findall(r"(?<!!)\[[^]]+\]\(([^)]+)\)", self.readme)
        relative = [link.split("#", 1)[0] for link in links
                    if "://" not in link and not link.startswith("#")]
        self.assertTrue(relative)
        for target in relative:
            with self.subTest(target=target):
                self.assertTrue((ROOT / target).is_file(), target)

    def test_version_five_requires_a_verified_beginner_installer(self):
        strategy = (ROOT / "docs/v5-installation-strategy.md").read_text()
        for phrase in ("Do not publish v5", "Chrome Web Store", "Mozilla-signed Firefox",
                       "automatic update", "clean profile"):
            self.assertIn(phrase, strategy)


if __name__ == "__main__":
    unittest.main()
