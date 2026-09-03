#!/usr/bin/env python3
"""Update, publish, then acknowledge reviewed category decisions transactionally."""
from __future__ import annotations
import json
import subprocess
from update_categories import CATEGORY_DB, OUTBOX, acknowledge, update

def main() -> None:
    result = update(CATEGORY_DB.parent / "ntforum.sqlite3", CATEGORY_DB, OUTBOX,
                    "http://172.17.0.1:11434/api/chat", "qwen3:4b")
    subprocess.run(["/usr/bin/python3", str(__import__("pathlib").Path(__file__).with_name("publish_category_database.py"))], check=True)
    acknowledge(OUTBOX, result["reviewedThreadIds"])
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__": main()
