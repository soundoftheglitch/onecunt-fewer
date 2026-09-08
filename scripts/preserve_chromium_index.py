#!/usr/bin/env python3
"""Boot-only profile cleanup preserving approved fewerCunts origins, never site data."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

LEGACY_ID = 'hmkomfiebnmjoplmnghdjfjienpghlmk'

def path_id(path):
    return ''.join(chr(ord('a') + int(c,16)) for c in hashlib.sha256(str(path).encode()).hexdigest()[:32])

def approved_ids(extension_root):
    result = {LEGACY_ID}
    for path in [extension_root / 'current', *extension_root.glob('*')]:
        manifest = path / 'manifest.json'
        if manifest.is_file() and json.loads(manifest.read_text()).get('name','').lower() == 'fewercunts':
            result.update((path_id(path), path_id(path.resolve())))
    return result

def safe_tree(path):
    if path.is_symlink():
        raise RuntimeError('Refusing symlink in preserved storage')
    if path.exists():
        for root, dirs, files in os.walk(path, followlinks=False):
            if any((Path(root)/name).is_symlink() for name in dirs+files):
                raise RuntimeError('Refusing symlink in preserved storage')

def cleanup(profile, store, ids):
    profile, store = Path(profile), Path(store)
    if profile.is_symlink() or store.is_symlink():
        raise RuntimeError('Refusing symlink profile or recovery store')
    mounted = subprocess.check_output(['findmnt','-rn','-o','TARGET'],text=True).splitlines()
    if any(m.startswith(str(profile)+'/') or m.startswith(str(store)+'/') for m in mounted):
        raise RuntimeError('Refusing nested mount in cleanup or recovery storage')
    if not profile.exists() and not store.exists():
        return {'preserved':0}
    owner = profile.stat() if profile.exists() else store.stat()
    paths=set()
    for identity in ids:
        if not re.fullmatch('[a-p]{32}',identity): raise ValueError('Invalid extension ID')
        for relative in [f'Default/IndexedDB/chrome-extension_{identity}_0.indexeddb.leveldb',
                         f'Default/IndexedDB/chrome-extension_{identity}_0.indexeddb.blob',
                         f'Default/Local Extension Settings/{identity}']:
            if (profile/relative).exists(): paths.add(relative)
    caches=profile/'Default/Service Worker/CacheStorage'
    for origin in caches.glob('*'):
        index=origin/'index.txt'
        if not re.fullmatch('[a-f0-9]{40}',origin.name) or not index.is_file(): continue
        data=index.read_bytes()
        origins=set(x.decode() for x in re.findall(rb'chrome-extension://([a-p]{32})/',data))
        if len(origins)==1 and origins <= ids and b'fewercunts-persisted-compact-index-v1' in data:
            paths.add(str(origin.relative_to(profile)))
    store.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chown(store,owner.st_uid,owner.st_gid)
    record=store/'recovery.json'
    if record.exists():
        paths.update(json.loads(record.read_text())['paths'])
    for relative in paths:
        if Path(relative).is_absolute() or '..' in Path(relative).parts or not relative.startswith('Default/'):
            raise RuntimeError('Invalid recovery path')
        src,dst=profile/relative,store/relative
        safe_tree(src);safe_tree(dst)
        if src.exists() and dst.exists(): raise RuntimeError('Both live and preserved storage exist; manual recovery required')
    # Record before moving: an interrupted cleanup is resumed without overwriting either copy.
    temporary=store/'recovery.next'
    temporary.write_text(json.dumps({'paths':sorted(paths)}));os.chmod(temporary,0o600);os.replace(temporary,record)
    for relative in sorted(paths):
        src,dst=profile/relative,store/relative
        if src.exists():
            dst.parent.mkdir(parents=True,exist_ok=True);shutil.move(src,dst)
    profile.mkdir(parents=True,exist_ok=True)
    for item in profile.iterdir():
        if item.is_dir() and not item.is_symlink(): shutil.rmtree(item)
        else: item.unlink()
    for relative in sorted(paths):
        src,dst=store/relative,profile/relative
        if src.exists():
            dst.parent.mkdir(parents=True,exist_ok=True)
            parent=dst.parent
            while parent != profile.parent:
                os.chown(parent,owner.st_uid,owner.st_gid);parent=parent.parent
            shutil.move(src,dst)
    record.unlink()
    return {'preserved':len(paths)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--profile',type=Path,required=True);p.add_argument('--store',type=Path,required=True)
    p.add_argument('--extension-root',type=Path,default=Path('/home/x0ar/.local/share/fewercunts-extension'))
    a=p.parse_args();print(json.dumps(cleanup(a.profile,a.store,approved_ids(a.extension_root))))
