#!/usr/bin/env python3
"""Loopback-only receiver for reviewed thread-category decisions."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_OUTBOX = Path("/home/x0ar/.local/state/fewercunts-category-outbox.json")
DEFAULT_DATABASE = Path("/home/x0ar/Archives/ntforum.net/ntforum-categorised-v1.sqlite3")
EXTENSION_ORIGIN = re.compile(r"(?:chrome-extension://[a-p]{32}|moz-extension://[0-9a-f-]{36})\Z")


def read_records(path: Path) -> dict[int, dict]:
    if not path.exists(): return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return {int(item["threadId"]): item for item in value.get("assignments", [])}


def store(path: Path, item: dict) -> None:
    records = read_records(path); records[int(item["threadId"])] = item
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": 1, "assignments": list(records.values())}, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600); os.replace(temporary, path)


def handler(outbox: Path, database: Path):
    class Handler(BaseHTTPRequestHandler):
        server_version = "fewerCunts-category-outbox/1"
        def allowed(self) -> bool:
            return bool(EXTENSION_ORIGIN.fullmatch(self.headers.get("Origin", "")))
        def send_json_headers(self, status: int = 200) -> None:
            self.send_response(status); self.send_header("Content-Type", "application/json")
            if self.allowed(): self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin")); self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS"); self.end_headers()
        def do_OPTIONS(self):
            self.send_json_headers(204 if self.allowed() else 403)
        def do_POST(self):
            if self.path != "/v1/thread-category" or not self.allowed(): self.send_json_headers(403); self.wfile.write(b'{"ok":false}'); return
            try:
                length = int(self.headers.get("Content-Length", "0"));
                if length < 2 or length > 4096: raise ValueError("invalid body size")
                item = json.loads(self.rfile.read(length)); thread_id = int(item.get("threadId", 0)); category_id = str(item.get("categoryId", ""))
                if thread_id < 1: raise ValueError("invalid thread")
                with sqlite3.connect(f"file:{database}?mode=ro&immutable=1", uri=True) as db:
                    if not db.execute("SELECT 1 FROM threads WHERE id=?", (thread_id,)).fetchone(): raise ValueError("unknown thread")
                    if not db.execute("SELECT 1 FROM category_taxonomy WHERE category_id=?", (category_id,)).fetchone(): raise ValueError("unknown category")
                record = {"threadId": thread_id, "categoryId": category_id, "reviewedBy": "dog hat"}
                store(outbox, record); self.send_json_headers(); self.wfile.write(json.dumps({"ok": True, **record}).encode())
            except Exception as error:
                self.send_json_headers(400); self.wfile.write(json.dumps({"ok": False, "error": str(error)}).encode())
        def log_message(self, format, *args):
            return
    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--host", default="127.0.0.1"); parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--outbox", type=Path, default=DEFAULT_OUTBOX); parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    if args.host != "127.0.0.1": raise SystemExit("category outbox must remain loopback-only")
    ThreadingHTTPServer((args.host, args.port), handler(args.outbox, args.database)).serve_forever()


if __name__ == "__main__": main()
