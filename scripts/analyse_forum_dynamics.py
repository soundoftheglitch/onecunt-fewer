#!/usr/bin/env python3
"""Build a local, evidence-first interaction graph from the public NTForum archive."""
from __future__ import annotations
import argparse, json, math, sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE=Path('/home/x0ar/Archives/ntforum.net/ntforum.sqlite3')
OUTPUT=Path('/home/x0ar/.local/state/fewercunts/forum-dynamics-v1.json')
FOCUS=('monkeybutler','soulisdead','gentleman teef','dog hat')
def norm(v): return ' '.join(str(v or '').split()).casefold()
def iso(v):
    try: return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except ValueError: return None
def entropy(values):
    total=sum(values)
    return 0 if not total else -sum((x/total)*math.log2(x/total) for x in values if x)

def analyse(source:Path=ARCHIVE)->dict:
    db=sqlite3.connect(f'file:{source}?mode=ro&immutable=1',uri=True)
    threads={int(i):(norm(a),iso(t)) for i,a,t in db.execute('select id,author,created_utc from threads')}
    posts={int(i):(int(t),int(p) if p is not None else None,norm(a),iso(c)) for i,t,p,a,c in db.execute('select id,thread_id,parent_id,author,created_utc from posts')}
    activity=defaultdict(lambda:{'threads':0,'replies':0,'activeDays':set(),'hours':Counter()}); edges=Counter(); latencies=defaultdict(list); shared=defaultdict(set)
    for thread_id,(author,created) in threads.items():
        if not author: continue
        activity[author]['threads']+=1; shared[thread_id].add(author)
        if created: activity[author]['activeDays'].add(created.date().isoformat()); activity[author]['hours'][created.hour]+=1
    for _post_id,(thread_id,parent_id,author,created) in posts.items():
        if not author: continue
        activity[author]['replies']+=1; shared[thread_id].add(author)
        if created: activity[author]['activeDays'].add(created.date().isoformat()); activity[author]['hours'][created.hour]+=1
        target,started=(posts[parent_id][2],posts[parent_id][3]) if parent_id in posts else threads.get(thread_id,('',None))
        if target and target!=author:
            edges[(author,target)]+=1
            if created and started:
                seconds=(created-started).total_seconds()
                if 0<=seconds<=86400*30: latencies[(author,target)].append(seconds)
    users={}
    for user,data in activity.items():
        hours=[data['hours'][h] for h in range(24)]; total=data['threads']+data['replies']
        users[user]={'threads':data['threads'],'replies':data['replies'],'posts':total,'activeDays':len(data['activeDays']),
                     'postsPerActiveDay':round(total/max(1,len(data['activeDays'])),2),'hourEntropy':round(entropy(hours),3),
                     'peakHoursUtc':[h for h,n in data['hours'].most_common(3)]}
    pair_rows=[]
    for a,b in sorted(edges):
        values=latencies[(a,b)]
        pair_rows.append({'from':a,'to':b,'directReplies':edges[(a,b)],'reciprocalReplies':edges.get((b,a),0),
                          'medianResponseMinutes':round(sorted(values)[len(values)//2]/60,1) if values else None})
    focus={}
    for name in FOCUS:
        partners=sorted((row for row in pair_rows if row['from']==name or row['to']==name),key=lambda x:x['directReplies'],reverse=True)[:20]
        focus[name]={'activity':users.get(name,{}),'strongestDirectedInteractions':partners}
    common=[]
    for i,a in enumerate(FOCUS):
        for b in FOCUS[i+1:]:
            both=sum(a in members and b in members for members in shared.values())
            common.append({'users':[a,b],'sharedThreads':both,'aToB':edges[(a,b)],'bToA':edges[(b,a)]})
    return {'schemaVersion':1,'generatedUtc':datetime.now(timezone.utc).isoformat(),'source':str(source),
            'limitations':['Public posting behaviour cannot establish account ownership or offline identity.','Shared timing, language, topics, or targets have benign alternative explanations.','Model-derived labels must be reviewed against linked posts.'],
            'counts':{'users':len(users),'threads':len(threads),'replies':len(posts),'directedEdges':len(pair_rows)},
            'focus':focus,'focusPairs':common,'topDirectedInteractions':sorted(pair_rows,key=lambda x:x['directReplies'],reverse=True)[:250]}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--archive',type=Path,default=ARCHIVE); parser.add_argument('--output',type=Path,default=OUTPUT); args=parser.parse_args()
    result=analyse(args.archive); args.output.parent.mkdir(parents=True,exist_ok=True); temporary=args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n'); temporary.chmod(0o600); temporary.replace(args.output)
    print(json.dumps({'result':'written','output':str(args.output),**result['counts']}))
if __name__=='__main__': main()
