#!/usr/bin/env python3
"""Run the maintained test profile without the feature-specific browser matrix."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run(*arguments: str) -> None:
    subprocess.run(arguments, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", action="store_true",
                        help="also run the live Chromium release smoke verification")
    arguments = parser.parse_args()

    run("node", "--test", *sorted(str(path.relative_to(ROOT)) for path in (ROOT / "tests").glob("*.test.js")))
    run("python3", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py")
    run("python3", "scripts/validate_store.py")
    run("python3", "scripts/validate_firefox.py")
    run("python3", "scripts/security_gate.py", "--revision", "HEAD", "--release-packages")
    if arguments.release:
        run("python3", "scripts/verify.py")


if __name__ == "__main__":
    main()
