#!/usr/bin/env python3
"""Atomically update signed compact NTForum assets on the sole 4.5.0 release."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
from datetime import datetime
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from publisher_guard import preflight, validate_release_target

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/home/x0ar/Archives/ntforum.net/ntforum.sqlite3")
PRIVATE_KEY = Path("/home/x0ar/.config/fewercunts/search-index-signing-private.pem")
PUBLIC_KEY = ROOT / "search/index-signing-public.pem"
REPOSITORY = "soundoftheglitch/onecunt-fewer"
RELEASE_TAG = "v4.5.0"
POINTER_URL = f"https://github.com/{REPOSITORY}/releases/download/{RELEASE_TAG}/search-latest.json"
GENERATION_PREFIX = "search-compact-editable-v1-"
EDITABLE = True
LOCK = Path("/home/x0ar/.local/state/fewercunts-compact-editable-publish.lock")


def run(*arguments: str, capture: bool = False) -> str:
    result = subprocess.run(arguments, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "fewerCunts-compact-publisher/1", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=120) as response:
        return response.read()


def remote_pointer() -> dict | None:
    try:
        return json.loads(download(POINTER_URL))
    except HTTPError as error:
        if error.code == 404:
            return None
        raise


def local_watermark() -> str:
    with sqlite3.connect(f"file:{SOURCE}?mode=ro&immutable=1", uri=True) as database:
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Local archive failed SQLite integrity_check")
        row = database.execute("SELECT value FROM metadata WHERE key='last_complete_sync'").fetchone()
    if not row or not row[0]:
        raise RuntimeError("Local archive has no complete-sync watermark")
    return row[0]


def release_exists(tag: str) -> bool:
    validate_release_target(tag)
    return subprocess.run(["gh", "api", f"repos/{REPOSITORY}/releases/tags/{tag}"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def verify_anonymous(pointer: dict, directory: Path) -> None:
    manifest_data = download(pointer["manifestUrl"])
    if len(manifest_data) != pointer["manifestBytes"] or hashlib.sha256(manifest_data).hexdigest() != pointer["manifestSha256"]:
        raise RuntimeError("Anonymous compact manifest verification failed")
    manifest = json.loads(manifest_data)
    if manifest["watermark"] != pointer["watermark"] or manifest["schemaVersion"] != pointer["schemaVersion"]:
        raise RuntimeError("Compact pointer and manifest disagree")
    (directory / "ntforum-search-v1.manifest.json").write_bytes(manifest_data)
    (directory / "ntforum-search-v1.manifest.sig").write_bytes(download(pointer["signatureUrl"]))
    for chunk in manifest["chunks"]:
        data = download(pointer["assetBaseUrl"] + "/" + chunk["name"])
        if len(data) != chunk["bytes"] or hashlib.sha256(data).hexdigest() != chunk["sha256"]:
            raise RuntimeError(f"Anonymous compact chunk verification failed: {chunk['name']}")
        (directory / chunk["name"]).write_bytes(data)
    run("python3", str(ROOT / "scripts/compile_search_index.py"), "verify", str(directory),
        "--public-key", str(PUBLIC_KEY))


def publish() -> dict:
    preflight(compact=True)
    if not SOURCE.is_file() or not PRIVATE_KEY.is_file() or not PUBLIC_KEY.is_file():
        raise RuntimeError("Compact publisher source or signing key is missing")
    current = remote_pointer()
    source_watermark = local_watermark()
    if current and current.get("schemaVersion") == 1 \
            and current.get("watermark", "") >= source_watermark:
        return {"result": "unchanged", "localWatermark": source_watermark,
                "remoteWatermark": current.get("watermark"), "generationTag": current.get("generationTag")}
    with tempfile.TemporaryDirectory(prefix="fewercunts-compact-publish-") as temporary_name:
        temporary = Path(temporary_name)
        output = temporary / "release"
        run("python3", str(ROOT / "scripts/compile_search_index.py"), "compile", str(SOURCE), str(output),
            "--signing-key", str(PRIVATE_KEY), "--chunk-bytes", str(16 * 1024 * 1024),
            *(["--include-blocked-authors"] if EDITABLE else []))
        manifest_path = output / "ntforum-search-v1.manifest.json"
        manifest_data = manifest_path.read_bytes()
        manifest = json.loads(manifest_data)
        if manifest["watermark"] != source_watermark:
            raise RuntimeError("Compiled manifest watermark does not match the complete local archive")

        stamp = datetime.fromisoformat(manifest["watermark"].replace("Z", "+00:00")).strftime("%Y%m%dT%H%M%S")
        manifest_hash = hashlib.sha256(manifest_data).hexdigest()
        generation_tag = f"{GENERATION_PREFIX}{stamp}-{manifest_hash[:12]}"
        if not release_exists(RELEASE_TAG):
            raise RuntimeError("The verified 4.5.0 release must exist before publishing data")
        assets = [manifest_path, output / "ntforum-search-v1.manifest.sig",
                  *[output / item["name"] for item in manifest["chunks"]]]
        validate_release_target(RELEASE_TAG, [str(item) for item in assets])
        run("gh", "release", "upload", RELEASE_TAG, *map(str, assets), "--repo", REPOSITORY, "--clobber")

        base = f"https://github.com/{REPOSITORY}/releases/download/{RELEASE_TAG}"
        pointer = {
            "format": "ntforum-compact-search-pointer", "schemaVersion": manifest["schemaVersion"],
            "watermark": manifest["watermark"], "generationTag": generation_tag,
            "manifestUrl": f"{base}/{manifest_path.name}", "manifestBytes": len(manifest_data),
            "manifestSha256": manifest_hash, "signatureUrl": f"{base}/ntforum-search-v1.manifest.sig",
            "assetBaseUrl": base, "publicKeySha256": hashlib.sha256(PUBLIC_KEY.read_bytes()).hexdigest()
        }
        verification = temporary / "verification"; verification.mkdir()
        verify_anonymous(pointer, verification)
        pointer_path = temporary / "search-latest.json"; pointer_path.write_bytes(canonical(pointer))
        validate_release_target(RELEASE_TAG, [str(pointer_path)])
        run("gh", "release", "upload", RELEASE_TAG, str(pointer_path), "--repo", REPOSITORY, "--clobber")
        published_pointer = json.loads(download(POINTER_URL + f"?generation={generation_tag}"))
        if published_pointer != pointer:
            raise RuntimeError("Published compact pointer did not switch to the verified generation")
        shutil.rmtree(verification)
        return {"result": "published", **pointer, "documentCount": manifest["documentCount"],
                "compressedBytes": manifest["compressedBytes"], "chunks": len(manifest["chunks"])}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--editable", action="store_true", help="accepted for compatibility; 4.5.0 is always editable")
    arguments = parser.parse_args()
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"result": "skipped", "reason": "publisher already running"}))
            return
        print(json.dumps(publish(), sort_keys=True))


if __name__ == "__main__":
    main()
