#!/usr/bin/env python3
"""Compile and independently verify a release-ready NTForum compact index."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import resource
import sqlite3
import subprocess
import tempfile
import time

from compact_search_index import BLOCKED_AUTHORS, decode, encode, manifest_json

REQUIRED = {
    "threads": {"id", "title", "message", "author", "created_utc", "source_url"},
    "posts": {"id", "thread_id", "parent_id", "title", "message", "author", "created_utc", "source_url"},
    "metadata": {"key", "value"},
}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validated_source(path: Path) -> tuple[list[dict], dict]:
    if not path.is_file():
        raise ValueError(f"source is not a file: {path}")
    uri = f"file:{path.resolve()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity_check failed")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, required in REQUIRED.items():
            if table not in tables:
                raise ValueError(f"missing source table: {table}")
            columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
            if not required <= columns:
                raise ValueError(f"malformed {table} columns: missing {sorted(required - columns)}")
        metadata = dict(connection.execute("SELECT key,value FROM metadata"))
        watermark = metadata.get("last_complete_sync", "")
        if not watermark:
            raise ValueError("missing last_complete_sync watermark")
        thread_count = connection.execute("SELECT count(*) FROM threads").fetchone()[0]
        post_count = connection.execute("SELECT count(*) FROM posts").fetchone()[0]
        try:
            reported = int(metadata["reported_thread_count"])
        except (KeyError, ValueError) as error:
            raise ValueError("invalid reported_thread_count") from error
        if reported != thread_count:
            raise ValueError(f"thread count mismatch: database={thread_count}, reported={reported}")
        if connection.execute("SELECT count(*) FROM posts p LEFT JOIN threads t ON t.id=p.thread_id WHERE t.id IS NULL").fetchone()[0]:
            raise ValueError("orphan reply thread reference")
        if connection.execute("SELECT count(*) FROM posts p LEFT JOIN posts q ON q.id=p.parent_id WHERE p.parent_id IS NOT NULL AND q.id IS NULL").fetchone()[0]:
            raise ValueError("orphan reply parent reference")
        documents = []
        for row in connection.execute("""
            SELECT t.id,t.title,t.message,t.author,t.created_utc,t.source_url,
                   count(p.id) AS reply_count
            FROM threads t LEFT JOIN posts p ON p.thread_id=t.id
            GROUP BY t.id,t.title,t.message,t.author,t.created_utc,t.source_url
            ORDER BY t.id
        """):
            if row[0] <= 0 or any(row[key] is None for key in ("title", "message", "source_url")):
                raise ValueError(f"malformed thread {row[0]}")
            documents.append({"id": 2 * row[0], "threadId": 2 * row[0], "kind": "thread",
                              "username": row["author"] or "", "title": row["title"], "body": row["message"],
                              "createdUtc": row["created_utc"] or "", "canonicalUrl": row["source_url"],
                              "replyCount": row["reply_count"]})
        for row in connection.execute("SELECT id,thread_id,parent_id,title,message,author,created_utc,source_url FROM posts ORDER BY id"):
            if row[0] <= 0 or row[1] <= 0 or any(row[key] is None for key in ("title", "message", "author", "created_utc", "source_url")):
                raise ValueError(f"malformed reply {row[0]}")
            documents.append({"id": 2 * row[0] + 1, "threadId": 2 * row["thread_id"],
                              "parentId": 2 * row["parent_id"] + 1 if row["parent_id"] else None,
                              "kind": "reply", "username": row["author"], "title": row["title"],
                              "body": row["message"], "createdUtc": row["created_utc"],
                              "canonicalUrl": row["source_url"]})
        return documents, {"threadCount": thread_count, "replyCount": post_count,
                           "sourceDocumentCount": thread_count + post_count, "watermark": watermark}
    finally:
        connection.close()


def _openssl(arguments: list[str]) -> None:
    result = subprocess.run(["openssl", *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", "replace").strip() or "OpenSSL failed")


def compile_index(source: Path, output: Path, signing_key: Path, chunk_bytes: int, include_blocked_authors: bool = False) -> dict:
    if chunk_bytes < 1024:
        raise ValueError("chunk size must be at least 1024 bytes")
    started = time.perf_counter()
    documents, source_info = _validated_source(source)
    binary, manifest = encode(documents, watermark=source_info["watermark"],
                              blocked_authors=frozenset() if include_blocked_authors else BLOCKED_AUTHORS)
    # mtime=0 and an empty embedded filename make gzip byte-for-byte reproducible.
    compressed = gzip.compress(binary, compresslevel=9, mtime=0)
    output.mkdir(parents=True, exist_ok=True)
    chunks = []
    for index, offset in enumerate(range(0, len(compressed), chunk_bytes)):
        data = compressed[offset:offset + chunk_bytes]
        name = f"ntforum-search-v1-{index:04d}.gz.part"
        (output / name).write_bytes(data)
        chunks.append({"name": name, "bytes": len(data), "sha256": _sha(data)})
    manifest.update(source_info)
    manifest.update({"compression": "gzip-9-mtime-0", "compressedBytes": len(compressed),
                     "compressedSha256": _sha(compressed), "chunkBytesLimit": chunk_bytes,
                     "chunks": chunks})
    canonical = manifest_json(manifest)
    manifest_path = output / "ntforum-search-v1.manifest.json"
    manifest_path.write_bytes(canonical)
    signature_path = output / "ntforum-search-v1.manifest.sig"
    _openssl(["pkeyutl", "-sign", "-rawin", "-inkey", str(signing_key), "-in", str(manifest_path), "-out", str(signature_path)])
    # Volatile measurements are deliberately outside the signed release set so
    # two builds from identical input remain byte-identical.
    report = {"seconds": round(time.perf_counter() - started, 3),
              "peakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "rawBytes": len(binary), "compressedBytes": len(compressed)}
    (output / "build-report.json").write_bytes(manifest_json(report))
    return manifest


def verify_release(directory: Path, public_key: Path) -> dict:
    manifest_path = directory / "ntforum-search-v1.manifest.json"
    signature_path = directory / "ntforum-search-v1.manifest.sig"
    canonical = manifest_path.read_bytes()
    manifest = json.loads(canonical)
    if canonical != manifest_json(manifest):
        raise ValueError("manifest is not canonical")
    _openssl(["pkeyutl", "-verify", "-rawin", "-pubin", "-inkey", str(public_key),
              "-in", str(manifest_path), "-sigfile", str(signature_path)])
    pieces = []
    for expected in manifest["chunks"]:
        data = (directory / expected["name"]).read_bytes()
        if len(data) != expected["bytes"] or _sha(data) != expected["sha256"]:
            raise ValueError(f"chunk verification failed: {expected['name']}")
        if len(data) > manifest["chunkBytesLimit"]:
            raise ValueError("oversized chunk")
        pieces.append(data)
    compressed = b"".join(pieces)
    if len(compressed) != manifest["compressedBytes"] or _sha(compressed) != manifest["compressedSha256"]:
        raise ValueError("compressed asset mismatch")
    binary = gzip.decompress(compressed)
    if len(binary) != manifest["bytes"] or _sha(binary) != manifest["sha256"]:
        raise ValueError("index asset mismatch")
    decoded = decode(binary)
    if len(decoded["documents"]) != manifest["documentCount"] or decoded["watermark"] != manifest["watermark"]:
        raise ValueError("decoded count or watermark mismatch")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("compile")
    build.add_argument("source", type=Path); build.add_argument("output", type=Path)
    build.add_argument("--signing-key", type=Path, required=True)
    build.add_argument("--chunk-bytes", type=int, default=32 * 1024 * 1024)
    build.add_argument("--include-blocked-authors", action="store_true")
    verify = sub.add_parser("verify")
    verify.add_argument("directory", type=Path); verify.add_argument("--public-key", type=Path, required=True)
    args = parser.parse_args()
    result = (compile_index(args.source, args.output, args.signing_key, args.chunk_bytes, args.include_blocked_authors)
              if args.command == "compile" else verify_release(args.directory, args.public_key))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
