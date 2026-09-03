#!/usr/bin/env python3
"""Resumable full-archive Qwen category campaign; active DB switches only when complete."""
from __future__ import annotations
import argparse, hashlib, html, json, os, shutil, sqlite3, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from update_categories import ARCHIVE, CATEGORY_DB, MODEL, OLLAMA_URL, MIN_CONFIDENCE, schema

STATE=Path('/home/x0ar/.local/state/fewercunts/deep-category-v1.sqlite3')
def clean(value,limit): return ' '.join(html.unescape(str(value or '')).split())[:limit]
def digest(title,message): return hashlib.sha256((str(title)+'\0'+str(message)).encode()).hexdigest()
def canonical(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def open_state(path):
    path.parent.mkdir(parents=True,exist_ok=True); db=sqlite3.connect(path); db.execute('pragma journal_mode=wal')
    db.executescript('''create table if not exists decisions(thread_id integer primary key,content_sha256 text not null,category_id text not null,confidence real not null,alternative_id text,reason text not null,classified_utc text not null,model text not null);
    create table if not exists metadata(key text primary key,value text not null);'''); return db

def classify(rows,taxonomy,url,model):
    allowed='\n'.join(f'- {i}: {n}' for i,n in taxonomy)
    prompt=f'''Classify every NTForum thread below. Output classifications only; do not copy title or openingPost. categoryId must be an approved ID. confidence is 0..1. Consider title and opening post, not the author's identity. Bare sport means women's; /mens and /mixed are explicit. Use uncategorised when evidence is insufficient.\nApproved categories:\n{allowed}\nThreads:\n{canonical(rows)}'''
    item={'type':'object','properties':{'threadId':{'type':'integer'},'categoryId':{'type':'string','enum':[x[0] for x in taxonomy]},'confidence':{'type':'number','minimum':0,'maximum':1},'reason':{'type':'string'}},'required':['threadId','categoryId','confidence','reason'],'additionalProperties':False}
    response_schema={'type':'object','properties':{'classifications':{'type':'array','items':item}},'required':['classifications'],'additionalProperties':False}
    body=json.dumps({'model':model,'stream':False,'think':False,'format':response_schema,'options':{'temperature':0,'num_ctx':16384,'num_predict':4096},'messages':[{'role':'user','content':prompt}]}).encode()
    with urllib.request.urlopen(urllib.request.Request(url,data=body,headers={'Content-Type':'application/json'}),timeout=900) as response: outer=json.load(response)
    values=json.loads(outer['message']['content']); expected={r['threadId'] for r in rows}; valid={x[0] for x in taxonomy}
    if isinstance(values,dict):
        if 'threadId' in values: values=[values]
        else: values=next((values[k] for k in ('items','classifications','results') if isinstance(values.get(k),list)),values)
    if isinstance(values,list):
        for value in values:
            if isinstance(value,dict) and isinstance(value.get('threadId'),str) and value['threadId'].isdigit(): value['threadId']=int(value['threadId'])
    if not isinstance(values,list) or {v.get('threadId') for v in values}!=expected or len(values)!=len(expected): raise ValueError('model did not return the exact batch')
    output=[]
    aliases={str(value).casefold():category_id for category_id,name in taxonomy for value in (category_id,name)}
    for v in values:
        if not {'threadId','categoryId','confidence'}<=set(v): raise ValueError(f'invalid model category response fields: {sorted(v) if isinstance(v,dict) else type(v).__name__}')
        v['reason']=str(v.get('reason') or v.get('explanation') or 'No model reason supplied')
        v['categoryId']=aliases.get(str(v['categoryId']).casefold(),v['categoryId']); v['alternativeId']='uncategorised'
        if v['categoryId'] not in valid: raise ValueError('invalid model category response')
        confidence=float(v['confidence'])
        if not 0<=confidence<=1 or not isinstance(v['reason'],str) or len(v['reason'])>500: raise ValueError('invalid model confidence or reason')
        output.append((int(v['threadId']),v['categoryId'] if confidence>=MIN_CONFIDENCE else 'uncategorised',confidence,v['alternativeId'],clean(v['reason'],500)))
    return output

def classify_resilient(rows,taxonomy,url,model):
    try: return classify(rows,taxonomy,url,model)
    except (ValueError,KeyError,json.JSONDecodeError):
        if len(rows)==1: raise
        middle=len(rows)//2
        return classify_resilient(rows[:middle],taxonomy,url,model)+classify_resilient(rows[middle:],taxonomy,url,model)

def finalise(source,current,state_db,taxonomy_rows):
    target=current.with_suffix(current.suffix+'.deep-next'); target.unlink(missing_ok=True); shutil.copy2(source,target)
    old=sqlite3.connect(f'file:{current}?mode=ro&immutable=1',uri=True); manual={int(i):(c,u) for i,c,u in old.execute("select item_id,category_id,updated_utc from category_overrides where kind='thread'")}; reply=list(old.execute("select kind,item_id,category_id,updated_utc from category_overrides where kind='reply'")); old.close()
    db=sqlite3.connect(target); schema(db); db.executemany('insert into category_taxonomy values(?,?,?,?,?)',taxonomy_rows)
    now=datetime.now(timezone.utc).isoformat(); decisions={int(r[0]):r[1:] for r in state_db.execute('select thread_id,category_id,confidence,alternative_id,reason,content_sha256 from decisions')}
    for thread_id,title,message in db.execute('select id,title,message from threads').fetchall():
        if thread_id in manual: category,confidence,source_name,evidence=manual[thread_id][0],1.0,'manual',['dog-hat-review']
        else:
            category,confidence,alternative,reason,_hash=decisions[thread_id]; source_name='automatic'; evidence=[reason,{'alternative':alternative}]
        db.execute('insert into thread_categories values(?,?,?,?,?,1)',(thread_id,category,confidence,source_name,json.dumps(evidence)))
        db.execute('insert into category_thread_state values(?,?,?,?)',(thread_id,digest(title,message),MODEL,now))
    for row in reply:
        if db.execute('select 1 from posts where id=?',(row[1],)).fetchone(): db.execute('insert into category_overrides values(?,?,?,?)',row)
    db.executemany("insert into category_overrides values('thread',?,?,?)",[(i,c,u) for i,(c,u) in manual.items()])
    db.execute("insert into post_categories select p.id,p.thread_id,coalesce(o.category_id,t.category_id),case when o.item_id is null then t.confidence else 1 end,case when o.item_id is null then 'thread-inherited' else 'manual' end,1 from posts p join thread_categories t on t.thread_id=p.thread_id left join category_overrides o on o.kind='reply' and o.item_id=p.id")
    db.executemany('insert into categorisation_metadata values(?,?)',{'taxonomy_version':'1','classifier':'deep-local-ai:'+MODEL,'last_update_utc':now,'minimum_ai_confidence':str(MIN_CONFIDENCE)}.items()); db.commit()
    if db.execute('pragma integrity_check').fetchone()[0]!='ok' or db.execute('pragma foreign_key_check').fetchall(): raise RuntimeError('deep database validation failed')
    db.close(); os.replace(target,current)

def run(args):
    started=time.monotonic(); state_db=open_state(args.state)
    current=sqlite3.connect(f'file:{args.database}?mode=ro&immutable=1',uri=True); taxonomy_rows=current.execute('select category_id,parent_id,name,sort_order,taxonomy_version from category_taxonomy order by sort_order').fetchall(); current.close(); taxonomy=[(r[0],r[2]) for r in taxonomy_rows]
    archive=sqlite3.connect(f'file:{args.archive}?mode=ro&immutable=1',uri=True); all_rows=archive.execute('select id,title,message from threads order by id').fetchall()
    pending=[]
    for thread_id,title,message in all_rows:
        h=digest(title,message); old=state_db.execute('select content_sha256 from decisions where thread_id=?',(thread_id,)).fetchone()
        if not old or old[0]!=h: pending.append({'threadId':thread_id,'title':clean(title,500),'openingPost':clean(message,5000),'contentSha256':h})
    total=len(all_rows); budget=min(len(pending),args.limit) if args.limit else len(pending); done=0
    for offset in range(0,budget,args.batch_size):
        batch=pending[offset:min(budget,offset+args.batch_size)]; values=classify_resilient(batch,taxonomy,args.ollama_url,args.model); now=datetime.now(timezone.utc).isoformat()
        by_id={r['threadId']:r for r in batch}
        state_db.executemany('insert or replace into decisions values(?,?,?,?,?,?,?,?)',[(i,by_id[i]['contentSha256'],c,n,a,r,now,args.model) for i,c,n,a,r in values]); state_db.commit(); done+=len(batch)
        print(json.dumps({'classifiedThisRun':done,'remaining':len(pending)-done,'seconds':round(time.monotonic()-started,1)}),flush=True)
    count=state_db.execute('select count(*) from decisions').fetchone()[0]
    remaining=len(pending)-done
    if count==total and remaining==0 and not args.no_finalise: finalise(args.archive,args.database,state_db,taxonomy_rows)
    archive.close(); state_db.close(); return {'result':'complete' if count==total and remaining==0 else 'checkpointed','total':total,'classified':count,'remaining':remaining,'seconds':round(time.monotonic()-started,1)}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--archive',type=Path,default=ARCHIVE); p.add_argument('--database',type=Path,default=CATEGORY_DB); p.add_argument('--state',type=Path,default=STATE); p.add_argument('--ollama-url',default=OLLAMA_URL); p.add_argument('--model',default=MODEL); p.add_argument('--batch-size',type=int,default=8); p.add_argument('--limit',type=int,default=0); p.add_argument('--no-finalise',action='store_true'); a=p.parse_args(); print(json.dumps(run(a),sort_keys=True))
if __name__=='__main__': main()
