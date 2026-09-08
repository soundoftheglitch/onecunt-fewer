import json
from pathlib import Path
import tempfile
import unittest
from scripts.preserve_chromium_index import cleanup, LEGACY_ID

class CleanupTests(unittest.TestCase):
    def test_cleanup_and_interrupted_recovery_preserve_only_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);profile=root/'profile';store=root/'store'
            origin=f'Default/Service Worker/CacheStorage/{"a"*40}'
            cache=profile/origin;cache.mkdir(parents=True)
            (cache/'index.txt').write_bytes(f'fewercunts-persisted-compact-index-v1 chrome-extension://{LEGACY_ID}/'.encode())
            (cache/'chunk').write_bytes(b'public search database')
            unrelated=profile/'Default/Service Worker/CacheStorage'/('b'*40);unrelated.mkdir()
            (unrelated/'index.txt').write_text('https://unrelated.example/')
            (profile/'History').write_text('private browsing')
            cleanup(profile,store,{LEGACY_ID})
            self.assertEqual((cache/'chunk').read_bytes(),b'public search database')
            self.assertFalse(unrelated.exists());self.assertFalse((profile/'History').exists())
            # Simulate an interruption after moving data, before erasing the profile.
            saved=store/origin;saved.parent.mkdir(parents=True,exist_ok=True);cache.rename(saved)
            (store/'recovery.json').write_text(json.dumps({'paths':[origin]}))
            cleanup(profile,store,{LEGACY_ID})
            self.assertTrue((cache/'chunk').exists());self.assertFalse((store/'recovery.json').exists())

    def test_symlink_fails_before_history_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);profile=root/'profile';store=root/'store';profile.mkdir()
            (profile/'History').write_text('keep on failure')
            origin=profile/f'Default/IndexedDB/chrome-extension_{LEGACY_ID}_0.indexeddb.leveldb'
            origin.parent.mkdir(parents=True);origin.symlink_to(root,target_is_directory=True)
            with self.assertRaises(RuntimeError):cleanup(profile,store,{LEGACY_ID})
            self.assertTrue((profile/'History').exists())
