from unittest.mock import patch
from pathlib import Path
import sqlite3
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import refine_reply_categories as refiner
from scripts import update_categories
from tests.test_reply_category_decisions import ReplyDecisionIntegrationTests

class RefinementTests(ReplyDecisionIntegrationTests):
    def test_actual_model_decision_is_resumable_and_merged(self):
        update_categories.update(self.archive,self.category,self.outbox,'unused','qwen3:4b')
        state=self.tempdir/'refinements.sqlite3'
        def model(rows,*args):
            return [(rows[0]['threadId'],'politics',.9,'uncategorised','reply is about politics')]
        with patch.object(refiner,'classify_resilient',side_effect=model) as call:
            first=refiner.run(self.category,state,'unused','qwen3:4b',1,5)
            self.assertEqual(first['completedModelDecisions'],1)
            first_id=call.call_args.args[0][0]['threadId']
            refiner.run(self.category,state,'unused','qwen3:4b',1,5)
            self.assertNotEqual(call.call_args.args[0][0]['threadId'],first_id)
        update_categories.update(self.archive,self.category,self.outbox,'unused','qwen3:4b',refinements_path=state)
        with sqlite3.connect(self.category) as db:
            self.assertEqual(db.execute("select count(*) from reply_category_decisions where relationship='qwen-refined'").fetchone()[0],2)
            self.assertEqual(db.execute("select source from post_categories where post_id=?",(first_id,)).fetchone()[0],'reply-refined')

    def test_failed_reply_call_stays_retryable_without_false_completion(self):
        update_categories.update(self.archive,self.category,self.outbox,'unused','qwen3:4b')
        state=self.tempdir/'refinements.sqlite3'
        def failed(rows,*args):return [(rows[0]['threadId'],'uncategorised',0,'uncategorised','deep-local-ai-fallback:TimeoutError')]
        with patch.object(refiner,'classify_resilient',side_effect=failed):
            result=refiner.run(self.category,state,'unused','qwen3:4b',1,5)
        self.assertEqual(result['completedModelDecisions'],0);self.assertEqual(result['failedThisRun'],1)
        with sqlite3.connect(state) as db:self.assertEqual(db.execute('select status from refinements').fetchone()[0],'retry')
