#!/usr/bin/env python3
"""Fail closed before credentials or sensitive page bridges reach GitHub."""

from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

from build import PACKAGE_FILES

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_KEY = "search/index-signing-public.pem"
TEXT_SUFFIXES = {".css", ".html", ".js", ".json", ".md", ".pem", ".py", ".sh", ".toml", ".txt", ".yaml", ".yml"}
FORBIDDEN_NAMES = re.compile(r"(^|/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|.*\.(?:key|p12|pfx))$", re.I)
RULES = {
    "github-token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "aws-access-key": re.compile(rb"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "bearer-secret": re.compile(rb"(?i)authorization\s*[:=]\s*['\"]?bearer\s+[A-Za-z0-9._~+/=-]{16,}"),
}
RUNTIME_RULES = {
    "password-input": re.compile(rb"(?i)(?:current-password|type\s*=\s*['\"]password['\"])"),
    "credential-bridge": re.compile(rb"(?:fewercunts:account-action|accountLogin\s*\(|\.service\(\)\.login\s*\(|detail\.password)"),
    "private-draft-bridge": re.compile(rb"fewercunts:draft-(?:request|result)|draft-state"),
    "cookie-access": re.compile(rb"(?:document\.cookie|(?:chrome|browser)\.cookies)"),
}


class SecurityGateError(RuntimeError):
    pass


def run(*arguments: str) -> str:
    command = arguments
    if arguments and arguments[0] == "git":
        command = ("git", "-c", f"safe.directory={ROOT}", *arguments[1:])
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def tracked_files(revision: str) -> list[str]:
    return [name for name in run("git", "ls-tree", "-r", "--name-only", revision).splitlines() if name]


def file_at(revision: str, name: str) -> bytes:
    return subprocess.run(["git", "-c", f"safe.directory={ROOT}", "show", f"{revision}:{name}"],
                          cwd=ROOT, check=True, capture_output=True).stdout


def revisions_to_scan(revision: str, since: str | None) -> list[str]:
    if not since or set(since) == {"0"}:
        return [revision]
    return [item for item in run("git", "rev-list", f"{since}..{revision}").splitlines() if item] or [revision]


def findings(name: str, data: bytes, *, packaged: bool) -> list[dict[str, str]]:
    found = []
    if FORBIDDEN_NAMES.search(name) and name != PUBLIC_KEY:
        found.append({"rule": "sensitive-filename", "path": name})
    for rule, pattern in RULES.items():
        if pattern.search(data):
            found.append({"rule": rule, "path": name})
    if name == PUBLIC_KEY and b"PRIVATE KEY" in data:
        found.append({"rule": "private-key-in-public-key", "path": name})
    if packaged:
        for rule, pattern in RUNTIME_RULES.items():
            if pattern.search(data):
                found.append({"rule": rule, "path": name})
    return found


def scan_revision(revision: str, since: str | None = None) -> list[dict[str, str]]:
    result = []
    for commit in revisions_to_scan(revision, since):
        for name in tracked_files(commit):
            sensitive_name = FORBIDDEN_NAMES.search(name) is not None
            if not sensitive_name and PurePosixPath(name).suffix.lower() not in TEXT_SUFFIXES:
                continue
            for item in findings(name, file_at(commit, name), packaged=name in PACKAGE_FILES):
                result.append({**item, "commit": commit[:12]})
    return result


def scan_package(package: Path) -> list[dict[str, str]]:
    result = []
    with zipfile.ZipFile(package) as archive:
        if archive.testzip() is not None:
            raise SecurityGateError(f"invalid archive: {package.name}")
        for name in archive.namelist():
            if FORBIDDEN_NAMES.search(name) or PurePosixPath(name).suffix.lower() in TEXT_SUFFIXES:
                result.extend(findings(name, archive.read(name), packaged=True))
    return [{**item, "package": package.name} for item in result]


def verify(revision: str = "HEAD", since: str | None = None, packages: list[Path] | None = None) -> dict:
    result = scan_revision(revision, since)
    for package in packages or []:
        if not package.is_file():
            raise SecurityGateError(f"missing package: {package.name}")
        result.extend(scan_package(package))
    if result:
        summary = ", ".join(f"{item['rule']}:{item['path']}" for item in result)
        raise SecurityGateError(f"security gate rejected {len(result)} finding(s): {summary}")
    return {"result": "pass", "revision": revision, "commitsScanned": len(revisions_to_scan(revision, since)),
            "packagesScanned": len(packages or [])}


def release_packages(revision: str) -> list[Path]:
    try:
        version = json.loads(file_at(revision, "manifest.json"))["version"]
    except (KeyError, json.JSONDecodeError) as error:
        raise SecurityGateError("invalid release manifest") from error
    return [ROOT / "dist" / f"fewerCunts-{version}.zip",
            ROOT / "dist" / f"fewerCunts-firefox-{version}.xpi"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--since")
    parser.add_argument("--package", action="append", type=Path, default=[])
    parser.add_argument("--release-packages", action="store_true")
    arguments = parser.parse_args()
    packages = arguments.package
    if arguments.release_packages:
        packages.extend(release_packages(arguments.revision))
    print(json.dumps(verify(arguments.revision, arguments.since, packages), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, SecurityGateError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"security gate failed: {error}", file=sys.stderr)
        raise SystemExit(1)
