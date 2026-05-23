import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "visual_peak_detector.py"
SMOKE_FIXTURE = ROOT / "tests" / "fixtures" / "peak_smoke_2s.mp4"


def _has_video_stack() -> bool:
    """True iff av + ruptures + cv2 are importable.

    These are Fine Scan v0.3 heart dependencies (PR #24 review H3).
    Hosts without them (e.g. minimal Windows dev box) skip the related
    test classes cleanly instead of failing.
    """
    try:
        import av  # noqa: F401
        import ruptures  # noqa: F401
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


requires_video_stack = unittest.skipUnless(
    _has_video_stack(),
    "needs av + ruptures + cv2 (see requirements.txt)",
)


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


@requires_video_stack
class DetectRegimeBoundariesFromScoresTests(unittest.TestCase):
    """T13: ruptures-based regime boundary detection for motion-end events."""

    def setUp(self):
        self.module = load_module()

    def test_detects_high_to_low_regime_change(self):
        """A clear high-motion-then-low signal should produce a motion_end boundary."""
        # 30 samples @ 100ms step: first 15 high, last 15 low
        samples = [
            {"tMs": i * 100, "motionScore": (5.0 if i < 15 else 0.1)}
            for i in range(30)
        ]
        boundaries = self.module.detect_regime_boundaries_from_scores(samples, penalty=3)

        self.assertGreaterEqual(len(boundaries), 1)
        first = boundaries[0]
        # Regime change should land near index 15 (tMs ~ 1500)
        self.assertIn(first["eventType"], {"motion_start", "motion_end"})
        self.assertLessEqual(abs(first["tMs"] - 1500), 200)
        if first["eventType"] == "motion_end":
            self.assertGreater(first["magnitude"], 0)

    def test_detects_low_to_high_then_low_pattern(self):
        """Realistic: baseline → motion segment → baseline."""
        samples = [
            {"tMs": i * 100, "motionScore": (
                0.1 if i < 10 else (4.0 if i < 25 else 0.1)
            )}
            for i in range(40)
        ]
        boundaries = self.module.detect_regime_boundaries_from_scores(samples, penalty=3)

        # Should find at least 2 boundaries: motion_start near 1000ms and motion_end near 2500ms
        self.assertGreaterEqual(len(boundaries), 2)
        starts = [b for b in boundaries if b["eventType"] == "motion_start"]
        ends = [b for b in boundaries if b["eventType"] == "motion_end"]
        self.assertGreaterEqual(len(starts), 1)
        self.assertGreaterEqual(len(ends), 1)

    def test_empty_input_returns_empty(self):
        self.assertEqual(self.module.detect_regime_boundaries_from_scores([]), [])

    def test_handles_nan_safely(self):
        samples = [
            {"tMs": i * 100, "motionScore": (float("nan") if i == 5 else 1.0)}
            for i in range(20)
        ]
        # Should not raise
        result = self.module.detect_regime_boundaries_from_scores(samples, penalty=10)
        for b in result:
            self.assertIsInstance(b["tMs"], int)

    def test_boundary_fields_have_required_shape(self):
        samples = [
            {"tMs": i * 100, "motionScore": (5.0 if i < 10 else 0.1)}
            for i in range(20)
        ]
        boundaries = self.module.detect_regime_boundaries_from_scores(samples, penalty=3)

        for b in boundaries:
            self.assertIn("boundaryId", b)
            self.assertIn("tMs", b)
            self.assertIn("eventType", b)
            self.assertIn("magnitude", b)
            self.assertIn("anchorSource", b)
            self.assertEqual(b["anchorSource"], "regime_boundary")


