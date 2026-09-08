#!/usr/bin/env python3
"""Publish the signed category map on the sole 4.5.0 release."""
from __future__ import annotations
import time
from urllib.error import HTTPError
import fcntl, gzip, hashlib, json, shutil, sqlite3, subprocess, tempfile
from pathlib import Path
from urllib.request import Request, urlopen
from update_categories import LOCK as UPDATE_LOCK
from publisher_guard import preflight, validate_release_target

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/home/x0ar/Archives/ntforum.net/ntforum-categorised-v1.sqlite3")
PRIVATE_KEY = Path("/home/x0ar/.config/fewercunts/search-index-signing-private.pem")
PUBLIC_KEY = ROOT / "search/index-signing-public.pem"
REPOSITORY = "soundoftheglitch/onecunt-fewer"
LOCK = Path("/home/x0ar/.local/state/fewercunts-categories-publish.lock")

def run(*args, capture=False):
    value = subprocess.run(args, check=True, text=True, capture_output=capture)
    return value.stdout.strip() if capture else ""
def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()
def canonical(value): return (json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()
def download(url, *, missing_ok=False):
    # GitHub/CDN may retain a negative lookup made before an immutable asset
    # was uploaded. Every verification must observe a fresh object response.
    for attempt in range(5):
        fresh=url + ('&' if '?' in url else '?') + 'verify=' + str(time.time_ns())
        try:
            with urlopen(Request(fresh,headers={"User-Agent":"fewerCunts-categories-publisher/1","Cache-Control":"no-cache"}),timeout=180) as response:
                return response.read()
        except HTTPError as error:
            if (missing_ok and error.code==404) or error.code not in (404,429,500,502,503,504) or attempt==4:
                raise
            time.sleep(0.25 * 2**attempt)

def release_exists(tag):
    validate_release_target(tag)
    return subprocess.run(["gh","api",f"repos/{REPOSITORY}/releases/tags/{tag}"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0

def publish():
    preflight(compact=True)
    with sqlite3.connect(f"file:{SOURCE}?mode=ro&immutable=1",uri=True) as db:
        assert db.execute("pragma integrity_check").fetchone()[0]=="ok"
        threads=db.execute("select count(*) from thread_categories").fetchone()[0]
        replies=db.execute("select count(*) from post_categories").fetchone()[0]
        automatic=db.execute("select count(*) from thread_categories where category_id!='uncategorised'").fetchone()[0]
        forbidden=db.execute("select count(*) from category_taxonomy where lower(category_id) like '%women%' or lower(name) like '%women%'").fetchone()[0]
        assert threads==db.execute("select count(*) from threads").fetchone()[0]
        assert replies==db.execute("select count(*) from posts").fetchone()[0]
        assert forbidden==0
        assert db.execute("select count(*) from thread_categories where category_id not in (select category_id from category_taxonomy)").fetchone()[0]==0
        has_reply_decisions=db.execute("select count(*) from sqlite_master where type='table' and name='reply_category_decisions'").fetchone()[0]
        if not has_reply_decisions:
            raise RuntimeError("Refusing category publication: reply decisions are missing")
        reply_decisions=reply_analyse=reply_links=reply_ignored=0
        if has_reply_decisions:
            columns = {row[1] for row in db.execute("PRAGMA table_info(reply_category_decisions)")}
            assert "context_sha256" in columns
            reply_decisions=db.execute("select count(*) from reply_category_decisions").fetchone()[0]
            reply_analyse=db.execute("select count(*) from reply_category_decisions where decision='analyse'").fetchone()[0]
            reply_links=db.execute("select count(*) from reply_category_decisions where decision='preserve_link'").fetchone()[0]
            reply_ignored=db.execute("select count(*) from reply_category_decisions where decision='ignore_junk'").fetchone()[0]
            assert reply_decisions==db.execute("select count(*) from posts").fetchone()[0]
            assert db.execute("select count(*) from reply_category_decisions where category_id not in (select category_id from category_taxonomy)").fetchone()[0]==0
        reply_map={str(row[0]):row[1] for row in db.execute("select p.post_id,p.category_id from post_categories p join thread_categories t on t.thread_id=p.thread_id where p.category_id!=t.category_id order by p.post_id")}
        refined=db.execute("select count(*) from reply_category_decisions where relationship='qwen-refined'").fetchone()[0]
        category_map={str(row[0]):row[1] for row in db.execute("select thread_id,category_id from thread_categories order by thread_id")}
    with tempfile.TemporaryDirectory(prefix="fewercunts-category-release-") as name:
        directory=Path(name); map_asset=directory/"ntforum-categories-v1.json.gz"
        with map_asset.open("wb") as raw:
            with gzip.GzipFile(filename="ntforum-categories-v1.json",mode="wb",fileobj=raw,compresslevel=9,mtime=0) as target:
                target.write(canonical({"version":1,"threads":category_map,"replies":reply_map}))
        hashed_map=directory/f"ntforum-categories-v1-{sha(map_asset)[:12]}.json.gz"
        map_asset.rename(hashed_map);map_asset=hashed_map
        manifest={"format":"ntforum-categories-map","schemaVersion":1,"taxonomyVersion":1,
          "threads":threads,"replies":replies,"automaticallyCategorisedThreads":automatic,
          "uncategorisedThreads":threads-automatic,"sportsRule":"Bare sport means women; mens and mixed are explicit; womens suffix is forbidden.",
          "sourceBytes":SOURCE.stat().st_size,"sourceSha256":sha(SOURCE),"mapAsset":map_asset.name,
          "mapBytes":map_asset.stat().st_size,"mapSha256":sha(map_asset),
          "replyDecisions":reply_decisions,"replyAnalyse":reply_analyse,"replyPreserveLinks":reply_links,
          "replyIgnoredJunk":reply_ignored,"replyModelDecisions":refined,
          "replyPendingAnalysis":reply_analyse+reply_links-refined}
        manifest_path=directory/"ntforum-categories-v1.manifest.json"; manifest_path.write_bytes(canonical(manifest))
        immutable_manifest=directory/f"ntforum-categories-v1-{sha(manifest_path)[:12]}.manifest.json"
        manifest_path.rename(immutable_manifest);manifest_path=immutable_manifest
        signature=manifest_path.with_suffix('.sig')
        run("openssl","pkeyutl","-sign","-rawin","-inkey",str(PRIVATE_KEY),"-in",str(manifest_path),"-out",str(signature))
        generation=f"categories-v1-{hashlib.sha256(manifest_path.read_bytes()).hexdigest()[:12]}"
        assets=[map_asset,manifest_path,signature]
        release="v4.5.0"
        if not release_exists(release): raise RuntimeError("The verified 4.5.0 release must exist before publishing data")
        validate_release_target(release,[str(item) for item in assets])
        for item in assets:
            remote=f"https://github.com/{REPOSITORY}/releases/download/{release}/{item.name}"
            try:
                existing=download(remote,missing_ok=True)
            except HTTPError as error:
                if error.code != 404: raise
                run("gh","release","upload",release,str(item),"--repo",REPOSITORY)
            else:
                if hashlib.sha256(existing).hexdigest()!=sha(item):
                    raise RuntimeError("Refusing to overwrite immutable category asset")
        base=f"https://github.com/{REPOSITORY}/releases/download/{release}"
        for item in assets:
            data=download(f"{base}/{item.name}")
            if hashlib.sha256(data).hexdigest()!=sha(item): raise RuntimeError(f"anonymous verification failed: {item.name}")
        with tempfile.NamedTemporaryFile() as output:
            run("openssl","pkeyutl","-verify","-rawin","-pubin","-inkey",str(PUBLIC_KEY),"-in",str(manifest_path),"-sigfile",str(signature))
        pointer={"format":"ntforum-categories-pointer","schemaVersion":1,"generationTag":generation,
          "manifestUrl":f"{base}/{manifest_path.name}?sha={sha(manifest_path)}","manifestSha256":sha(manifest_path),"signatureUrl":f"{base}/{signature.name}?sha={sha(signature)}",
          "sourceSha256":manifest["sourceSha256"],
          "mapUrl":f"{base}/{map_asset.name}?sha={sha(map_asset)}","mapSha256":sha(map_asset),"publicKeySha256":sha(PUBLIC_KEY)}
        pointer_path=directory/"categories-latest.json"; pointer_path.write_bytes(canonical(pointer))
        validate_release_target(release,[str(pointer_path)])
        run("gh","release","upload",release,str(pointer_path),"--repo",REPOSITORY,"--clobber")
        if json.loads(download(f"https://github.com/{REPOSITORY}/releases/download/{release}/categories-latest.json?g={generation}"))!=pointer: raise RuntimeError("pointer verification failed")
        return {"result":"published","generationTag":generation,**manifest}

def main():
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    with UPDATE_LOCK.open("a") as update_lock, LOCK.open("a") as lock:
        fcntl.flock(update_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); print(json.dumps(publish(),sort_keys=True))
if __name__=="__main__": main()
