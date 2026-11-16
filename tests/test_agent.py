import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("bakery_agent", ROOT / "agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class AgentTests(unittest.TestCase):
    def test_original_search_uses_shared_model_and_saves_evidence(self):
        results = [{"title": "鴻鼎菓子與一福堂", "url": "https://example.com/", "content": "品牌比較"}]
        replies = [{"query": "台中送禮"}, {"relevant": False, "reason": "測試"}]
        responses = [{"status": 200, "body": json.dumps({"response": json.dumps(reply)})} for reply in replies]
        with patch("tools.search_web", return_value=results) as search, patch("database.save_observation") as save:
            with patch.object(agent, "infer", side_effect=responses) as infer:
                agent.run_one_query("送禮", {"brand": "鴻鼎菓子"})
        search.assert_called_once_with("台中送禮")
        self.assertEqual(infer.call_count, 2)
        # No hard-coded model in legacy search; infer resolves the saved UI model.
        self.assertNotIn("model", infer.call_args.args[1])
        observation, evidence = save.call_args.args
        self.assertFalse(observation["relevant"])
        self.assertEqual(observation["mention_positions"], [1])
        self.assertEqual(observation["competitors"], ["一福堂"])
        self.assertEqual(evidence, [{**results[0], "position": 1, "search_query": "台中送禮"}])

    def test_target_brand_is_not_its_own_competitor(self):
        self.assertEqual(agent.extract_competitors([{"title": "一福堂"}], "一福堂"), [])


if __name__ == "__main__":
    unittest.main()
