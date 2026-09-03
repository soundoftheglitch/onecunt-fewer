#!/usr/bin/env python3
"""Build a deterministic Firefox XPI with Gecko-specific metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from build import ROOT, write_package


def firefox_manifest() -> dict:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    dependencies = [
        "search/indexer.js", "search/catalogue.js", "search/message-router.js",
        "search/compact-reader.js", "search/persistent-index-contract.js",
        "search/persistent-index-storage.js", "search/member-stats.js", "search/unanswered-state.js",
        "search/persistent-index-reader.js", "search/persistent-index-manager.js",
        "search/compiled-query.js", "search/compact-delta.js", "search/index-migration.js", "search/read-state.js",
        "search/saved-state.js", "search/notification-state.js",
        "search/notification-runtime.js", "search/block-list.js", "search/muted-threads.js", "search/categories.js",
    ]
    manifest["background"] = {"scripts": [*dependencies, "background.js"]}
    manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "fewercunts@soundoftheglitch.github.io",
            "strict_min_version": "140.0",
            "data_collection_permissions": {"required": ["none"]},
        }
    }
    return manifest


def build(output: Path) -> Path:
    manifest = firefox_manifest()
    expected_name = f"fewerCunts-firefox-{manifest['version']}.xpi"
    if output.is_dir() or output.suffix.lower() != ".xpi":
        output = output / expected_name
    firefox_manifest_bytes = json.dumps(manifest, indent=2).encode() + b"\n"
    return write_package(output, replacements={"manifest.json": firefox_manifest_bytes})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    print(build(args.output))


if __name__ == "__main__":
    main()
