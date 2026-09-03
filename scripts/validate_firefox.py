#!/usr/bin/env python3
"""Validate the Firefox-specific fewerCunts package."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import zipfile

from build import PACKAGE_FILES
from validate_store import validate_visited_link_css

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    base_manifest = json.loads((ROOT / "manifest.json").read_text())
    package = ROOT / "dist" / f"fewerCunts-firefox-{base_manifest['version']}.xpi"
    assert package.is_file(), f"missing Firefox package: {package}"

    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        names = set(archive.namelist())
        assert "manifest.json" in names, "manifest.json must be at the XPI root"
        assert names == set(PACKAGE_FILES), f"unexpected XPI members: {sorted(names ^ set(PACKAGE_FILES))}"
        manifest = json.loads(archive.read("manifest.json"))
        validate_visited_link_css(archive.read("starting.css").decode())

    assert manifest["manifest_version"] == 3
    assert manifest["name"] == "fewerCunts"
    assert manifest["version"] == base_manifest["version"]
    assert manifest["content_scripts"][0]["world"] == "MAIN"
    assert manifest["content_scripts"][0]["matches"] == ["https://ntforum.net/*"]
    assert manifest.get("background", {}).get("scripts", [])[-1] == "background.js"
    assert manifest["background"]["scripts"][:-1] == [
        "search/indexer.js", "search/catalogue.js", "search/message-router.js",
        "search/compact-reader.js", "search/persistent-index-contract.js",
        "search/persistent-index-storage.js", "search/member-stats.js", "search/unanswered-state.js",
        "search/persistent-index-reader.js", "search/persistent-index-manager.js",
        "search/compiled-query.js", "search/compact-delta.js", "search/index-migration.js", "search/read-state.js",
        "search/saved-state.js", "search/notification-state.js",
        "search/notification-runtime.js", "search/block-list.js", "search/muted-threads.js", "search/categories.js",
    ]
    assert manifest.get("permissions", []) == ["alarms"]
    assert manifest.get("optional_permissions", []) == ["notifications"]
    assert manifest.get("host_permissions", []) == base_manifest["host_permissions"]
    gecko = manifest["browser_specific_settings"]["gecko"]
    assert gecko["id"] == "fewercunts@soundoftheglitch.github.io"
    assert gecko["strict_min_version"] == "140.0"
    assert gecko["data_collection_permissions"] == {"required": ["none"]}
    assert base_manifest.get("browser_specific_settings") is None

    print(json.dumps({"result": "pass", "package": str(package), "files": len(names)}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, KeyError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Firefox validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
