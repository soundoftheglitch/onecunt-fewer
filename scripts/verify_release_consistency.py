#!/usr/bin/env python3
"""Prove one fewerCunts commit, package, branches, tag, release and publisher state."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import zipfile

from build import PACKAGE_FILES, ROOT
from security_gate import verify as verify_security
from semver_gate import (KINDS, SemVerError, manifest_version, parse, verify_release_commit,
                         verify_release_commit_against, verify_release_shape)

REPOSITORY = "soundoftheglitch/onecunt-fewer"
PUBLISHER = Path("/home/x0ar/Worktrees/ntforum-publisher")


class ConsistencyError(RuntimeError):
    pass


def run(*arguments: str, cwd: Path = ROOT) -> str:
    return subprocess.run(arguments, cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def git_bytes(revision: str, path: str) -> bytes:
    return subprocess.run(["git", "show", f"{revision}:{path}"], cwd=ROOT, check=True, capture_output=True).stdout


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_archive(package: Path, revision: str = "HEAD") -> dict:
    manifest = json.loads(git_bytes(revision, "manifest.json"))
    expected_name = f"fewerCunts-{manifest['version']}.zip"
    if package.name != expected_name:
        raise ConsistencyError(f"Package name does not match committed manifest: {package.name} != {expected_name}")
    committed_package = git_bytes(revision, f"dist/{expected_name}")
    package_bytes = package.read_bytes()
    if committed_package != package_bytes:
        raise ConsistencyError("Working package differs from the package committed at the release revision")
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(PACKAGE_FILES):
            raise ConsistencyError("Package members or CRCs do not match the canonical build manifest")
        for member in PACKAGE_FILES:
            if archive.read(member) != git_bytes(revision, member):
                raise ConsistencyError(f"Package member differs from committed source: {member}")
    return {"manifest": manifest, "sha256": sha256(package_bytes), "bytes": package_bytes}


def remote_ref(ref: str) -> str:
    output = run("git", "ls-remote", f"https://github.com/{REPOSITORY}.git", ref)
    if not output:
        raise ConsistencyError(f"Missing public ref: {ref}")
    return output.split()[0]


def resolve_remote_tag_commit(output: str, tag: str) -> str:
    """Return the commit named by a lightweight tag or the peeled annotated tag."""
    direct = f"refs/tags/{tag}"
    peeled = f"{direct}^{{}}"
    refs: dict[str, str] = {}
    for line in output.splitlines():
        fields = line.split()
        if len(fields) != 2 or fields[1] not in (direct, peeled) or fields[1] in refs:
            raise ConsistencyError(f"Malformed or ambiguous public tag response: {tag}")
        refs[fields[1]] = fields[0]
    if direct not in refs or set(refs) - {direct, peeled}:
        raise ConsistencyError(f"Missing public tag: {tag}")
    return refs.get(peeled, refs[direct])


def remote_tag_commit(tag: str) -> str:
    output = run("git", "ls-remote", f"https://github.com/{REPOSITORY}.git",
                 f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}")
    return resolve_remote_tag_commit(output, tag)


def published_predecessor_version(version: str, opener=urllib.request.urlopen, sole_release_parent: str | None = None) -> str | None:
    """Find the greatest public stable SemVer below the released version."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=100",
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "fewercunts-anonymous-release-verifier/1"})
    with opener(request, timeout=60) as response:
        releases = json.load(response)
    if not isinstance(releases, list):
        raise ConsistencyError("GitHub releases response is not a list")
    stable: dict[tuple[int, int, int], str] = {}
    current_seen = False
    for release in releases:
        if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str) or not tag.startswith("v"):
            continue
        try:
            parsed = parse(tag[1:])
        except SemVerError:
            continue
        if parsed in stable:
            raise ConsistencyError(f"Duplicate public stable version: {tag[1:]}")
        stable[parsed] = tag[1:]
        current_seen = current_seen or tag[1:] == version
    if not current_seen:
        raise ConsistencyError(f"Released version is absent from public stable releases: {version}")
    previous = [item for item in stable if item < parse(version)]
    if not previous:
        if len(stable) == 1: return None
        raise ConsistencyError(f"Released version has no public stable predecessor: {version}")
    return stable[max(previous)]


