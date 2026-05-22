import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "visual_peak_detector.py"


def load_module():
    spec = importlib.util.spec_from_file_location("visual_peak_detector", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DetectVisualPeaksFromScoresTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_returns_peaks_above_prominence_with_min_distance(self):
        samples = [
            {"tMs": 0, "motionScore": 0.1},
            {"tMs": 100, "motionScore": 0.2},
            {"tMs": 200, "motionScore": 1.5},
            {"tMs": 300, "motionScore": 0.3},
            {"tMs": 400, "motionScore": 1.4},
            {"tMs": 500, "motionScore": 0.2},
            {"tMs": 700, "motionScore": 1.8},
            {"tMs": 800, "motionScore": 0.2},
        ]
        peaks = self.module.detect_visual_peaks_from_scores(
            samples,
            min_distance_ms=250,
            min_prominence=0.7,
        )

        self.assertEqual([p["tMs"] for p in peaks], [200, 700])
        self.assertEqual(peaks[0]["peakId"], "peak_001")
        self.assertEqual(peaks[1]["peakId"], "peak_002")
        self.assertGreater(peaks[0]["prominence"], 0.7)
        self.assertGreater(peaks[1]["prominence"], 0.7)

    def test_returns_empty_for_no_samples(self):
        self.assertEqual(self.module.detect_visual_peaks_from_scores([]), [])

    def test_handles_nan_scores_safely(self):
        samples = [
            {"tMs": 0, "motionScore": 0.0},
            {"tMs": 100, "motionScore": float("nan")},
            {"tMs": 200, "motionScore": 2.0},
            {"tMs": 300, "motionScore": 0.0},
        ]
        peaks = self.module.detect_visual_peaks_from_scores(
            samples,
            min_distance_ms=100,
            min_prominence=0.5,
        )

        # NaN must not propagate; the spike at 200 must still be detected.
        self.assertEqual([p["tMs"] for p in peaks], [200])

    def test_respects_min_distance_collapses_close_peaks(self):
        samples = [
            {"tMs": i * 50, "motionScore": s}
            for i, s in enumerate([0.0, 2.0, 0.1, 1.8, 0.0, 0.0, 0.0, 1.9, 0.0])
        ]
        peaks = self.module.detect_visual_peaks_from_scores(
            samples,
            min_distance_ms=200,
            min_prominence=0.5,
        )

        # 50ms steps; min_distance=200ms = 4 samples; with two nearby peaks at 50 and 150
        # only one (the stronger) should survive within the 200ms window.
        times = [p["tMs"] for p in peaks]
        self.assertIn(50, times)
        self.assertNotIn(150, times)
        self.assertIn(350, times)


class SelectPeaksForBlockTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_linear_target_caps_long_block(self):
        # 10s block, 20 evenly-spaced candidate peaks.
        peaks = [
            {"peakId": f"peak_{i:03d}", "tMs": i * 500 + 300, "prominence": 1.0 + 0.1 * (i % 5)}
            for i in range(1, 20)
        ]
        selected = self.module.select_peaks_for_block(
            peaks,
            block_duration_ms=10_000,
            peaks_per_second=0.8,
            max_peaks=12,
            boundary_guard_ms=250,
        )

        # target = clamp(round(10 * 0.8), 1, 12) = 8
        self.assertEqual(len(selected), 8)
        # output must be sorted by tMs ascending
        self.assertEqual(selected, sorted(selected, key=lambda p: p["tMs"]))

    def test_drops_boundary_peaks_within_guard(self):
        peaks = [
            {"peakId": "p1", "tMs": 100, "prominence": 2.0},   # within 250ms guard
            {"peakId": "p2", "tMs": 500, "prominence": 1.5},
            {"peakId": "p3", "tMs": 9400, "prominence": 1.8},  # within 250ms of end (block=9500)
        ]
        selected = self.module.select_peaks_for_block(
            peaks,
            block_duration_ms=9500,
            peaks_per_second=0.8,
            max_peaks=12,
            boundary_guard_ms=250,
        )

        self.assertEqual([p["peakId"] for p in selected], ["p2"])

    def test_does_not_pad_when_fewer_peaks_than_target(self):
        # Only 2 peaks; target would be 8; must NOT fabricate peaks.
        peaks = [
            {"peakId": "p1", "tMs": 3000, "prominence": 2.0},
            {"peakId": "p2", "tMs": 6000, "prominence": 1.5},
        ]
        selected = self.module.select_peaks_for_block(
            peaks,
            block_duration_ms=10_000,
            peaks_per_second=0.8,
            max_peaks=12,
        )

        self.assertEqual(len(selected), 2)

    def test_skips_blocks_shorter_than_min_block_seconds(self):
        peaks = [{"peakId": "p1", "tMs": 500, "prominence": 2.0}]
        selected = self.module.select_peaks_for_block(
            peaks,
            block_duration_ms=1000,  # 1.0s, below default min 1.5s
            min_block_seconds=1.5,
        )

        self.assertEqual(selected, [])

    def test_picks_top_by_prominence_when_over_target(self):
        # 5 peaks in 5s block, target = round(5 * 0.8) = 4
        peaks = [
            {"peakId": "p1", "tMs": 1000, "prominence": 0.6},  # weakest
            {"peakId": "p2", "tMs": 2000, "prominence": 3.0},
            {"peakId": "p3", "tMs": 3000, "prominence": 1.2},
            {"peakId": "p4", "tMs": 3500, "prominence": 2.5},
            {"peakId": "p5", "tMs": 4500, "prominence": 1.0},
        ]
        # Wait: 3000 and 3500 only 500ms apart but no min_distance check at select level
        # (already done in detect). select just caps + sorts.
        selected = self.module.select_peaks_for_block(
            peaks,
            block_duration_ms=5000,
            peaks_per_second=0.8,
            max_peaks=12,
            boundary_guard_ms=250,
        )

        # Drop weakest (p1) keep top 4 by prominence: p2, p4, p3, p5 → sort by time
        self.assertEqual([p["peakId"] for p in selected], ["p2", "p3", "p4", "p5"])


class ComputeVisualScoreSeriesFromClipTests(unittest.TestCase):
    """Integration tests against a real ffmpeg-cut clip.

    Uses peak_test_1.4s.mp4 produced during P0.1. If the clip is missing
    (e.g., fresh checkout without P0.1 artifacts), these tests are skipped.
    """

    PROBE_CLIP = Path("C:/tmp/peak_window_probe/peak_test_1.4s.mp4")

    def setUp(self):
        if not self.PROBE_CLIP.exists():
            self.skipTest(f"P0.1 probe clip not found at {self.PROBE_CLIP}")
        self.module = load_module()

    def test_returns_per_frame_score_dicts_with_required_keys(self):
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)

        self.assertGreater(len(series), 0)
        for entry in series:
            self.assertIn("tMs", entry)
            self.assertIn("motionScore", entry)
            self.assertIn("channels", entry)
            for ch in ("hist_delta", "frame_diff", "flow_mag"):
                self.assertIn(ch, entry["channels"])

    def test_t_ms_is_non_negative_and_monotonic(self):
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)

        prev_t = -1
        for entry in series:
            t = int(entry["tMs"])
            self.assertGreaterEqual(t, 0)
            self.assertGreater(t, prev_t)
            prev_t = t

    def test_first_sample_has_zero_motion_score(self):
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)

        # First frame has no previous frame to diff against; all channels = 0.
        self.assertEqual(series[0]["channels"]["hist_delta"], 0.0)
        self.assertEqual(series[0]["channels"]["frame_diff"], 0.0)
        self.assertEqual(series[0]["channels"]["flow_mag"], 0.0)

    def test_motion_score_is_finite_float(self):
        import math as _math
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)

        for entry in series:
            score = float(entry["motionScore"])
            self.assertFalse(_math.isnan(score), f"NaN at t={entry['tMs']}")
            self.assertFalse(_math.isinf(score), f"Inf at t={entry['tMs']}")

    def test_sampling_density_around_target_fps(self):
        # Default target_fps=10 → ~10 samples per second.
        # P0.1 clip is 1.4s long, so expect ~14 samples (allow 10-20).
        series = self.module.compute_visual_score_series_from_clip(
            self.PROBE_CLIP, target_fps=10.0
        )
        self.assertGreaterEqual(len(series), 10)
        self.assertLessEqual(len(series), 20)


if __name__ == "__main__":
    unittest.main()
