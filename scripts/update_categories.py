#!/usr/bin/env python3
"""Incrementally merge reviewed decisions and local-AI suggestions into the category DB."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import html
import json
import os
import shutil
import sqlite3
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE = Path("/home/x0ar/Archives/ntforum.net/ntforum.sqlite3")
CATEGORY_DB = Path("/home/x0ar/Archives/ntforum.net/ntforum-categorised-v1.sqlite3")
OUTBOX = Path("/home/x0ar/.local/state/fewercunts-category-outbox.json")
OLLAMA_URL = "http://172.17.0.1:11434/api/chat"
MODEL = "qwen3:4b"
MIN_CONFIDENCE = 0.68
LOCK = Path("/home/x0ar/.local/state/fewercunts-category-update.lock")


def digest_text(*values: str) -> str:
    payload = "\0".join(values).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def clean_text(value: str, limit: int) -> str:
    return " ".join(html.unescape(str(value or "")).split())[:limit]


def load_outbox(path: Path) -> dict[int, dict]:
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    records = value.get("assignments", []) if isinstance(value, dict) else []
    result = {}
    for item in records:
        try:
            thread_id = int(item["threadId"])
        except (KeyError, TypeError, ValueError):
            continue
        if thread_id > 0:
            result[thread_id] = item
    return result


def ai_category(title: str, message: str, taxonomy: list[tuple[str, str]], url: str, model: str) -> tuple[str, float, list[str]]:
    allowed = "\n".join(f"- {category_id}: {label}" for category_id, label in taxonomy if category_id != "uncategorised")
    prompt = f"""Choose exactly one category ID for this public forum thread.
Return JSON only: {{"categoryId":"...","confidence":0.0,"reason":"short phrase"}}.
If uncertain use categoryId "uncategorised" and confidence below {MIN_CONFIDENCE}.
Bare sports categories mean women's sport; men's and mixed require their explicit leaf. Never invent an ID.

Allowed IDs:
{allowed}

