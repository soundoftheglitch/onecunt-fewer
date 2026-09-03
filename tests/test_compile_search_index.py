import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from compile_search_index import _validated_source, compile_index, verify_release  # noqa: E402


class CompilerTest(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.db = self.temp / "source.sqlite3"
        db = sqlite3.connect(self.db)
        db.executescript("""
          CREATE TABLE threads(id INTEGER PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,author TEXT,created_utc TEXT,source_url TEXT NOT NULL);
          CREATE TABLE posts(id INTEGER PRIMARY KEY,thread_id INTEGER NOT NULL,parent_id INTEGER,title TEXT NOT NULL,message TEXT NOT NULL,author TEXT NOT NULL,created_utc TEXT NOT NULL,source_url TEXT NOT NULL);
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          INSERT INTO metadata VALUES('last_complete_sync','2026-08-28T00:00:00Z'),('reported_thread_count','1');
          INSERT INTO threads VALUES(1,'Café title','The body','Alice','2026-08-01Z','/thread/1');
          INSERT INTO posts VALUES(1,1,NULL,'Re','The good reply','Bob','2026-08-02Z','/thread/1/reply/1');
        """)
        db.commit(); db.close()
        self.private = self.temp / "private.pem"; self.public = self.temp / "public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", self.private], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["openssl", "pkey", "-in", self.private, "-pubout", "-out", self.public], check=True, stdout=subprocess.DEVNULL)

    def tearDown(self): shutil.rmtree(self.temp)

    def test_two_builds_identical_and_publisher_verifies(self):
        documents, _metadata = _validated_source(self.db)
        self.assertEqual(documents[0]["replyCount"], 1)
        self.assertNotIn("replyCount", documents[1])
        one, two = self.temp / "one", self.temp / "two"
        first = compile_index(self.db, one, self.private, 1024)
        second = compile_index(self.db, two, self.private, 1024)
        self.assertEqual(first, second)
        names = ["ntforum-search-v1.manifest.json", "ntforum-search-v1.manifest.sig",
                 *[x["name"] for x in first["chunks"]]]
        self.assertTrue(all((one / name).read_bytes() == (two / name).read_bytes() for name in names))
        verified = verify_release(one, self.public)
        self.assertEqual(verified["sourceDocumentCount"], 2)
        self.assertEqual(verified["watermark"], "2026-08-28T00:00:00Z")

    def test_malformed_source_and_corrupt_chunk_fail_closed(self):
        db = sqlite3.connect(self.db); db.execute("UPDATE metadata SET value='2' WHERE key='reported_thread_count'"); db.commit(); db.close()
        with self.assertRaisesRegex(ValueError, "thread count mismatch"):
            compile_index(self.db, self.temp / "bad", self.private, 1024)
        db = sqlite3.connect(self.db); db.execute("UPDATE metadata SET value='1' WHERE key='reported_thread_count'"); db.commit(); db.close()
        out = self.temp / "good"; manifest = compile_index(self.db, out, self.private, 1024)
        chunk = out / manifest["chunks"][0]["name"]
        chunk.write_bytes(chunk.read_bytes()[:-1] + b"x")
        with self.assertRaisesRegex(ValueError, "chunk verification failed"):
            verify_release(out, self.public)


if __name__ == "__main__": unittest.main()
