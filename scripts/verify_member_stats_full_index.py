#!/usr/bin/env python3
"""Compare JavaScript member aggregates with the complete local NTForum archive."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path("/home/x0ar/Archives/ntforum.net/ntforum.sqlite3")


def normalise(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFKD", value or "")
                   if not unicodedata.combining(character)).strip().lower()


def main() -> None:
    expected: dict[str, dict] = {}
    documents = []
    connection = sqlite3.connect(f"file:{ARCHIVE}?mode=ro", uri=True)
    try:
        rows = connection.execute("""
            SELECT id, id, NULL, 't', coalesce(author,''), coalesce(created_utc,'') FROM threads
            UNION ALL
            SELECT thread_id, id, parent_id, 'r', coalesce(author,''), coalesce(created_utc,'') FROM posts
            ORDER BY 1,2
        """)
        for thread_id, post_id, parent_id, kind, username, created_utc in rows:
            documents.append([thread_id, post_id, parent_id, kind, username, created_utc])
            key = normalise(username)
            if not key:
                continue
            item = expected.setdefault(key, {"topicCount": 0, "replyCount": 0,
                "latestTopicUtc": "", "latestReplyUtc": ""})
            field = "topicCount" if kind == "t" else "replyCount"
            latest = "latestTopicUtc" if kind == "t" else "latestReplyUtc"
            item[field] += 1
            item[latest] = max(item[latest], created_utc)
    finally:
        connection.close()

    with tempfile.NamedTemporaryFile("w", suffix=".json") as source:
        json.dump(documents, source, ensure_ascii=False); source.flush()
        javascript = r"""
const fs=require('fs'), {performance}=require('perf_hooks');
const api=require(process.argv[1]), unanswered=require(process.argv[2]), documents=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const threads=new Map(), conversations=new unanswered.ConversationBuilder();
for(const [threadId,postId,parentPostId,kind,username,createdUtc] of documents){
  if(!threads.has(threadId)) threads.set(threadId,[]); threads.get(threadId).push({kind,username,createdUtc});
  conversations.add({docKey:`${kind}:${postId}`,postId,threadId,parentPostId,kind,username,createdUtc,body:'',title:'',canonicalUrl:''});
}
const entries=[]; for(const [threadId,values] of threads) entries.push([threadId,api.threadContributions(values)]);
const before=process.memoryUsage().heapUsed, started=performance.now(), stats=new api.MemberStatistics();
const records=stats.replaceThreads(entries), conversationThreads=conversations.finish(), elapsed=performance.now()-started;
const values={}; for(const item of records) values[item.normalisedUsername]={topicCount:item.topicCount,
 replyCount:item.replyCount,latestTopicUtc:item.latestTopicUtc,latestReplyUtc:item.latestReplyUtc};
process.stdout.write(JSON.stringify({values,threads:threads.size,documents:documents.length,
 conversationCandidates:[...conversationThreads.values()].reduce((total,items)=>total+items.length,0),
 milliseconds:+elapsed.toFixed(2),heapMiB:+((process.memoryUsage().heapUsed-before)/1048576).toFixed(2)}));
"""
        result = subprocess.run(["node", "-e", javascript, str(ROOT / "search/member-stats.js"),
                                 str(ROOT / "search/unanswered-state.js"), source.name],
                                check=True, capture_output=True, text=True)
    actual = json.loads(result.stdout)
    assert actual.pop("values") == expected
    assert actual["threads"] == 15_243
    assert actual["documents"] >= 363_276
    print(json.dumps({"result": "pass", "members": len(expected), **actual}, sort_keys=True))


if __name__ == "__main__":
    main()
