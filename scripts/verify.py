#!/usr/bin/env python3
"""Verify the filter engine and extension against live ntforum.net data."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "fewercunts-verification/1.0"
MONKEYBUTLER_LIVE_THREAD_ID = 2647


def get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def descendants(items):
    for item in items:
        yield item
        yield from descendants(item.get("Replies") or [])


def chromium_dump(url: str, *, extension: bool) -> str:
    chromium = shutil.which("chromium") or shutil.which("google-chrome")
    if not chromium:
        raise RuntimeError("Chromium or Google Chrome is required for verification")

    with tempfile.TemporaryDirectory(prefix="ntforum-blocker-test-") as profile:
        command = [
            chromium,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            f"--user-data-dir={profile}",
            "--virtual-time-budget=8000",
            "--dump-dom",
        ]
        if extension:
            command.extend(
                [
                    f"--disable-extensions-except={ROOT}",
                    f"--load-extension={ROOT}",
                ]
            )
        command.append(url)
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
            env={**os.environ, "HOME": profile},
        )
        return result.stdout


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    if manifest.get("manifest_version") != 3:
        raise AssertionError("manifest is not version 3")
    if manifest.get("name") != "fewerCunts":
        raise AssertionError("manifest name is not fewerCunts")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", manifest.get("version", "")):
        raise AssertionError("manifest version is not a Chromium numeric version")

    browser_test_url = (ROOT / "tests" / "browser-test.html").as_uri()
    test_dom = chromium_dump(browser_test_url, extension=False)
    if 'data-test-status="pass"' not in test_dom:
        raise AssertionError("filter-engine browser tests failed")

    catalog = get_json("https://ntforum.net/api/forum/threads")
    candidate = None
    target_reply_ids = []
    for thread in catalog["Threads"]:
        if str(thread.get("PostedByUsername", "")).strip().casefold() in {"soulisdead", "monkeybutler"}:
            continue
        replies = get_json(f"https://ntforum.net/api/forum/thread/{thread['Id']}/replies")
        matches = [
            item
            for item in descendants(replies)
            if str(item.get("PostedByUsername", "")).strip().casefold() == "soulisdead"
        ]
        if matches:
            candidate = thread
            target_reply_ids = [item["Id"] for item in matches]
            break

    live_url = "https://ntforum.net/"
    if candidate:
        live_url = f"https://ntforum.net/thread/{candidate['Id']}?p={candidate['PostCount']}"

    live_dom = chromium_dump(live_url, extension=True)
    if 'class="fewercunts-search-form"' not in live_dom:
        raise AssertionError("search extension did not replace the inert forum field")
    if 'placeholder="Search the forum"' not in live_dom:
        raise AssertionError("search input does not expose the replacement prompt")
    if "soulisdead" in live_dom.casefold():
        raise AssertionError("Soulisdead remained in the rendered forum DOM")
    if candidate and candidate["Title"].casefold() not in live_dom.casefold():
        raise AssertionError("the selected live thread did not render")

    monkeybutler_replies = get_json(
        f"https://ntforum.net/api/forum/thread/{MONKEYBUTLER_LIVE_THREAD_ID}/replies"
    )
    monkeybutler_reply_ids = [
        item["Id"]
        for item in descendants(monkeybutler_replies)
        if str(item.get("PostedByUsername", "")).strip().casefold() == "monkeybutler"
    ]
    if not monkeybutler_reply_ids:
        raise AssertionError("live monkeybutler fixture no longer contains a matching reply")

    monkeybutler_dom = chromium_dump(
        f"https://ntforum.net/thread/{MONKEYBUTLER_LIVE_THREAD_ID}", extension=True
    )
    if "monkeybutler" in monkeybutler_dom.casefold():
        raise AssertionError("monkeybutler remained in the rendered forum DOM")

    print(
        json.dumps(
            {
                "result": "pass",
                "manifestVersion": manifest["manifest_version"],
                "extensionVersion": manifest["version"],
                "browserEngineChecks": 8,
                "liveCatalogThreads": len(catalog["Threads"]),
                "liveThreadId": candidate["Id"] if candidate else None,
                "liveTargetReplyIdsRemoved": target_reply_ids,
                "liveMonkeybutlerThreadId": MONKEYBUTLER_LIVE_THREAD_ID,
                "liveMonkeybutlerReplyIdsRemoved": monkeybutler_reply_ids,
                "startupMaskVerifiedSeparately": True,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
