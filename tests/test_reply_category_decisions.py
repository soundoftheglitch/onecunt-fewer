import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts import update_categories


class ReplyPrefilterTests(unittest.TestCase):
    def test_single_word_is_ignored_only_when_isolated(self):
        isolated = update_categories.classify_reply_prefilter("lol", direct_child_count=0, descendant_count=0)
        self.assertEqual(isolated["decision"], "ignore_junk")
        self.assertEqual(isolated["skip_reason"], "single_word_non_url")

        anchored = update_categories.classify_reply_prefilter("lol", direct_child_count=2, descendant_count=2)
        self.assertEqual(anchored["decision"], "analyse")
        self.assertEqual(anchored["relationship"], "engagement_anchor")

        descendant_anchor = update_categories.classify_reply_prefilter("roff", direct_child_count=1, descendant_count=3)
        self.assertEqual(descendant_anchor["decision"], "analyse")
        self.assertEqual(descendant_anchor["relationship"], "engagement_anchor")

    def test_url_only_and_short_topical_replies_are_preserved_for_analysis(self):
        link = update_categories.classify_reply_prefilter("https://youtu.be/cxvzl9k-FXE")
        self.assertEqual(link["decision"], "preserve_link")
        self.assertIsNone(link["skip_reason"])

        topical = update_categories.classify_reply_prefilter("Tory budget")
        self.assertEqual(topical["decision"], "analyse")

    def test_quote_symbol_ack_and_non_latin_handling(self):
        self.assertEqual(update_categories.classify_reply_prefilter("[quote]hello[/quote]")["skip_reason"], "quote_only")
        self.assertEqual(update_categories.classify_reply_prefilter("🤣🤣😂😂")["skip_reason"], "symbol_only")
        self.assertEqual(update_categories.classify_reply_prefilter("Yes yes")["skip_reason"], "short_ack")
        self.assertEqual(update_categories.classify_reply_prefilter("私のお尻の穴が臭い")["decision"], "analyse")


class ReplyDecisionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = Path(tempfile.mkdtemp())
        self.archive = self.tempdir / "archive.sqlite3"
        self.category = self.tempdir / "category.sqlite3"
        self.outbox = self.tempdir / "outbox.json"
        self._create_archive(self.archive, extra_reply=False)
        shutil.copy2(self.archive, self.category)
        con = sqlite3.connect(self.category)
        update_categories.schema(con)
        con.executemany("INSERT INTO category_taxonomy VALUES(?,?,?,?,?)", [
            ("uncategorised", None, "Uncategorised", 0, 1),
            ("politics", None, "Politics", 1, 1),
        ])
        con.execute("INSERT INTO thread_categories VALUES(?,?,?,?,?,1)", (1, "politics", 0.9, "automatic", json.dumps(["seed"])))
        con.execute("INSERT INTO category_thread_state VALUES(?,?,?,?)", (1, update_categories.digest_text("Politics thread", "Opening"), "seed", "2026-01-01T00:00:00+00:00"))
        con.execute("INSERT INTO post_categories SELECT p.id,p.thread_id,'politics',0.9,'thread-inherited',1 FROM posts p")
        con.commit(); con.close()

    def tearDown(self):
        shutil.rmtree(self.tempdir)

    def _create_archive(self, path, extra_reply, anchor_children=2):
        if path.exists():
            path.unlink()
        con = sqlite3.connect(path)
        con.executescript("""
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE threads(id INTEGER PRIMARY KEY,title TEXT,message TEXT,author TEXT,created_utc TEXT,url TEXT);
          CREATE TABLE posts(id INTEGER PRIMARY KEY,thread_id INTEGER,parent_id INTEGER,title TEXT,message TEXT,author TEXT,created_utc TEXT,url TEXT);
          CREATE TABLE search(doc_key TEXT PRIMARY KEY,thread_id INTEGER,post_id INTEGER,kind TEXT,title TEXT,body TEXT,author TEXT,created_utc TEXT,url TEXT);
        """)
        con.execute("INSERT INTO metadata VALUES('last_complete_sync','2026-01-01T00:00:00+00:00')")
        con.execute("INSERT INTO threads VALUES(1,'Politics thread','Opening','Alice','2026-01-01T00:00:00+00:00','/t/1')")
        posts = [
            (10, 1, None, 'Re', 'lol', 'Bob', '2026-01-01T01:00:00+00:00', '/p/10'),
            (11, 1, 10, 'Re', 'Starmer lied again', 'Carol', '2026-01-01T01:01:00+00:00', '/p/11'),
            (13, 1, None, 'Re', 'https://example.com/story', 'Eve', '2026-01-01T01:03:00+00:00', '/p/13'),
        ]
        if anchor_children >= 2:
            posts.append((12, 1, 10, 'Re', 'Tory budget', 'Dan', '2026-01-01T01:02:00+00:00', '/p/12'))
        if extra_reply:
            posts.append((14, 1, None, 'Re', 'Yes yes', 'Frank', '2026-01-01T01:04:00+00:00', '/p/14'))
        con.executemany("INSERT INTO posts VALUES(?,?,?,?,?,?,?,?)", posts)
        con.commit(); con.close()

    def test_update_creates_auditable_reply_decision_rows_for_all_posts(self):
        result = update_categories.update(self.archive, self.category, self.outbox, "unused", "qwen3:4b")
        self.assertEqual(result["replyDecisionRows"], 4)
        self.assertEqual(result["replyAnalyse"], 3)
        self.assertEqual(result["replyPreserveLink"], 1)
        con = sqlite3.connect(self.category)
        decisions = dict(con.execute("SELECT post_id,decision FROM reply_category_decisions"))
        relationships = dict(con.execute("SELECT post_id,relationship FROM reply_category_decisions"))
        self.assertEqual(decisions[10], "analyse")
        self.assertEqual(relationships[10], "engagement_anchor")
        self.assertEqual(decisions[13], "preserve_link")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM post_categories").fetchone()[0], 4)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM reply_category_decisions WHERE category_id NOT IN (SELECT category_id FROM category_taxonomy)").fetchone()[0], 0)
        con.close()

    def test_incremental_update_adds_decision_for_new_reply_without_reprocessing_all(self):
        update_categories.update(self.archive, self.category, self.outbox, "unused", "qwen3:4b")
        self._create_archive(self.archive, extra_reply=True)
        result = update_categories.update(self.archive, self.category, self.outbox, "unused", "qwen3:4b")
        self.assertEqual(result["replyDecisionRows"], 5)
        self.assertEqual(result["replyNewOrChanged"], 1)
        con = sqlite3.connect(self.category)
        self.assertEqual(con.execute("SELECT skip_reason FROM reply_category_decisions WHERE post_id=14").fetchone()[0], "short_ack")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM post_categories").fetchone()[0], 5)
        con.close()

    def test_reply_context_hash_reprocesses_when_same_single_word_gets_engaged(self):
        self._create_archive(self.archive, extra_reply=False, anchor_children=1)
        update_categories.update(self.archive, self.category, self.outbox, "unused", "qwen3:4b")
        con = sqlite3.connect(self.category)
        before = con.execute("SELECT decision,skip_reason,context_sha256 FROM reply_category_decisions WHERE post_id=10").fetchone()
        con.close()
        self.assertEqual(before[0], "ignore_junk")
        self.assertEqual(before[1], "single_word_non_url")

        self._create_archive(self.archive, extra_reply=False, anchor_children=2)
        result = update_categories.update(self.archive, self.category, self.outbox, "unused", "qwen3:4b")
        self.assertEqual(result["replyNewOrChanged"], 2)
        con = sqlite3.connect(self.category)
        after = con.execute("SELECT decision,skip_reason,relationship,context_sha256 FROM reply_category_decisions WHERE post_id=10").fetchone()
        con.close()
        self.assertEqual(after[0], "analyse")
        self.assertIsNone(after[1])
        self.assertEqual(after[2], "engagement_anchor")
        self.assertNotEqual(before[2], after[3])


if __name__ == "__main__":
    unittest.main()