Title: {clean_text(title, 500)}
Opening post: {clean_text(message, 6000)}"""
    body = json.dumps({"model": model, "stream": False, "think": False, "format": "json", "options": {"temperature": 0, "num_ctx": 8192},
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        outer = json.load(response)
    parsed = json.loads(outer["message"]["content"])
    category_id = str(parsed.get("categoryId", "uncategorised"))
    confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0))))
    valid = {item[0] for item in taxonomy}
    if category_id not in valid or confidence < MIN_CONFIDENCE:
        return "uncategorised", confidence, ["local-ai-low-confidence"]
    return category_id, confidence, [clean_text(parsed.get("reason", "local-ai"), 240)]


def schema(db: sqlite3.Connection) -> None:
    db.executescript("""
      PRAGMA foreign_keys=ON;
      CREATE TABLE category_taxonomy(category_id TEXT PRIMARY KEY,parent_id TEXT REFERENCES category_taxonomy(category_id),name TEXT NOT NULL,sort_order INTEGER NOT NULL,taxonomy_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE thread_categories(thread_id INTEGER PRIMARY KEY REFERENCES threads(id),category_id TEXT NOT NULL REFERENCES category_taxonomy(category_id),confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),source TEXT NOT NULL CHECK(source IN ('automatic','manual')),evidence_json TEXT NOT NULL DEFAULT '[]',taxonomy_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE post_categories(post_id INTEGER PRIMARY KEY REFERENCES posts(id),thread_id INTEGER NOT NULL REFERENCES threads(id),category_id TEXT NOT NULL REFERENCES category_taxonomy(category_id),confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),source TEXT NOT NULL CHECK(source IN ('thread-inherited','manual')),taxonomy_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE category_overrides(kind TEXT NOT NULL CHECK(kind IN ('thread','reply')),item_id INTEGER NOT NULL,category_id TEXT NOT NULL REFERENCES category_taxonomy(category_id),updated_utc TEXT NOT NULL,PRIMARY KEY(kind,item_id));
      CREATE TABLE categorisation_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE category_thread_state(thread_id INTEGER PRIMARY KEY,content_sha256 TEXT NOT NULL,classifier TEXT NOT NULL,classified_utc TEXT NOT NULL);
      CREATE INDEX post_categories_category ON post_categories(category_id,post_id);
      CREATE INDEX thread_categories_category ON thread_categories(category_id,thread_id);
    """)


def update(archive: Path, current: Path, outbox: Path, ollama_url: str, model: str, dry_run: bool = False) -> dict:
    if not archive.is_file() or not current.is_file():
        raise RuntimeError("archive or prior category database is missing")
    with sqlite3.connect(f"file:{current}?mode=ro&immutable=1", uri=True) as old:
        taxonomy_rows = old.execute("SELECT category_id,parent_id,name,sort_order,taxonomy_version FROM category_taxonomy ORDER BY sort_order").fetchall()
        old_categories = {int(row[0]): row[1:] for row in old.execute("SELECT thread_id,category_id,confidence,source,evidence_json,taxonomy_version FROM thread_categories")}
        old_overrides = old.execute("SELECT kind,item_id,category_id,updated_utc FROM category_overrides").fetchall()
        try:
            old_state = {int(row[0]): row[1] for row in old.execute("SELECT thread_id,content_sha256 FROM category_thread_state")}
        except sqlite3.OperationalError:
            old_state = {}
    taxonomy = [(row[0], row[2]) for row in taxonomy_rows]
    valid = {row[0] for row in taxonomy_rows}
    reviews = load_outbox(outbox)
    for item in reviews.values():
        if item.get("categoryId") not in valid:
            raise RuntimeError("review outbox contains an unknown category")
    destination = current.with_suffix(current.suffix + ".next")
    if destination.exists():
        destination.unlink()
    shutil.copy2(archive, destination)
    db = sqlite3.connect(destination)
    automatic = manual = uncertain = classified = preserved = 0
    try:
        schema(db)
        db.executemany("INSERT INTO category_taxonomy VALUES(?,?,?,?,?)", taxonomy_rows)
        now = datetime.now(timezone.utc).isoformat()
        for thread_id, title, message in db.execute("SELECT id,title,message FROM threads ORDER BY id").fetchall():
            thread_id = int(thread_id)
            content_hash = digest_text(str(title), str(message))
            review = reviews.get(thread_id)
            previous = old_categories.get(thread_id)
            state_classifier = "preserved"
            if review:
                category_id, confidence, source, evidence = review["categoryId"], 1.0, "manual", ["dog-hat-review"]
                state_classifier = "manual"
                manual += 1
            elif previous and previous[2] == "manual":
                category_id, confidence, source, evidence = previous[0], float(previous[1]), "manual", json.loads(previous[3])
                state_classifier = "manual"
                manual += 1
            elif previous and (not old_state or old_state.get(thread_id) == content_hash):
                category_id, confidence, source, evidence = previous[0], float(previous[1]), previous[2], json.loads(previous[3])
                preserved += 1
            else:
                classified_now = True
                try:
                    category_id, confidence, evidence = ai_category(title, message, taxonomy, ollama_url, model)
                except Exception as error:
                    category_id, confidence, evidence = "uncategorised", 0.0, [f"local-ai-error:{type(error).__name__}"]
                    classified_now = False
                source = "automatic"; classified += 1
                state_classifier = model if classified_now else "retry-required"
            if category_id == "uncategorised": uncertain += 1
            elif source == "automatic": automatic += 1
            db.execute("INSERT INTO thread_categories VALUES(?,?,?,?,?,1)",
                       (thread_id, category_id, confidence, source, json.dumps(evidence, ensure_ascii=False)))
            if state_classifier != "retry-required":
                db.execute("INSERT INTO category_thread_state VALUES(?,?,?,?)", (thread_id, content_hash, state_classifier, now))
        for row in old_overrides:
            if row[0] == "reply" and db.execute("SELECT 1 FROM posts WHERE id=?", (row[1],)).fetchone():
                db.execute("INSERT INTO category_overrides VALUES(?,?,?,?)", row)
        db.execute("""INSERT INTO post_categories SELECT p.id,p.thread_id,COALESCE(o.category_id,t.category_id),CASE WHEN o.item_id IS NULL THEN t.confidence ELSE 1 END,CASE WHEN o.item_id IS NULL THEN 'thread-inherited' ELSE 'manual' END,1 FROM posts p JOIN thread_categories t ON t.thread_id=p.thread_id LEFT JOIN category_overrides o ON o.kind='reply' AND o.item_id=p.id""")
        db.executemany("INSERT INTO categorisation_metadata VALUES(?,?)", {
            "taxonomy_version": "1", "classifier": f"local-ai:{model}", "source_path": str(archive),
            "last_update_utc": now, "minimum_ai_confidence": str(MIN_CONFIDENCE),
            "sports_default": "Bare sport means women's; /mens and /mixed are explicit; /womens is forbidden.",
        }.items())
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("category database validation failed")
    finally:
        db.close()
    result = {"result": "dry-run" if dry_run else "updated", "classified": classified, "preserved": preserved,
              "manual": manual, "automatic": automatic, "uncategorised": uncertain,
              "reviewedThreadIds": sorted(reviews), "model": model}
    if dry_run:
        destination.unlink()
    else:
        os.replace(destination, current)
    return result


def acknowledge(path: Path, thread_ids: list[int]) -> None:
    current = load_outbox(path)
    for thread_id in thread_ids:
        current.pop(int(thread_id), None)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": 1, "assignments": list(current.values())}, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600); os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=ARCHIVE); parser.add_argument("--database", type=Path, default=CATEGORY_DB)
    parser.add_argument("--outbox", type=Path, default=OUTBOX); parser.add_argument("--ollama-url", default=OLLAMA_URL)
    parser.add_argument("--model", default=MODEL); parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ack", nargs="*", type=int)
    args = parser.parse_args()
    if args.ack is not None:
        acknowledge(args.outbox, args.ack); print(json.dumps({"result": "acknowledged", "threadIds": args.ack})); return
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(update(args.archive, args.database, args.outbox, args.ollama_url, args.model, args.dry_run), sort_keys=True))


if __name__ == "__main__":
    main()
