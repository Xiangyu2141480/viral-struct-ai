"""Tests for scripts/augment_audio_beat_map.py."""

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "augment_audio_beat_map.py"


def load_module():
    spec = importlib.util.spec_from_file_location("augment_audio_beat_map", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FirstDownbeatTimeTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_returns_first_downbeat_time(self):
        beats = [
            {"time": 0.5, "isDownbeat": False},
            {"time": 1.0, "isDownbeat": True},
            {"time": 2.0, "isDownbeat": True},
        ]
        self.assertEqual(self.module.first_downbeat_time(beats), 1.0)

    def test_returns_none_when_no_downbeats(self):
        beats = [
            {"time": 0.5, "isDownbeat": False},
            {"time": 1.0, "isDownbeat": False},
        ]
        self.assertIsNone(self.module.first_downbeat_time(beats))

    def test_returns_none_for_empty_list(self):
        self.assertIsNone(self.module.first_downbeat_time([]))

    def test_ignores_malformed_beats(self):
        beats = ["not a dict", {"isDownbeat": True}, {"time": 5.0, "isDownbeat": True}]
        # First valid downbeat with time is 5.0
        self.assertEqual(self.module.first_downbeat_time(beats), 5.0)


class TempoStabilityTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_metronomic_beats_return_near_one(self):
        # 4 downbeats evenly spaced 1s apart → CV ≈ 0 → stability ≈ 1.0
        beats = [
            {"time": 1.0, "isDownbeat": True},
            {"time": 2.0, "isDownbeat": True},
            {"time": 3.0, "isDownbeat": True},
            {"time": 4.0, "isDownbeat": True},
        ]
        stability = self.module.tempo_stability(beats)
        self.assertAlmostEqual(stability, 1.0, places=3)

    def test_highly_irregular_beats_return_lower_score(self):
        # 4 downbeats at 1.0, 1.5, 4.0, 4.2 — highly irregular spacing
        beats = [
            {"time": 1.0, "isDownbeat": True},
            {"time": 1.5, "isDownbeat": True},
            {"time": 4.0, "isDownbeat": True},
            {"time": 4.2, "isDownbeat": True},
        ]
        stability = self.module.tempo_stability(beats)
        self.assertLess(stability, 0.7)
        self.assertGreater(stability, 0.0)

    def test_insufficient_downbeats_returns_zero(self):
        # Fewer than 3 downbeats → not enough intervals
        beats = [
            {"time": 1.0, "isDownbeat": True},
            {"time": 2.0, "isDownbeat": True},
        ]
        self.assertEqual(self.module.tempo_stability(beats), 0.0)

    def test_no_downbeats_returns_zero(self):
        beats = [{"time": 1.0, "isDownbeat": False}]
        self.assertEqual(self.module.tempo_stability(beats), 0.0)


class AugmentBeatMapTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def _v1_payload(self) -> dict:
        return {
            "videoId": "macbook_neo",
            "audioSource": "audio_beat_map.wav",
            "method": {"primary": "beat_this"},
            "tempo": {"bpm": 83.33, "confidence": None},
            "beats": [
                {"time": 1.0, "beatNumber": 1, "isDownbeat": True},
                {"time": 2.0, "beatNumber": 1, "isDownbeat": True},
                {"time": 3.0, "beatNumber": 1, "isDownbeat": True},
                {"time": 4.0, "beatNumber": 1, "isDownbeat": True},
            ],
        }

    def test_adds_schema_version(self):
        result = self.module.augment_beat_map(self._v1_payload())
        self.assertEqual(result["schemaVersion"], "audio_beat_map_v2")

    def test_preserves_all_v1_fields(self):
        result = self.module.augment_beat_map(self._v1_payload())
        self.assertEqual(result["videoId"], "macbook_neo")
        self.assertEqual(result["audioSource"], "audio_beat_map.wav")
        self.assertEqual(result["method"], {"primary": "beat_this"})
        self.assertEqual(result["tempo"]["bpm"], 83.33)
        self.assertEqual(len(result["beats"]), 4)

    def test_adds_first_downbeat_at(self):
        result = self.module.augment_beat_map(self._v1_payload())
        self.assertEqual(result["firstDownbeatAt"], 1.0)

    def test_adds_tempo_stability(self):
        result = self.module.augment_beat_map(self._v1_payload())
        self.assertAlmostEqual(result["tempo"]["stability"], 1.0, places=3)

    def test_is_idempotent(self):
        once = self.module.augment_beat_map(self._v1_payload())
        twice = self.module.augment_beat_map(once)
        self.assertEqual(once, twice)

    def test_raises_when_beats_missing(self):
        with self.assertRaisesRegex(ValueError, "beats"):
            self.module.augment_beat_map({"tempo": {"bpm": 120}})

    def test_creates_tempo_dict_when_missing(self):
        payload = self._v1_payload()
        payload.pop("tempo")
        result = self.module.augment_beat_map(payload)
        self.assertIn("tempo", result)
        self.assertIn("stability", result["tempo"])


if __name__ == "__main__":
    unittest.main()
