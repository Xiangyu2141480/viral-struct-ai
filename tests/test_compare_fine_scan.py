import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "compare_fine_scan.py"


def load_module():
    spec = importlib.util.spec_from_file_location("compare_fine_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LoadGroundTruthTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_loads_ground_truth_blocks_into_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            gt_path = Path(tmp) / "gt.json"
            gt_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "blocks": {
                            "block_001": {
                                "blockStartMs": 0,
                                "blockEndMs": 9500,
                                "trueActionBeats": [
                                    {
                                        "beatId": "true_001_001",
                                        "trueAbsTimeMs": 3200,
                                        "semanticAction": "color shift",
                                        "actionType": "color_shift",
                                        "confidence": 0.9,
                                    },
                                    {
                                        "beatId": "true_001_002",
                                        "trueAbsTimeMs": 5700,
                                        "semanticAction": "lid opens",
                                        "actionType": "reveal",
                                        "confidence": 0.85,
                                    },
                                ],
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            loaded = self.module.load_ground_truth(gt_path)

        self.assertEqual(loaded["videoId"], "demo")
        self.assertIn("block_001", loaded["blocks"])
        self.assertEqual(len(loaded["blocks"]["block_001"]["trueActionBeats"]), 2)


class LoadV02ActionBeatsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_extracts_action_beats_with_absolute_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            block_dir = Path(tmp)
            (block_dir / "block_001_fine_scan.json").write_text(
                json.dumps(
                    {
                        "blockId": "block_001",
                        "sourceTimeRangeMs": {"start": 0, "end": 9500},
                        "shotStructure": {
                            "shots": [
                                {
                                    "shotId": "shot_001",
                                    "actionBeats": [
                                        {"beatId": "beat_001", "tMs": 3600, "beatType": "state_change"},
                                        {"beatId": "beat_002", "tMs": 5740, "beatType": "reveal"},
                                    ],
                                }
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )

            loaded = self.module.load_v02_actionbeats(block_dir)

        self.assertIn("block_001", loaded)
        beats = loaded["block_001"]
        self.assertEqual(len(beats), 2)
        self.assertEqual(beats[0]["absMs"], 3600)
        self.assertEqual(beats[1]["absMs"], 5740)
        self.assertEqual(beats[0]["beatId"], "beat_001")

    def test_extracts_absolute_time_with_nonzero_block_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            block_dir = Path(tmp)
            (block_dir / "block_003_fine_scan.json").write_text(
                json.dumps(
                    {
                        "blockId": "block_003",
                        "sourceTimeRangeMs": {"start": 26500, "end": 45000},
                        "shotStructure": {
                            "shots": [
                                {
                                    "actionBeats": [
                                        {"beatId": "beat_001", "tMs": 1000, "beatType": "entry"},
                                    ],
                                }
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )

            loaded = self.module.load_v02_actionbeats(block_dir)

        self.assertEqual(loaded["block_003"][0]["absMs"], 27500)

    def test_skips_non_block_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            block_dir = Path(tmp)
            (block_dir / "fine_structure_scan.json").write_text("{}", encoding="utf-8")  # combined
            (block_dir / "block_001_fine_scan.json").write_text(
                json.dumps(
                    {
                        "blockId": "block_001",
                        "sourceTimeRangeMs": {"start": 0, "end": 1000},
                        "shotStructure": {"shots": [{"actionBeats": [{"beatId": "b", "tMs": 500, "beatType": "reveal"}]}]},
                    }
                ),
                encoding="utf-8",
            )

            loaded = self.module.load_v02_actionbeats(block_dir)

        self.assertEqual(list(loaded.keys()), ["block_001"])


class FindNearestBeatTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_returns_closest_candidate_by_abs_time(self):
        candidates = [
            {"beatId": "b1", "absMs": 1000},
            {"beatId": "b2", "absMs": 5000},
            {"beatId": "b3", "absMs": 9000},
        ]

        nearest = self.module.find_nearest_beat(target_abs_ms=5200, candidates=candidates)
        self.assertEqual(nearest["beatId"], "b2")

    def test_returns_none_for_empty_candidate_list(self):
        self.assertIsNone(self.module.find_nearest_beat(target_abs_ms=1000, candidates=[]))


class ComputePerBlockErrorsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_pairs_each_truth_with_nearest_candidate_and_computes_signed_delta(self):
        truth_beats = [
            {"beatId": "t1", "trueAbsTimeMs": 3200, "semanticAction": "color shift"},
            {"beatId": "t2", "trueAbsTimeMs": 5700, "semanticAction": "lid opens"},
        ]
        candidates = [
            {"beatId": "v1", "absMs": 3600},
            {"beatId": "v2", "absMs": 5740},
        ]

        rows = self.module.compute_per_block_errors(truth_beats, candidates)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["truthBeatId"], "t1")
        self.assertEqual(rows[0]["nearestBeatId"], "v1")
        self.assertEqual(rows[0]["nearestAbsMs"], 3600)
        self.assertEqual(rows[0]["deltaMs"], 400)  # candidate is later
        self.assertEqual(rows[0]["absErrorMs"], 400)
        self.assertEqual(rows[1]["deltaMs"], 40)

    def test_truth_with_no_candidates_returns_none_match(self):
        truth_beats = [{"beatId": "t1", "trueAbsTimeMs": 3200, "semanticAction": "x"}]
        rows = self.module.compute_per_block_errors(truth_beats, [])

        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["nearestBeatId"])
        self.assertIsNone(rows[0]["deltaMs"])
        self.assertIsNone(rows[0]["absErrorMs"])


class ComputeBlockStatsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_mean_median_max_within_tolerance_count(self):
        rows = [
            {"absErrorMs": 100, "deltaMs": 100},
            {"absErrorMs": 200, "deltaMs": -200},
            {"absErrorMs": 1500, "deltaMs": 1500},
            {"absErrorMs": None, "deltaMs": None},  # unmatched
        ]

        stats = self.module.compute_block_stats(rows, tolerance_ms=250)

        self.assertEqual(stats["totalTruthBeats"], 4)
        self.assertEqual(stats["matchedTruthBeats"], 3)
        self.assertEqual(stats["meanAbsErrorMs"], 600)  # (100+200+1500)/3 = 600
        self.assertEqual(stats["medianAbsErrorMs"], 200)
        self.assertEqual(stats["maxAbsErrorMs"], 1500)
        self.assertEqual(stats["withinToleranceCount"], 2)
        self.assertAlmostEqual(stats["withinToleranceFraction"], 2 / 3, places=3)


if __name__ == "__main__":
    unittest.main()
