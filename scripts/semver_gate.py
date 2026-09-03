#!/usr/bin/env python3
"""Fail closed unless the release commit ends with the declared SemVer transition."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
KINDS = ("initial", "bugfix", "minor", "major")
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z")


class SemVerError(RuntimeError):
    pass


def parse(value: str) -> tuple[int, int, int]:
    match = VERSION.fullmatch(str(value))
    if not match:
        raise SemVerError(f"Version must be exactly major.minor.bugfix: {value!r}")
    return tuple(map(int, match.groups()))


def expected(previous: str, kind: str) -> str:
    major, minor, bugfix = parse(previous)
    if kind == "bugfix": return f"{major}.{minor}.{bugfix + 1}"
    if kind == "minor": return f"{major}.{minor + 1}.0"
    if kind == "major": return f"{major + 1}.0.0"
    raise SemVerError(f"Update kind must be one of: {', '.join(KINDS)}")


def verify(previous: str, current: str, kind: str) -> dict:
    wanted = expected(previous, kind)
    parse(current)
    if current != wanted:
        raise SemVerError(f"{kind} update must change {previous} to {wanted}, not {current}")
    return {"result": "pass", "kind": kind, "previousVersion": previous, "version": current}


def manifest_version(revision: str) -> str:
    raw = subprocess.run(["git", "show", f"{revision}:manifest.json"], cwd=ROOT,
                         check=True, capture_output=True, text=True).stdout
    return str(json.loads(raw)["version"])


def verify_release_commit(kind: str, revision: str = "HEAD") -> dict:
    if kind == "initial":
        current = manifest_version(revision)
        if current != "4.5.0": raise SemVerError("Initial release must be exactly 4.5.0")
        parents = subprocess.run(["git", "rev-list", "--parents", "-n", "1", revision], cwd=ROOT,
                                 check=True, capture_output=True, text=True).stdout.split()
        if len(parents) != 1: raise SemVerError("Initial release must be a root commit")
        return {"result": "pass", "kind": kind, "version": current, "rootCommit": True}
    return verify_release_commit_against(kind, latest_public_stable(), revision)


def latest_public_stable(opener=urllib.request.urlopen) -> str:
    request = urllib.request.Request(
        "https://api.github.com/repos/soundoftheglitch/onecunt-fewer/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "fewercunts-semver-gate/1"})
    with opener(request, timeout=30) as response:
        release = json.load(response)
    tag = release.get("tag_name")
    if release.get("draft") or release.get("prerelease") or not isinstance(tag, str) or not tag.startswith("v"):
        raise SemVerError("Latest GitHub release is not a public stable vMAJOR.MINOR.BUGFIX release")
    parse(tag[1:])
    return tag[1:]


def verify_release_commit_against(kind: str, public_version: str, revision: str = "HEAD") -> dict:
    if kind == "initial": return verify_release_commit(kind, revision)
    current = manifest_version(revision)
    # Both checks are mandatory: public stable prevents skipped releases, while the parent check
    # prevents a pre-bumped development commit from being pushed as the release commit.
    result = verify(public_version, current, kind)
    parent = manifest_version(f"{revision}^")
    if parent == current:
        raise SemVerError("Release commit does not contain the manifest version transition")
    result["parentVersion"] = parent
    return result


def verify_release_shape(version: str, tag: str, assets: list[str]) -> None:
    parse(version)
    if tag != f"v{version}":
        raise SemVerError(f"Release tag must be exactly v{version}")
    required = {f"fewerCunts-{version}.zip", f"fewerCunts-firefox-{version}.xpi"}
    if not all(isinstance(asset, str) for asset in assets):
        raise SemVerError("Release asset names must be strings")
    names = set(assets)
    if len(names) != len(assets) or not required.issubset(names):
        raise SemVerError(f"Release must contain exactly one of each package: {', '.join(sorted(required))}")
    allowed_data = re.compile(r"(?:search-latest\.json|categories-latest\.json|ntforum-search-v1-\d{4}\.gz\.part|ntforum-search-v1\.manifest\.(?:json|sig)|ntforum-categories-v1\.(?:json\.gz|manifest\.(?:json|sig)))\Z")
    unexpected = sorted(names - required - {name for name in names if allowed_data.fullmatch(name)})
    if unexpected: raise SemVerError(f"Unexpected release assets: {', '.join(unexpected)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=KINDS)
    parser.add_argument("--revision", default="HEAD")
    arguments = parser.parse_args()
    print(json.dumps(verify_release_commit(arguments.kind, arguments.revision), sort_keys=True))


if __name__ == "__main__":
    try: main()
    except (SemVerError, KeyError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"SemVer release gate failed: {error}")
