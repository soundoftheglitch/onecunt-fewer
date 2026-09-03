#!/usr/bin/env python3
"""Publish the signed category map on the sole 4.5.0 release."""
from __future__ import annotations
import fcntl, gzip, hashlib, json, shutil, sqlite3, subprocess, tempfile
from pathlib import Path
from urllib.request import Request, urlopen
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
def download(url):
    with urlopen(Request(url,headers={"User-Agent":"fewerCunts-categories-publisher/1","Cache-Control":"no-cache"}),timeout=180) as response: return response.read()
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
        category_map={str(row[0]):row[1] for row in db.execute("select thread_id,category_id from thread_categories order by thread_id")}
    with tempfile.TemporaryDirectory(prefix="fewercunts-category-release-") as name:
        directory=Path(name); map_asset=directory/"ntforum-categories-v1.json.gz"
        with map_asset.open("wb") as raw:
            with gzip.GzipFile(filename="ntforum-categories-v1.json",mode="wb",fileobj=raw,compresslevel=9,mtime=0) as target:
                target.write(canonical({"version":1,"threads":category_map}))
        manifest={"format":"ntforum-categories-map","schemaVersion":1,"taxonomyVersion":1,
          "threads":threads,"replies":replies,"automaticallyCategorisedThreads":automatic,
          "uncategorisedThreads":threads-automatic,"sportsRule":"Bare sport means women; mens and mixed are explicit; womens suffix is forbidden.",
          "sourceBytes":SOURCE.stat().st_size,"sourceSha256":sha(SOURCE),"mapAsset":map_asset.name,
          "mapBytes":map_asset.stat().st_size,"mapSha256":sha(map_asset)}
        manifest_path=directory/"ntforum-categories-v1.manifest.json"; manifest_path.write_bytes(canonical(manifest))
        signature=directory/"ntforum-categories-v1.manifest.sig"
        run("openssl","pkeyutl","-sign","-rawin","-inkey",str(PRIVATE_KEY),"-in",str(manifest_path),"-out",str(signature))
        generation=f"categories-v1-{hashlib.sha256(manifest_path.read_bytes()).hexdigest()[:12]}"
        assets=[map_asset,manifest_path,signature]
        release="v4.5.0"
        if not release_exists(release): raise RuntimeError("The verified 4.5.0 release must exist before publishing data")
        validate_release_target(release,[str(item) for item in assets])
        run("gh","release","upload",release,*map(str,assets),"--repo",REPOSITORY,"--clobber")
        base=f"https://github.com/{REPOSITORY}/releases/download/{release}"
        for item in assets:
            data=download(f"{base}/{item.name}")
            if hashlib.sha256(data).hexdigest()!=sha(item): raise RuntimeError(f"anonymous verification failed: {item.name}")
        with tempfile.NamedTemporaryFile() as output:
            run("openssl","pkeyutl","-verify","-rawin","-pubin","-inkey",str(PUBLIC_KEY),"-in",str(manifest_path),"-sigfile",str(signature))
        pointer={"format":"ntforum-categories-pointer","schemaVersion":1,"generationTag":generation,
          "manifestUrl":f"{base}/{manifest_path.name}","manifestSha256":sha(manifest_path),"signatureUrl":f"{base}/{signature.name}",
          "sourceSha256":manifest["sourceSha256"],
          "mapUrl":f"{base}/{map_asset.name}","mapSha256":sha(map_asset),"publicKeySha256":sha(PUBLIC_KEY)}
        pointer_path=directory/"categories-latest.json"; pointer_path.write_bytes(canonical(pointer))
        validate_release_target(release,[str(pointer_path)])
        run("gh","release","upload",release,str(pointer_path),"--repo",REPOSITORY,"--clobber")
        if json.loads(download(f"https://github.com/{REPOSITORY}/releases/download/{release}/categories-latest.json?g={generation}"))!=pointer: raise RuntimeError("pointer verification failed")
        return {"result":"published","generationTag":generation,**manifest}

def main():
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    with LOCK.open("w") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); print(json.dumps(publish(),sort_keys=True))
if __name__=="__main__": main()