def verify_published(revision: str = "HEAD") -> dict:
    head = run("git", "rev-parse", revision)
    state = verify_archive(ROOT / "dist" / f"fewerCunts-{json.loads(git_bytes(revision, 'manifest.json'))['version']}.zip", revision)
    version = state["manifest"]["version"]; tag = f"v{version}"
    verify_security(revision, packages=[
        ROOT / "dist" / f"fewerCunts-{version}.zip",
        ROOT / "dist" / f"fewerCunts-firefox-{version}.xpi",
    ])
    for ref in ("refs/heads/main",):
        if remote_ref(ref) != head:
            raise ConsistencyError(f"Public ref does not match release commit: {ref}")
    if remote_tag_commit(tag) != head:
        raise ConsistencyError(f"Peeled public tag does not match release commit: {tag}")
    publisher_head = run("git", "rev-parse", "HEAD", cwd=PUBLISHER)
    publisher_status = run("git", "status", "--porcelain=v1", cwd=PUBLISHER)
    if publisher_head != head or publisher_status:
        raise ConsistencyError("Dedicated publisher checkout does not exactly match the clean release commit")
    url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/fewerCunts-{version}.zip"
    request = urllib.request.Request(url, headers={"User-Agent": "fewercunts-anonymous-release-verifier/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        anonymous = response.read()
    if anonymous != state["bytes"]:
        raise ConsistencyError("Anonymous GitHub release asset differs from the committed package")
    release_url = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{tag}"
    with urllib.request.urlopen(urllib.request.Request(release_url, headers={
            "Accept": "application/vnd.github+json", "User-Agent": "fewercunts-anonymous-release-verifier/1"}),
            timeout=60) as response:
        release = json.load(response)
    if release.get("draft") or release.get("prerelease"):
        raise ConsistencyError("Version release must be public and stable")
    verify_release_shape(version, release.get("tag_name"), [item.get("name") for item in release.get("assets", [])])
    return {"result": "pass", "commit": head, "version": version, "tag": tag,
            "predecessorVersion": published_predecessor_version(version),
            "zipSha256": state["sha256"], "publisher": str(PUBLISHER), "anonymous": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--published", action="store_true", help="also verify public branches, tag, asset and publisher checkout")
    parser.add_argument("--update-kind", required=True, choices=KINDS,
                        help="mandatory final SemVer classification for this release commit")
    arguments = parser.parse_args()
    if arguments.published:
        result = verify_published()
        semver = (verify_release_commit(arguments.update_kind)
                  if arguments.update_kind == "initial"
                  else verify_release_commit_against(arguments.update_kind, result["predecessorVersion"]))
    else:
        semver = verify_release_commit(arguments.update_kind)
        manifest = json.loads(git_bytes("HEAD", "manifest.json"))
        verify_security("HEAD", packages=[
            ROOT / "dist" / f"fewerCunts-{manifest['version']}.zip",
            ROOT / "dist" / f"fewerCunts-firefox-{manifest['version']}.xpi",
        ])
        state = verify_archive(ROOT / "dist" / f"fewerCunts-{manifest['version']}.zip")
        result = {"result": "pass", "commit": run("git", "rev-parse", "HEAD"),
                  "version": manifest["version"], "zipSha256": state["sha256"]}
    result["semver"] = semver
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ConsistencyError, SemVerError, KeyError, OSError, ValueError, subprocess.CalledProcessError,
            urllib.error.URLError, zipfile.BadZipFile) as error:
        raise SystemExit(f"release consistency failed: {error}")