class MergePeakAndRegimeCandidatesTests(unittest.TestCase):
    """T14: unify visual peaks + regime boundaries into one candidate list."""

    def setUp(self):
        self.module = load_module()

    def test_combines_peaks_and_regimes_into_one_list(self):
        peaks = [
            {"peakId": "peak_001", "tMs": 1000, "prominence": 3.0, "motionScore": 3.0},
            {"peakId": "peak_002", "tMs": 5000, "prominence": 5.0, "motionScore": 5.0},
        ]
        regimes = [
            {"boundaryId": "boundary_001", "tMs": 3000, "eventType": "motion_end",
             "magnitude": 2.5, "anchorSource": "regime_boundary"},
        ]

        merged = self.module.merge_peak_and_regime_candidates(peaks, regimes)

        self.assertEqual(len(merged), 3)
        # All have unified fields
        for cand in merged:
            self.assertIn("tMs", cand)
            self.assertIn("prominence", cand)
            self.assertIn("anchorSource", cand)
            self.assertIn("eventType", cand)
        # Output sorted by tMs
        self.assertEqual([c["tMs"] for c in merged], [1000, 3000, 5000])

    def test_dedups_regime_when_within_window_of_peak(self):
        """A regime boundary too close to a peak should be dropped (peak wins)."""
        peaks = [
            {"peakId": "peak_001", "tMs": 1000, "prominence": 3.0, "motionScore": 3.0},
        ]
        regimes = [
            {"boundaryId": "b1", "tMs": 1100, "eventType": "motion_start",
             "magnitude": 2.0, "anchorSource": "regime_boundary"},  # 100ms from peak → drop
            {"boundaryId": "b2", "tMs": 4000, "eventType": "motion_end",
             "magnitude": 3.0, "anchorSource": "regime_boundary"},  # far → keep
        ]

        merged = self.module.merge_peak_and_regime_candidates(
            peaks, regimes, dedup_window_ms=200,
        )

        self.assertEqual(len(merged), 2)
        self.assertEqual({c["tMs"] for c in merged}, {1000, 4000})

    def test_peak_eventType_defaults_to_peak(self):
        peaks = [
            {"peakId": "peak_001", "tMs": 500, "prominence": 1.0, "motionScore": 1.0},
        ]
        merged = self.module.merge_peak_and_regime_candidates(peaks, [])
        self.assertEqual(merged[0]["eventType"], "peak")
        self.assertEqual(merged[0]["anchorSource"], "visual_peak")

    def test_regime_uses_magnitude_as_prominence(self):
        peaks: list[dict] = []
        regimes = [
            {"boundaryId": "b1", "tMs": 3000, "eventType": "motion_end",
             "magnitude": 4.2, "anchorSource": "regime_boundary"},
        ]
        merged = self.module.merge_peak_and_regime_candidates(peaks, regimes)
        self.assertEqual(merged[0]["prominence"], 4.2)
        self.assertEqual(merged[0]["eventType"], "motion_end")

    def test_empty_inputs_return_empty(self):
        self.assertEqual(self.module.merge_peak_and_regime_candidates([], []), [])


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


