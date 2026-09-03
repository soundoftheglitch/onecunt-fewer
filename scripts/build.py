#!/usr/bin/env python3
"""Build a deterministic, root-manifest Chromium extension ZIP."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
from typing import Mapping
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_FILES = (
    "manifest.json",
    "local-settings-transfer.js",
    "content.js",
    "filter-engine.js",
    "archive-engine.js",
    "pagination-engine.js",
    "navigation-highlight.js",
    "navigation-state.js",
    "recent-searches.js",
    "about-content.js",
    "safe-links.js",
    "starting.css",
    "background.js",
    "search/indexer.js",
    "search/catalogue.js",
    "search/message-router.js",
    "search/compact-reader.js",
    "search/persistent-index-contract.js",
    "search/persistent-index-storage.js",
    "search/member-stats.js",
    "search/persistent-index-reader.js",
    "search/persistent-index-manager.js",
    "search/compiled-query.js",
    "search/compact-delta.js",
    "search/index-migration.js",
    "search/read-state.js",
    "search/unanswered-state.js",
    "search/saved-state.js",
    "search/notification-state.js",
    "search/notification-runtime.js",
    "search/block-list.js",
    "search/muted-threads.js",
    "search/categories.js",
    "search/dom-lifecycle.js",
    "search/category-ui.js",
    "search/categories-data.json",
    "search/index-signing-public.pem",
    "search/ui-response.js",
    "search/ui-route.js",
    "search/ui-elements.js",
    "search/ui-unloved.js",
    "search/ui-categories.js",
    "search/ui.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
)
ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def write_package(
    output: Path,
    *,
    replacements: Mapping[str, bytes] | None = None,
) -> Path:
    """Write the shared package files deterministically."""
    replacements = replacements or {}
    temporary = output.with_suffix(output.suffix + ".tmp")
    output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative_name in PACKAGE_FILES:
            info = zipfile.ZipInfo(relative_name, ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            data = replacements.get(relative_name, (ROOT / relative_name).read_bytes())
            archive.writestr(info, data)
    temporary.replace(output)
    return output


def build(output: Path) -> Path:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    expected_name = f"fewerCunts-{manifest['version']}.zip"
    if output.is_dir() or output.suffix.lower() != ".zip":
        output = output / expected_name
    return write_package(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--desktop-copy", type=Path)
    args = parser.parse_args()

    package = build(args.output)
    if args.desktop_copy:
        args.desktop_copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(package, args.desktop_copy)
    print(package)


if __name__ == "__main__":
    main()
