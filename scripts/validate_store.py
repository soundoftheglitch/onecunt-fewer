#!/usr/bin/env python3
"""Validate the Chrome Web Store package and listing assets."""

from __future__ import annotations

import json
from pathlib import Path
import re
import struct
import sys
import zipfile

from build import PACKAGE_FILES

ROOT = Path(__file__).resolve().parents[1]
def validate_visited_link_css(css: str) -> None:
    visited_selectors = re.findall(r"([^{}]+:visited)\s*\{", css)
    assert all("fewercunts-unread" in selector for selector in visited_selectors), \
        "the extension must not override NTForum's theme-aware history-only visited-link rule"
    assert "#6a4c93" not in css.lower(), "the obsolete purple visited-link colour remains"
def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise AssertionError(f"not a PNG: {path}")
    return struct.unpack(">II", data[16:24])


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    package = ROOT / "dist" / f"fewerCunts-{manifest['version']}.zip"
    assert manifest["manifest_version"] == 3
    assert manifest["name"] == "fewerCunts"
    assert re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", manifest["version"])
    version_name = manifest.get("version_name")
    assert version_name is None or re.fullmatch(r"2\.0\.0-(?:alpha|beta|rc)\.\d+", version_name)
    assert version_name is None, "the stable release must expose only its manifest version"
    assert len(manifest["description"]) <= 132
    assert manifest.get("permissions", []) == ["alarms"]
    assert manifest.get("optional_permissions", []) == ["notifications"]
    assert manifest.get("host_permissions", []) == [
        "https://ntforum.net/api/forum/*",
        "https://raw.githubusercontent.com/soundoftheglitch/onecunt-fewer/*",
        "https://github.com/soundoftheglitch/onecunt-fewer/releases/download/*",
        "https://release-assets.githubusercontent.com/*",
        "http://127.0.0.1:8767/*",
    ]
    assert manifest.get("background") == {"scripts": ["background.js"], "service_worker": "background.js"}
    assert manifest["content_scripts"][0]["matches"] == ["https://ntforum.net/*"]
    assert manifest["content_scripts"][0]["js"][0] == "search/block-list.js"
    assert manifest["content_scripts"][1] == {
        "matches": ["https://ntforum.net/*"],
        "js": ["local-settings-transfer.js", "search/block-list.js", "archive-engine.js", "pagination-engine.js", "navigation-highlight.js", "navigation-state.js", "recent-searches.js", "about-content.js", "safe-links.js", "search/read-state.js", "search/saved-state.js", "search/categories.js", "search/dom-lifecycle.js", "search/category-ui.js", "search/ui-response.js", "search/ui-route.js", "search/ui-elements.js", "search/ui-unloved.js", "search/ui-categories.js", "search/ui.js"],
        "run_at": "document_idle",
    }
    search_ui = (ROOT / "search/ui.js").read_text() + (ROOT / "search/ui-elements.js").read_text()
    search_indexer = (ROOT / "search/indexer.js").read_text()
    compact_reader = (ROOT / "search/compact-reader.js").read_text()
    assert ".innerHTML" not in search_ui, "search results must never render source or query text as HTML"
    assert 'linkedText("div", "post-message", item.snippet)' in search_ui
    assert 'link.target = "_blank"' in search_ui and 'link.rel = "noopener noreferrer"' in search_ui
    assert "node.textContent = text" in search_ui
    assert 'email: ""' in search_indexer, "public legacy records must not gain email data"
    background = (ROOT / "background.js").read_text()
    assert "new FewerCuntsIndexer.InitialImporter" not in background
    assert "new FewerCuntsIndexer.IncrementalSynchronizer" not in background
    assert "new FewerCuntsIndexer.BootstrapImporter" not in background
    assert "return maintainDelta({ force })" in background
    assert "debounceMs: settings.refreshMinutes * 60_000" in background
    assert 'if (!settings.enabled) return { result: "disabled"' in background
    assert "search-snapshot-current" not in background
    assert "releases/download/v4.5.0/search-latest.json" in (ROOT / "background.js").read_text()
    assert "Compact manifest signature mismatch" in compact_reader
    assert "GENERATION_PREFIX" in compact_reader and "ACTIVE_KEY" in compact_reader

    expected_images = {
        ROOT / "icons/icon128.png": (128, 128),
        ROOT / "store/screenshot-1280x800.png": (1280, 800),
        ROOT / "store/small-promo-440x280.png": (440, 280),
    }
    for path, expected in expected_images.items():
        assert png_size(path) == expected, f"unexpected dimensions: {path}"

    assert package.is_file(), f"missing store package: {package}"
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        names = set(archive.namelist())
        assert "manifest.json" in names, "manifest.json must be at ZIP root"
        expected = set(PACKAGE_FILES)
        assert names == expected, f"unexpected package members: {sorted(names ^ expected)}"
        validate_visited_link_css(archive.read("starting.css").decode())

    print(json.dumps({"result": "pass", "package": str(package), "files": len(names)}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, KeyError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"store validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
