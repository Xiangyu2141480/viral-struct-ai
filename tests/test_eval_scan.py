"""Unit tests for the eval harness's core matcher (scripts/eval_scan.py)."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location(
        "eval_scan", ROOT / "scripts" / "eval_scan.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class MatchEventsTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_perfect_match(self):
        r = self.m.match_events([100, 200, 300], [100, 200, 300], tolerance_ms=50)
        self.assertEqual(r["matched"], 3)
        self.assertEqual(r["precision"], 1.0)
        self.assertEqual(r["recall"], 1.0)
        self.assertEqual(r["f1"], 1.0)
        self.assertEqual(r["maeMs"], 0.0)

    def test_within_tolerance_matches_with_mae(self):
        r = self.m.match_events([110, 205], [100, 200], tolerance_ms=50)
        self.assertEqual(r["matched"], 2)
        self.assertAlmostEqual(r["maeMs"], 7.5, places=1)  # (10 + 5) / 2

    def test_tolerance_is_inclusive_edge(self):
        self.assertEqual(self.m.match_events([150], [100], tolerance_ms=50)["matched"], 1)
        self.assertEqual(self.m.match_events([151], [100], tolerance_ms=50)["matched"], 0)

    def test_false_positives_and_misses(self):
        # preds: 100 (match), 500 (false pos) ; gt: 100 (match), 900 (miss)
        r = self.m.match_events([100, 500], [100, 900], tolerance_ms=50)
        self.assertEqual(r["matched"], 1)
        self.assertEqual(r["predOnly"], 1)
        self.assertEqual(r["gtOnly"], 1)
        self.assertEqual(r["precision"], 0.5)
        self.assertEqual(r["recall"], 0.5)

    def test_one_to_one_no_double_match(self):
        # two preds near a single gt -> only one is matched
        r = self.m.match_events([95, 105], [100], tolerance_ms=50)
        self.assertEqual(r["matched"], 1)
        self.assertEqual(r["predOnly"], 1)

    def test_greedy_assigns_smallest_error_first(self):
        # pred 102 should take gt 100 (err 2), leaving pred 140 for gt 150 (err 10)
        r = self.m.match_events([102, 140], [100, 150], tolerance_ms=50)
        self.assertEqual(r["matched"], 2)
        self.assertAlmostEqual(r["maeMs"], 6.0, places=1)  # (2 + 10) / 2

    def test_empty_inputs(self):
        self.assertEqual(self.m.match_events([], [], 50)["f1"], 0.0)
        self.assertEqual(self.m.match_events([100], [], 50)["gtOnly"], 0)
        self.assertEqual(self.m.match_events([], [100], 50)["gtOnly"], 1)


class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_scan_boundaries_excludes_first_start(self):
        rough = {"contentBlocks": [
            {"timeRange": {"start": 0, "end": 5}},
            {"timeRange": {"start": 5, "end": 10}},
            {"timeRange": {"start": 10, "end": 15}},
        ]}
        self.assertEqual(self.m.scan_block_boundaries_ms(rough), [5000.0, 10000.0])

    def test_beat_anchors_flattened_and_sorted(self):
        fine = {"contentBlocks": [
            {"actionBeats": [{"anchorMs": 300}, {"anchorMs": 100}]},
            {"actionBeats": [{"anchorMs": 200}]},
        ]}
        self.assertEqual(self.m.scan_beat_anchors_ms(fine), [100.0, 200.0, 300.0])

    def test_gt_beats_flattened(self):
        gt = {"blocks": {
            "block_001": {"trueActionBeats": [{"trueAbsTimeMs": 500}]},
            "block_002": {"trueActionBeats": [{"trueAbsTimeMs": 1500}, {"trueAbsTimeMs": 1200}]},
        }}
        self.assertEqual(self.m.gt_beats_ms(gt), [500.0, 1200.0, 1500.0])


class RoleAccuracyTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def _graph(self):
        return {"segments": [
            {"id": "s1", "start": 0.0, "end": 10.0, "role": "hook"},
            {"id": "s2", "start": 10.0, "end": 20.0, "role": "explanation"},
            {"id": "s3", "start": 20.0, "end": 30.0, "role": "demonstration"},
        ]}

    def test_role_at_time_picks_covering_segment(self):
        g = self._graph()
        self.assertEqual(self.m.role_at_time_s(g, 5.0), "hook")
        self.assertEqual(self.m.role_at_time_s(g, 15.0), "explanation")
        self.assertIsNone(self.m.role_at_time_s(g, 99.0))

    def test_role_accuracy_counts_matches(self):
        sections = {"sections": [
            {"start": 0.0, "end": 9.0, "label": "a", "expectedRole": "hook"},          # mid 4.5 -> hook  ok
            {"start": 10.0, "end": 19.0, "label": "b", "expectedRole": "demonstration"},# mid 14.5 -> explanation  MISS
            {"start": 20.0, "end": 29.0, "label": "c", "expectedRole": "demonstration"},# mid 24.5 -> demonstration ok
        ]}
        r = self.m.role_accuracy(self._graph(), sections)
        self.assertEqual(r["total"], 3)
        self.assertEqual(r["correct"], 2)
        self.assertAlmostEqual(r["accuracy"], 0.667, places=2)

    def test_role_accuracy_skips_sections_without_expected(self):
        sections = {"sections": [
            {"start": 0.0, "end": 9.0, "label": "a", "expectedRole": "hook"},
            {"start": 10.0, "end": 19.0, "label": "b"},  # no expectedRole -> skipped
        ]}
        r = self.m.role_accuracy(self._graph(), sections)
        self.assertEqual(r["total"], 1)


if __name__ == "__main__":
    unittest.main()
