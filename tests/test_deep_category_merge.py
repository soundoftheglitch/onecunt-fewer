from unittest.mock import patch
import json
import sqlite3
from tests.test_reply_category_decisions import ReplyDecisionIntegrationTests
from scripts import update_categories

class DeepMergeTests(ReplyDecisionIntegrationTests):
    def test_deep_merge_keeps_reply_decisions_and_manual_category(self):
        update_categories.update(self.archive, self.category, self.outbox, 'unused', 'qwen3:4b')
        decisions = {1: (update_categories.digest_text('Politics thread', 'Opening'), 'uncategorised', .2, 'uncategorised', 'insufficient evidence')}
        with patch.object(update_categories, 'ai_category', side_effect=AssertionError('unexpected inference')):
            update_categories.update(self.archive, self.category, self.outbox, 'unused', 'qwen3:4b', deep_decisions=decisions, classify_missing=False)
        with sqlite3.connect(self.category) as db:
            self.assertEqual(db.execute('select count(*) from posts').fetchone(), db.execute('select count(*) from reply_category_decisions').fetchone())
            self.assertEqual(db.execute('select category_id from thread_categories').fetchone()[0], 'uncategorised')
        self.outbox.write_text(json.dumps({'assignments':[{'threadId':1,'categoryId':'politics'}]}))
        update_categories.update(self.archive, self.category, self.outbox, 'unused', 'qwen3:4b', deep_decisions=decisions, classify_missing=False)
        with sqlite3.connect(self.category) as db:
            self.assertEqual(db.execute('select category_id,source from thread_categories').fetchone(), ('politics','manual'))

    def test_failed_deep_result_cannot_replace_known_category(self):
        failed = {1: (update_categories.digest_text('Politics thread','Opening'), 'uncategorised', 0, 'uncategorised','deep-local-ai-fallback:TimeoutError')}
        update_categories.update(self.archive,self.category,self.outbox,'unused','qwen3:4b',deep_decisions=failed,classify_missing=False)
        with sqlite3.connect(self.category) as db:
            self.assertEqual(db.execute('select category_id from thread_categories').fetchone()[0], 'politics')

class DeepRetryTests(__import__('unittest').TestCase):
    def test_failure_retries_after_backoff_and_uncertain_gets_context_pass(self):
        import sys
        sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'scripts'))
        from deep_category_campaign import retry_due
        failed=('body','uncategorised','deep-local-ai-fallback:TimeoutError')
        self.assertTrue(retry_due(failed,None,'body','context',10))
        self.assertFalse(retry_due(failed,('context',1,20,'retry'),'body','context',10))
        self.assertTrue(retry_due(failed,('context',1,20,'retry'),'body','context',21))
        uncertain=('body','uncategorised','not enough context')
        self.assertTrue(retry_due(uncertain,None,'body','context',10))
        self.assertFalse(retry_due(uncertain,('context',1,0,'complete'),'body','context',10))
        self.assertTrue(retry_due(uncertain,('context',1,0,'complete'),'body','new-context',10))

class PublicationCoverageTests(ReplyDecisionIntegrationTests):
    def test_publication_rejects_missing_reply_decisions_before_upload(self):
        import sys
        sys.path.insert(0,str(__import__('pathlib').Path(__file__).resolve().parents[1]/'scripts'))
        import publish_category_database as publisher
        with sqlite3.connect(self.category) as db:db.execute('drop table reply_category_decisions')
        with patch.object(publisher,'preflight'),patch.object(publisher,'SOURCE',self.category):
            with self.assertRaisesRegex(RuntimeError,'reply decisions are missing'):publisher.publish()

class CampaignCliTests(__import__('unittest').TestCase):
    def test_real_entrypoint_exposes_bounded_and_merge_only_modes(self):
        import subprocess,sys
        from pathlib import Path
        script=Path(__file__).resolve().parents[1]/'scripts/deep_category_campaign.py'
        result=subprocess.run([sys.executable,str(script),'--help'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('--merge-only',result.stdout)
        self.assertIn('--limit',result.stdout)

class CategoryDownloadTests(__import__('unittest').TestCase):
    def test_verification_retries_negative_cache_with_fresh_urls(self):
        import sys
        from pathlib import Path
        from urllib.error import HTTPError
        from unittest.mock import MagicMock
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
        import publish_category_database as publisher
        response=MagicMock();response.__enter__.return_value.read.return_value=b'verified'
        error=HTTPError('https://example.test/asset',404,'not yet available',{},None)
        with patch.object(publisher,'urlopen',side_effect=[error,response]) as opened,patch.object(publisher.time,'sleep'):
            self.assertEqual(publisher.download('https://example.test/asset'),b'verified')
            self.assertNotEqual(opened.call_args_list[0].args[0].full_url,opened.call_args_list[1].args[0].full_url)
