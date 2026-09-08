#!/usr/bin/env python3
"""Bounded, resumable Qwen reply refinement; checkpoints never publish directly."""
from __future__ import annotations
import argparse
import fcntl
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from update_categories import CATEGORY_DB, OLLAMA_URL, MODEL, REFINEMENTS, refinement_hash
from deep_category_campaign import classify_resilient, clean

def connect(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path)
    db.executescript('''PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS refinements(post_id INTEGER PRIMARY KEY,context_hash TEXT NOT NULL,
      category_id TEXT NOT NULL,confidence REAL NOT NULL,reason TEXT NOT NULL,model TEXT NOT NULL,
      analysed_utc TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,next_retry REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);''')
    return db

def run(database, state, url, model, limit=2, timeout=240):
    checkpoint=connect(state)
    db=sqlite3.connect(f'file:{database}?mode=ro&immutable=1',uri=True)
    taxonomy=db.execute('select category_id,name from category_taxonomy order by sort_order').fetchall()
    maximum=db.execute('select coalesce(max(id),0) from posts').fetchone()[0]
    checkpoint.execute("insert or ignore into metadata values('initial_max_id',?)",(str(maximum),));checkpoint.commit()
    initial=int(checkpoint.execute("select value from metadata where key='initial_max_id'").fetchone()[0])
    previous={r[0]:r[1:] for r in checkpoint.execute('select post_id,context_hash,status,attempts,next_retry from refinements')}
    pending=[]
    for row in db.execute('''select p.id,p.message,p.created_utc,t.title,c.category_id,coalesce(parent.message,'')
      from posts p join threads t on t.id=p.thread_id join thread_categories c on c.thread_id=t.id
      join reply_category_decisions d on d.post_id=p.id left join posts parent on parent.id=p.parent_id
      where d.decision in ('analyse','preserve_link') order by p.created_utc,p.id'''):
        post_id,body,created,title,category,parent=row
        context=refinement_hash(body,title,category,parent)
        old=previous.get(post_id)
        if old and old[0]==context and (old[1]=='complete' or old[3]>time.time()): continue
        priority=0 if post_id>initial or old else 1
        pending.append((priority,created,post_id,context,title,category,body,parent))
    pending.sort(key=lambda r:(r[0],r[1],r[2]))
    processed=failures=0
    for _,created,post_id,context,title,category,body,parent in pending[:limit]:
        # The classifier uses the reply body as the target; thread and parent are context only.
        prompt_title='Classify this REPLY, preserving its thread category unless there is clear independent topical evidence. Thread: '+clean(title,300)+'; thread category: '+category
        result=classify_resilient([{'threadId':post_id,'title':prompt_title,'openingPost':clean(body,4000),
          'replySample':['Parent context only: '+clean(parent,1200)]}],taxonomy,url,model,timeout,1)[0]
        _,chosen,confidence,alternative,reason=result
        failed=reason.startswith('deep-local-ai-fallback:');failures+=int(failed)
        if chosen=='uncategorised':chosen=category
        attempts=(previous.get(post_id,(None,None,0,0))[2])+1
        checkpoint.execute('insert or replace into refinements values(?,?,?,?,?,?,?,?,?,?)',
          (post_id,context,chosen,confidence,reason,model,datetime.now(timezone.utc).isoformat(),
           'retry' if failed else 'complete',attempts,time.time()+min(21600,300*2**min(attempts-1,7)) if failed else 0))
        checkpoint.commit();processed+=1
    count=checkpoint.execute("select count(*) from refinements where status='complete'").fetchone()[0]
    checkpoint.close();db.close()
    return {'processedThisRun':processed,'failedThisRun':failures,'completedModelDecisions':count,'dueRemaining':len(pending)-processed}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',type=Path,default=CATEGORY_DB);p.add_argument('--state',type=Path,default=REFINEMENTS)
    p.add_argument('--ollama-url',default=OLLAMA_URL);p.add_argument('--model',default=MODEL)
    p.add_argument('--limit',type=int,default=2);p.add_argument('--request-timeout',type=int,default=240)
    a=p.parse_args();a.state.parent.mkdir(parents=True,exist_ok=True)
    with a.state.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        print(json.dumps(run(a.database,a.state,a.ollama_url,a.model,a.limit,a.request_timeout),sort_keys=True))
