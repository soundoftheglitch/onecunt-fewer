import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from verify import chromium_binary  # noqa: E402


class VerifyPortabilityTests(unittest.TestCase):
    def test_explicit_chromium_binary_supports_windows_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "chrome.exe"
            executable.touch()
            with patch.dict(os.environ, {"CHROMIUM_BINARY": str(executable)}):
                self.assertEqual(chromium_binary(), str(executable))

    def test_chrome_for_testing_requires_an_explicit_windows_path(self):
        def executable(name):
            return r"C:\chrome-win64\chrome.exe" if name == "chrome-for-testing" else None

        with patch.dict(os.environ, {}, clear=True), patch("verify.shutil.which", side_effect=executable):
            with self.assertRaisesRegex(RuntimeError, "always required"):
                chromium_binary()

    def test_branded_google_chrome_is_not_silently_selected(self):
        with patch.dict(os.environ, {}, clear=True), patch("verify.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Chrome 137"):
                chromium_binary()


if __name__ == "__main__":
    unittest.main()
