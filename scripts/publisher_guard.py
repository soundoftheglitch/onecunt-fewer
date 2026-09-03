#!/usr/bin/env python3
"""Fail-closed local authorization boundary for fewerCunts GitHub publishers."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import pwd
import re
import stat

from security_gate import verify as verify_security
import subprocess
from semver_gate import SemVerError, latest_public_stable, verify, verify_release_shape

OPERATOR = "x0ar"
GITHUB_LOGIN = "soundoftheglitch"
REPOSITORY = "soundoftheglitch/onecunt-fewer"
DEFAULT_BRANCH = "main"
ROOT = Path("/home/x0ar/Worktrees/ntforum-publisher")
SERVICE = Path("/home/x0ar/.config/systemd/user/fewercunts-snapshot-publish.service")
TIMER = Path("/home/x0ar/.config/systemd/user/fewercunts-snapshot-publish.timer")
PRIVATE_KEY = Path("/home/x0ar/.config/fewercunts/search-index-signing-private.pem")
GH_HOSTS = Path("/home/x0ar/.config/gh/hosts.yml")
ALLOWED_TAG = re.compile(r"v4\.5\.\d+\Z")
ALLOWED_ASSET = re.compile(r"(?:search-latest\.json|categories-latest\.json|ntforum-categories-v1\.json\.gz|ntforum-categories-v1\.manifest\.(?:json|sig)|ntforum-search-v1-[A-Za-z0-9.-]+|ntforum-search-v1\.manifest\.(?:json|sig)|fewerCunts(?:-firefox)?-4\.5\.\d+\.(?:zip|xpi))\Z")


class PublisherPolicyError(RuntimeError):
    """The local administrative publisher is not running in its allowlisted boundary."""


def command(*arguments: str) -> str:
    return subprocess.run(arguments, check=True, text=True, capture_output=True).stdout.strip()


def safe_file(path: Path, owner_uid: int, *, private: bool = False) -> None:
    resolved = path.resolve(strict=True)
    details = resolved.stat()
    if not stat.S_ISREG(details.st_mode) or details.st_uid != owner_uid or details.st_mode & 0o022:
        raise PublisherPolicyError(f"Unsafe publisher file ownership or mode: {resolved}")
    if private and stat.S_IMODE(details.st_mode) & 0o077:
        raise PublisherPolicyError(f"Private publisher material is accessible outside its owner: {resolved}")


def safe_directory(path: Path, owner_uid: int) -> None:
    resolved = path.resolve(strict=True)
    details = resolved.stat()
    if not stat.S_ISDIR(details.st_mode) or details.st_uid != owner_uid or details.st_mode & 0o022:
        raise PublisherPolicyError(f"Unsafe publisher directory ownership or mode: {resolved}")


def validate_release_target(tag: str, assets: list[str] | tuple[str, ...] = ()) -> None:
    if not ALLOWED_TAG.fullmatch(str(tag)):
        raise PublisherPolicyError("Release tag is outside the publisher allowlist")
    for asset in assets:
        if not ALLOWED_ASSET.fullmatch(Path(asset).name):
            raise PublisherPolicyError(f"Release asset is outside the publisher allowlist: {Path(asset).name}")


def validate_extension_release(kind: str, version: str, tag: str, assets: list[str] | tuple[str, ...],
                               *, public_version: str | None = None) -> dict:
    try:
        result = ({"result": "pass", "kind": "initial", "version": version}
                  if kind == "initial" and version == "4.5.0"
                  else verify(public_version or latest_public_stable(), version, kind))
        verify_release_shape(version, tag, [Path(asset).name for asset in assets])
        return result
    except SemVerError as error:
        raise PublisherPolicyError(f"Extension release gate failed: {error}") from error


def validate_checkout_path(path: Path) -> None:
    if path.resolve(strict=True) != ROOT.resolve(strict=True):
        raise PublisherPolicyError("Publisher repository path is not allowlisted")


def preflight(*, compact: bool = False, runner=command, effective_uid: int | None = None) -> dict:
    operator = pwd.getpwnam(OPERATOR)
    if (os.geteuid() if effective_uid is None else effective_uid) != operator.pw_uid:
        raise PublisherPolicyError(f"Publisher must run as local operator {OPERATOR}")
    validate_checkout_path(Path(__file__).resolve().parents[1])
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    verify_security("HEAD", packages=[ROOT / "dist" / f"fewerCunts-{version}.zip",
                                      ROOT / "dist" / f"fewerCunts-firefox-{version}.xpi"])
    for path in (Path(__file__), ROOT / "scripts/publish_compact_search_index.py",
                 ROOT / "scripts/publish_category_database.py", SERVICE, TIMER):
        safe_file(path, operator.pw_uid)
    safe_file(GH_HOSTS, operator.pw_uid, private=True)
    safe_directory(GH_HOSTS.parent, operator.pw_uid)
    if os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"):
        raise PublisherPolicyError("Publisher credentials must come from the OS credential store")
    if re.search(r"(?m)^\s*(?:oauth_token|token):\s*\S+", GH_HOSTS.read_text()):
        raise PublisherPolicyError("Plaintext GitHub credentials are forbidden")
    if compact:
        safe_file(PRIVATE_KEY, operator.pw_uid, private=True)
    login = runner("gh", "api", "user", "--jq", ".login")
    if login != GITHUB_LOGIN:
        raise PublisherPolicyError(f"Authenticated GitHub account is not {GITHUB_LOGIN}")
    repository = json.loads(runner("gh", "api", f"repos/{REPOSITORY}"))
    if repository.get("full_name") != REPOSITORY or repository.get("default_branch") != DEFAULT_BRANCH \
            or repository.get("archived") is not False:
        raise PublisherPolicyError("GitHub repository identity or state is not allowlisted")
    origin = runner("git", "-C", str(ROOT), "remote", "get-url", "origin")
    if origin not in {f"https://github.com/{REPOSITORY}.git", f"git@github.com:{REPOSITORY}.git"}:
        raise PublisherPolicyError("Git remote is outside the publisher allowlist")
    branch = runner("git", "-C", str(ROOT), "branch", "--show-current")
    if branch != DEFAULT_BRANCH:
        raise PublisherPolicyError(f"Publisher checkout must be on {DEFAULT_BRANCH}")
    head = runner("git", "-C", str(ROOT), "rev-parse", "HEAD")
    dirty = runner("git", "-C", str(ROOT), "status", "--porcelain=v1")
    if dirty:
        raise PublisherPolicyError("Publisher checkout contains uncommitted or untracked files")
    remote_head = runner("git", "ls-remote", origin, f"refs/heads/{DEFAULT_BRANCH}").split()[0]
    if not re.fullmatch(r"[0-9a-f]{40}", head) or remote_head != head:
        raise PublisherPolicyError("Publisher checkout has drifted from the GitHub default branch")
    return {"result": "authorized", "operator": OPERATOR, "forumAdmin": "dog hat",
            "githubLogin": login, "repository": REPOSITORY, "commit": head,
            "credentialLocation": "os-keyring"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compact", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(preflight(compact=arguments.compact), sort_keys=True))


if __name__ == "__main__":
    main()
