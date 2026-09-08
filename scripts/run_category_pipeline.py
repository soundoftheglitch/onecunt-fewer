#!/usr/bin/env python3
"""Update, publish, then acknowledge reviewed category decisions transactionally."""
from __future__ import annotations
import fcntl
import json
import subprocess
from publish_category_database import publish, LOCK as PUBLISH_LOCK
from update_categories import CATEGORY_DB, OUTBOX, LOCK, acknowledge, update

def run() -> None:
    result = update(CATEGORY_DB.parent / "ntforum.sqlite3", CATEGORY_DB, OUTBOX,
                    "http://172.17.0.1:11434/api/chat", "qwen3:4b")
    with PUBLISH_LOCK.open("a") as publish_lock:
        fcntl.flock(publish_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(publish(), sort_keys=True))
    acknowledge(OUTBOX, result["reviewedThreadIds"])
    print(json.dumps(result, sort_keys=True))

def main() -> None:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run()

if __name__ == "__main__": main()