@requires_video_stack
class ComputeVisualScoreSeriesFromClipTests(unittest.TestCase):
    """Integration tests against a real ffmpeg-cut clip.

    Uses peak_test_1.4s.mp4 produced during P0.1. If the clip is missing
    (e.g., fresh checkout without P0.1 artifacts), these tests are skipped.
    For deterministic CI coverage of the same code path see
    ComputeVisualScoreSeriesSmokeTests below.
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

    def test_score_series_includes_area_delta_channel(self):
        """T12: MOG2 foreground-area derivative as 4th channel for entry/exit events."""
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)
        for entry in series:
            self.assertIn("area_delta", entry["channels"])

    def test_first_sample_has_zero_area_delta(self):
        series = self.module.compute_visual_score_series_from_clip(self.PROBE_CLIP)
        # First sample's area_delta is 0 (no prior frame to compare).
        self.assertEqual(series[0]["channels"]["area_delta"], 0.0)

    def test_sampling_density_around_target_fps(self):
        # Default target_fps=10 → ~10 samples per second.
        # P0.1 clip is 1.4s long, so expect ~14 samples (allow 10-20).
        series = self.module.compute_visual_score_series_from_clip(
            self.PROBE_CLIP, target_fps=10.0
        )
        self.assertGreaterEqual(len(series), 10)
        self.assertLessEqual(len(series), 20)


@requires_video_stack
class ComputeVisualScoreSeriesSmokeTests(unittest.TestCase):
    """E2E smoke tests against the committed 2s synthetic fixture.

    Generated by (one-time, repo-committed at ~56 KB):
      ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=2" \\
        -vf "drawbox=enable='between(t,1.0,1.25)':color=white:t=fill" \\
        -c:v libx264 -pix_fmt yuv420p -crf 23 tests/fixtures/peak_smoke_2s.mp4

    PR #24 review H3: this is the first unit-layer coverage of the
    v0.3 heart code path (PyAV decode + OpenCV DIS + HSV + MOG2 + scipy
    find_peaks + ruptures PELT). Before this commit, all 137 passing
    Python tests skipped these functions on dev hosts and CI did not run
    them at all. The white flash at 1.0-1.25s creates a deterministic
    score spike + regime boundary that exercises every stage.
    """

    def setUp(self):
        if not SMOKE_FIXTURE.exists():
            self.skipTest(f"smoke fixture missing: {SMOKE_FIXTURE}")
        self.module = load_module()

    def test_compute_score_series_runs_and_returns_4_channels(self):
        series = self.module.compute_visual_score_series_from_clip(SMOKE_FIXTURE)
        self.assertGreaterEqual(len(series), 15,
                                f"expected >=15 samples in 2s, got {len(series)}")
        import math as _math
        for entry in series:
            self.assertIn("motionScore", entry)
            for ch in ("hist_delta", "frame_diff", "flow_mag", "area_delta"):
                self.assertIn(ch, entry["channels"], f"missing channel: {ch}")
            self.assertTrue(_math.isfinite(entry["motionScore"]))

    def test_white_flash_produces_visible_peak(self):
        series = self.module.compute_visual_score_series_from_clip(SMOKE_FIXTURE)
        peaks = self.module.detect_visual_peaks_from_scores(
            series, min_distance_ms=100, min_prominence=0.5,
        )
        # Flash 1.0-1.25s -> expect >=1 peak in [950, 1300] ms.
        peak_times = [p["tMs"] for p in peaks]
        in_window = [t for t in peak_times if 950 <= t <= 1300]
        self.assertGreaterEqual(
            len(in_window), 1,
            f"no peak in flash window [950,1300]ms; all peaks: {peak_times}",
        )

    def test_white_flash_is_a_regime_boundary(self):
        """First E2E coverage of detect_regime_boundaries_from_scores
        (ruptures PELT). Flash region must produce a regime change."""
        series = self.module.compute_visual_score_series_from_clip(SMOKE_FIXTURE)
        boundaries = self.module.detect_regime_boundaries_from_scores(
            series, penalty=1.5,
        )
        boundary_times = [b["tMs"] for b in boundaries]
        in_window = [t for t in boundary_times if 800 <= t <= 1400]
        self.assertGreaterEqual(
            len(in_window), 1,
            f"no regime change in flash window [800,1400]ms; all: {boundary_times}",
        )

    def test_full_pipeline_chained_yields_candidates(self):
        """End-to-end chain regression: scoring -> peaks -> regimes -> merge."""
        series = self.module.compute_visual_score_series_from_clip(SMOKE_FIXTURE)
        peaks = self.module.detect_visual_peaks_from_scores(
            series, min_distance_ms=100, min_prominence=0.5,
        )
        regimes = self.module.detect_regime_boundaries_from_scores(
            series, penalty=1.5,
        )
        merged = self.module.merge_peak_and_regime_candidates(
            peaks, regimes, dedup_window_ms=200,
        )
        self.assertGreater(len(merged), 0, "merged candidate list is empty")
        tms = [m["tMs"] for m in merged]
        self.assertEqual(tms, sorted(tms), "merged candidates not time-sorted")


if __name__ == "__main__":
    unittest.main()
