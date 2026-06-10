import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "fine_scan.py"

# Import path_layout directly so test assertions reference the same source
# of truth that the script reads. If the layout ever changes, only
# path_layout.py needs touching — the tests follow automatically.
sys.path.insert(0, str(ROOT / "scripts"))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_PATHS = analysis_paths(DEFAULT_VIDEO_ID)


def load_module():
    spec = importlib.util.spec_from_file_location("fine_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FineScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_parser_defaults_point_to_seed_analysis_flow_and_env_config(self):
        args = self.module.build_parser().parse_args([])

        self.assertEqual(args.rough_scan, str(_PATHS.rough_scan))
        self.assertEqual(args.video, str(_PATHS.raw_video))
        self.assertEqual(args.beat_map, str(_PATHS.audio_beat_map))
        self.assertEqual(args.out_dir, str(_PATHS.fine_scan_dir))
        self.assertEqual(args.work_dir, str(_PATHS.fine_scan_clips_dir))
        self.assertEqual(args.base_url, "")
        self.assertEqual(args.model, "")

    def test_parser_perf_flags_have_expected_defaults(self):
        """PR perf-2 (A/B/C): separate upload lane, poll backoff, pool on."""
        args = self.module.build_parser().parse_args([])
        self.assertEqual(args.max_concurrent_upload, 20)
        self.assertEqual(args.poll_backoff, 1.5)
        self.assertEqual(args.poll_max_interval, 4.0)
        self.assertTrue(args.http_pool)

    def test_scan_preset_full_keeps_existing_quality_defaults(self):
        args = self.module.build_parser().parse_args([])

        self.assertEqual(args.scan_preset, "full")
        self.assertEqual(args.max_peaks, 12)
        self.assertEqual(args.max_total_candidates, 16)
        self.assertEqual(args.max_candidate_ceiling, 40)
        self.assertEqual(args.peak_upload_fps, 2.0)
        self.assertEqual(args.block_upload_fps, 1.0)
        self.assertEqual(args.candidate_workers, 10)
        self.assertEqual(args.block_workers, 8)

    def test_scan_preset_quick_sets_safer_candidate_budget_defaults(self):
        args = self.module.build_parser().parse_args(["--scan-preset", "quick"])

        self.assertEqual(args.max_peaks, 5)
        self.assertEqual(args.max_total_candidates, 8)
        self.assertEqual(args.max_candidate_ceiling, 12)
        self.assertEqual(args.peak_upload_fps, 1.0)
        self.assertEqual(args.block_upload_fps, 1.0)
        self.assertEqual(args.candidate_workers, 6)
        self.assertEqual(args.block_workers, 4)

    def test_scan_preset_quick_respects_explicit_user_overrides(self):
        args = self.module.build_parser().parse_args(
            [
                "--scan-preset",
                "quick",
                "--max-peaks",
                "9",
                "--candidate-workers",
                "3",
            ]
        )

        self.assertEqual(args.max_peaks, 9)
        self.assertEqual(args.candidate_workers, 3)
        # Other quick defaults still apply.
        self.assertEqual(args.max_total_candidates, 8)
        self.assertEqual(args.block_workers, 4)

    def test_no_http_pool_flag_disables_pool(self):
        args = self.module.build_parser().parse_args(["--no-http-pool"])
        self.assertFalse(args.http_pool)

    def test_block_prompt_variables_use_content_block_contract(self):
        block = {
            "id": "block_001",
            "timeRange": {"start": 0, "end": 3},
            "coarseRoleGuess": "attention_grab",
            "boundaryReason": "opening attention block",
            "observableSummary": "hands reveal product",
            "fineScanFocusQuestions": ["q1"],
        }
        variables = self.module.build_block_prompt_variables(
            block,
            video_id="demo",
            video_duration=12,
        )

        self.assertEqual(variables["blockId"], "block_001")
        self.assertEqual(variables["sourceStart"], 0)
        self.assertEqual(variables["sourceEnd"], 3)
        self.assertEqual(variables["blockDuration"], 3.0)
        self.assertEqual(variables["sourceVideoDuration"], 12)
        self.assertEqual(variables["normalizedStart"], 0.0)
        self.assertEqual(variables["normalizedEnd"], 0.25)
        self.assertEqual(variables["coarseRoleGuess"], "attention_grab")
        self.assertEqual(variables["observableSummary"], "hands reveal product")
        self.assertEqual(variables["clipMode"], "source_quality_clip")
        self.assertEqual(variables["uploadSampling"], "provider_default_source_video")
        self.assertEqual(variables["clipResolution"], "source")
        self.assertIn("q1", variables["fineScanFocusQuestions"])
        # T4: audio must NOT be injected into the model prompt anymore.
        self.assertNotIn("audioAnalysis", variables)

    def test_block_logger_buffers_then_flushes_atomically(self):
        """W1.2: per-block buffered logger for concurrent runs."""
        import io
        from contextlib import redirect_stdout

        logger = self.module.BlockLogger("block_001")
        logger.log("line A")
        logger.log("line B")

        buf = io.StringIO()
        with redirect_stdout(buf):
            logger.flush()

        output = buf.getvalue()
        self.assertIn("line A", output)
        self.assertIn("line B", output)
        # After flush, buffer is empty
        buf2 = io.StringIO()
        with redirect_stdout(buf2):
            logger.flush()
        self.assertEqual(buf2.getvalue(), "")

    def test_block_logger_preserves_line_order_within_block(self):
        import io
        from contextlib import redirect_stdout

        logger = self.module.BlockLogger("block_x")
        for i in range(5):
            logger.log(f"msg_{i}")

        buf = io.StringIO()
        with redirect_stdout(buf):
            logger.flush()

        lines = [l for l in buf.getvalue().splitlines() if l.startswith("msg_")]
        self.assertEqual(lines, ["msg_0", "msg_1", "msg_2", "msg_3", "msg_4"])

    def test_block_logger_two_loggers_do_not_interleave(self):
        """Concurrent flush from two loggers should not split lines."""
        import io
        import threading
        from contextlib import redirect_stdout

        logger_a = self.module.BlockLogger("block_a")
        logger_b = self.module.BlockLogger("block_b")
        for i in range(20):
            logger_a.log(f"A_{i:02d}")
            logger_b.log(f"B_{i:02d}")

        buf = io.StringIO()
        with redirect_stdout(buf):
            t_a = threading.Thread(target=logger_a.flush)
            t_b = threading.Thread(target=logger_b.flush)
            t_a.start(); t_b.start()
            t_a.join(); t_b.join()

        out = buf.getvalue()
        # Find first A line and last A line; all A lines must be contiguous
        lines = out.splitlines()
        a_indices = [i for i, l in enumerate(lines) if l.startswith("A_")]
        b_indices = [i for i, l in enumerate(lines) if l.startswith("B_")]
        # Either all A before B, or all B before A — never interleaved
        if a_indices and b_indices:
            a_block_contiguous = (max(a_indices) - min(a_indices) + 1) == len(a_indices)
            b_block_contiguous = (max(b_indices) - min(b_indices) + 1) == len(b_indices)
            self.assertTrue(a_block_contiguous, f"A lines were interleaved: {a_indices}")
            self.assertTrue(b_block_contiguous, f"B lines were interleaved: {b_indices}")

    def test_block_logger_concurrent_log_no_lost_lines(self):
        """PR #24 review M3 — fix latent race: when L1 candidate workers
        and the L2 block-metadata worker concurrently call log() on the
        same logger instance, no lines may be lost or partially written.
        Pre-M3 BlockLogger had no per-instance lock; this regression test
        keeps the fix in place."""
        import io as _io
        import threading as _threading
        from contextlib import redirect_stdout as _redir

        logger = self.module.BlockLogger("block_concurrent")
        n_threads, lines_per_thread = 8, 50
        total_expected = n_threads * lines_per_thread

        def worker(prefix: str) -> None:
            for i in range(lines_per_thread):
                logger.log(f"{prefix}_{i:03d}")

        threads = [
            _threading.Thread(target=worker, args=(f"T{t}",))
            for t in range(n_threads)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        buf = _io.StringIO()
        with _redir(buf):
            logger.flush()
        lines = [l for l in buf.getvalue().splitlines() if l]
        self.assertEqual(len(lines), total_expected,
                         f"expected {total_expected} lines, got {len(lines)}")
        # Every line must match the expected `T{n}_{nnn}` shape (no
        # partial writes / interleaved character corruption).
        import re
        for line in lines:
            self.assertRegex(line, r"^T\d_\d{3}$",
                             f"corrupted line: {line!r}")

    def test_block_logger_auto_flushes_after_stale_threshold(self):
        """PR #24 review M3 — UX fix: log() auto-flushes when the buffer is
        older than _AUTO_FLUSH_SECONDS so concurrent blocks don't go silent
        for minutes. We make the threshold testable by reaching in via
        the class constant."""
        import io as _io
        from contextlib import redirect_stdout as _redir

        logger = self.module.BlockLogger("block_stale")
        # Force the next log() to be "stale" by rewinding _last_flush_t.
        logger._last_flush_t -= (self.module.BlockLogger._AUTO_FLUSH_SECONDS + 1.0)

        buf = _io.StringIO()
        with _redir(buf):
            logger.log("auto-flushed line")

        out = buf.getvalue()
        self.assertIn("auto-flushed line", out,
                      "stale log() must auto-flush to stdout")
        # Buffer reset confirmed: a fresh flush() should write nothing.
        buf2 = _io.StringIO()
        with _redir(buf2):
            logger.flush()
        self.assertEqual(buf2.getvalue(), "")

    def test_align_anchor_to_audio_beat_finds_nearest_within_tolerance(self):
        result = self.module.align_anchor_to_audio_beat(
            anchor_ms=5748,
            audio_beats_ms=[3600, 5740, 6460],
            tolerance_ms=120,
        )

        self.assertEqual(result["nearestAudioBeatMs"], 5740)
        self.assertEqual(result["deltaMs"], 8)
        self.assertTrue(result["isBeatAligned"])
        self.assertEqual(result["alignmentToleranceMs"], 120)

    def test_align_anchor_to_audio_beat_flags_out_of_tolerance(self):
        result = self.module.align_anchor_to_audio_beat(
            anchor_ms=5000,
            audio_beats_ms=[3600, 5740, 6460],
            tolerance_ms=120,
        )

        self.assertEqual(result["nearestAudioBeatMs"], 5740)
        self.assertEqual(result["deltaMs"], -740)
        self.assertFalse(result["isBeatAligned"])

    def test_align_anchor_to_audio_beat_returns_none_when_no_beats(self):
        """Contract lock: empty audio_beats_ms must yield
        (None, None, False, tolerance_echoed). Don't change the return shape
        without updating every downstream consumer of actionBeats[*].nearest*."""
        result = self.module.align_anchor_to_audio_beat(
            anchor_ms=5000,
            audio_beats_ms=[],
            tolerance_ms=120,
        )

        self.assertIsNone(result["nearestAudioBeatMs"])
        self.assertIsNone(result["deltaMs"])
        self.assertFalse(result["isBeatAligned"])
        self.assertEqual(result["alignmentToleranceMs"], 120)

    def test_audio_beats_ms_in_block_abs_filters_and_converts(self):
        beat_map = {
            "beats": [
                {"time": 0.5, "isDownbeat": True},
                {"time": 5.74, "isDownbeat": True},
                {"time": 7.2, "isDownbeat": True},
                {"time": 20.0, "isDownbeat": False},
            ],
        }

        beats = self.module.audio_beats_ms_in_block_abs(
            beat_map,
            block_start_s=3.0,
            block_end_s=10.0,
        )

        # 0.5 and 20.0 are outside; 5.74 and 7.2 are inside → 5740 and 7200 absolute ms.
        self.assertEqual(beats, [5740, 7200])

    def test_audio_beats_ms_in_block_abs_handles_empty_map(self):
        beats = self.module.audio_beats_ms_in_block_abs(
            {"beats": []},
            block_start_s=0.0,
            block_end_s=10.0,
        )
        self.assertEqual(beats, [])

    def test_relative_position_bucket_maps_ratio_to_five_buckets(self):
        # block 10s; tBlockRel in ms
        cases = [
            (500, "early"),         # 5%
            (1500, "early"),        # 15%
            (2500, "mid_early"),    # 25%
            (3500, "mid_early"),    # 35%
            (4500, "mid"),          # 45%
            (5500, "mid"),          # 55%
            (6500, "mid_late"),     # 65%
            (7500, "mid_late"),     # 75%
            (8500, "late"),         # 85%
            (9500, "late"),         # 95%
        ]
        for t_ms, expected in cases:
            with self.subTest(t_ms=t_ms):
                self.assertEqual(
                    self.module.relative_position_bucket(t_ms, block_duration_ms=10_000),
                    expected,
                )

    def test_relative_position_bucket_clamps_when_block_zero(self):
        self.assertEqual(
            self.module.relative_position_bucket(0, block_duration_ms=0),
            "mid",
        )

    def test_aggregate_peak_semantics_attaches_code_owned_timing(self):
        visual_peaks = [
            {
                "peakId": "peak_001",
                "tMs": 5748,
                "windowMs": {"start": 5148, "end": 6548},
                "prominence": 4.8,
                "motionScore": 5.86,
                "channels": ["hist_delta", "frame_diff", "flow_mag"],
            },
        ]
        semantics = [
            {
                "peakId": "peak_001",
                "isMeaningfulAction": True,
                "semanticAction": "笔记本变成黄色",
                "actionType": "color_shift",
                "beforeState": "银色机身",
                "afterState": "黄色机身",
                "relativePositionBucket": "mid",
                "confidence": 0.91,
            },
        ]

        beats = self.module.aggregate_peak_semantics(
            visual_peaks=visual_peaks,
            semantic_results=semantics,
            audio_beats_ms=[5740],
            tolerance_ms=120,
        )

        self.assertEqual(len(beats), 1)
        beat = beats[0]
        self.assertEqual(beat["beatId"], "beat_001")
        self.assertEqual(beat["semanticAction"], "笔记本变成黄色")
        self.assertEqual(beat["actionType"], "color_shift")
        self.assertEqual(beat["beforeState"], "银色机身")
        self.assertEqual(beat["afterState"], "黄色机身")
        self.assertEqual(beat["anchorMs"], 5748)
        self.assertEqual(beat["timeRangeMs"], {"start": 5148, "end": 6548})
        self.assertEqual(beat["anchorSource"], "visual_peak")
        self.assertEqual(beat["nearestAudioBeatMs"], 5740)
        self.assertEqual(beat["deltaMs"], 8)
        self.assertTrue(beat["isBeatAligned"])
        self.assertEqual(beat["alignmentToleranceMs"], 120)
        self.assertEqual(beat["anchorConfidence"], 0.91)
        self.assertEqual(beat["visualPeak"]["peakId"], "peak_001")
        self.assertEqual(beat["visualPeak"]["prominence"], 4.8)

    def test_aggregate_peak_semantics_drops_not_meaningful(self):
        visual_peaks = [
            {"peakId": "peak_001", "tMs": 1000, "windowMs": {"start": 400, "end": 1800}, "prominence": 2.0, "motionScore": 2.0},
            {"peakId": "peak_002", "tMs": 5000, "windowMs": {"start": 4400, "end": 5800}, "prominence": 3.0, "motionScore": 3.0},
        ]
        semantics = [
            {"peakId": "peak_001", "isMeaningfulAction": False, "semanticAction": "无明显动作", "actionType": "none", "beforeState": "静态画面", "afterState": "静态画面", "relativePositionBucket": "early", "confidence": 0.4},
            {"peakId": "peak_002", "isMeaningfulAction": True, "semanticAction": "开盖", "actionType": "reveal", "beforeState": "盖闭", "afterState": "盖开", "relativePositionBucket": "mid", "confidence": 0.9},
        ]

        beats = self.module.aggregate_peak_semantics(
            visual_peaks=visual_peaks,
            semantic_results=semantics,
            audio_beats_ms=[],
            tolerance_ms=120,
        )

        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0]["beatId"], "beat_001")
        self.assertEqual(beats[0]["visualPeak"]["peakId"], "peak_002")

    def test_aggregate_peak_semantics_ignores_unknown_peak_ids(self):
        """Contract lock: hallucinated peakId from LLM (not in visual_peaks)
        is silently dropped. Important for resilience against LLM JSON parse
        errors that emit references to non-existent peak ids. (We have not
        observed this in practice — macbook_neo 0/139 — but the contract is
        intentional defensive behaviour.)"""
        visual_peaks = [
            {"peakId": "peak_001", "tMs": 1000, "windowMs": {"start": 400, "end": 1800}, "prominence": 2.0, "motionScore": 2.0},
        ]
        semantics = [
            {"peakId": "peak_001", "isMeaningfulAction": True, "semanticAction": "x", "actionType": "reveal", "beforeState": "a", "afterState": "b", "relativePositionBucket": "mid", "confidence": 0.8},
            {"peakId": "peak_999_hallucinated", "isMeaningfulAction": True, "semanticAction": "phantom", "actionType": "reveal", "beforeState": "x", "afterState": "y", "relativePositionBucket": "early", "confidence": 0.5},
        ]

        beats = self.module.aggregate_peak_semantics(
            visual_peaks=visual_peaks,
            semantic_results=semantics,
            audio_beats_ms=[],
            tolerance_ms=120,
        )

        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0]["visualPeak"]["peakId"], "peak_001")

    def test_aggregate_peak_semantics_handles_empty_audio_beats(self):
        visual_peaks = [
            {"peakId": "peak_001", "tMs": 5000, "windowMs": {"start": 4400, "end": 5800}, "prominence": 2.0, "motionScore": 2.0},
        ]
        semantics = [
            {"peakId": "peak_001", "isMeaningfulAction": True, "semanticAction": "x", "actionType": "reveal", "beforeState": "a", "afterState": "b", "relativePositionBucket": "mid", "confidence": 0.8},
        ]

        beats = self.module.aggregate_peak_semantics(
            visual_peaks=visual_peaks,
            semantic_results=semantics,
            audio_beats_ms=[],
            tolerance_ms=120,
        )

        self.assertEqual(len(beats), 1)
        self.assertIsNone(beats[0]["nearestAudioBeatMs"])
        self.assertIsNone(beats[0]["deltaMs"])
        self.assertFalse(beats[0]["isBeatAligned"])

    def test_aggregate_peak_semantics_assigns_sequential_beat_ids(self):
        visual_peaks = [
            {"peakId": "peak_001", "tMs": 1000, "windowMs": {"start": 400, "end": 1800}, "prominence": 2.0, "motionScore": 2.0},
            {"peakId": "peak_002", "tMs": 3000, "windowMs": {"start": 2400, "end": 3800}, "prominence": 1.5, "motionScore": 1.5},
            {"peakId": "peak_003", "tMs": 5000, "windowMs": {"start": 4400, "end": 5800}, "prominence": 3.0, "motionScore": 3.0},
        ]
        semantics = [
            {"peakId": "peak_001", "isMeaningfulAction": True, "semanticAction": "a", "actionType": "reveal", "beforeState": "x", "afterState": "y", "relativePositionBucket": "early", "confidence": 0.7},
            {"peakId": "peak_002", "isMeaningfulAction": False, "semanticAction": "noise", "actionType": "none", "beforeState": "x", "afterState": "x", "relativePositionBucket": "mid", "confidence": 0.3},
            {"peakId": "peak_003", "isMeaningfulAction": True, "semanticAction": "c", "actionType": "exit", "beforeState": "y", "afterState": "z", "relativePositionBucket": "late", "confidence": 0.9},
        ]

        beats = self.module.aggregate_peak_semantics(
            visual_peaks=visual_peaks,
            semantic_results=semantics,
            audio_beats_ms=[],
            tolerance_ms=120,
        )

        # peak_002 dropped (not meaningful); remaining beats get beat_001/beat_002.
        self.assertEqual([b["beatId"] for b in beats], ["beat_001", "beat_002"])
        self.assertEqual([b["visualPeak"]["peakId"] for b in beats], ["peak_001", "peak_003"])

    def test_rough_video_duration_uses_last_content_block_end(self):
        blocks = [
            {"id": "block_001", "timeRange": {"start": 0, "end": 3}},
            {"id": "block_002", "timeRange": {"start": 3, "end": 12.25}},
        ]

        self.assertEqual(self.module.rough_video_duration(blocks), 12.25)

    def test_fine_scan_prompt_keeps_model_away_from_timing_numbers(self):
        prompt = (ROOT / "prompts" / "video_understanding" / "fine_structure_scan_v0.md").read_text(
            encoding="utf-8"
        )

        # v0.3 semantic-only block-level schema fields kept
        self.assertIn("fine_content_block_semantic_v0_3", prompt)
        self.assertIn("roleConfirmation", prompt)
        self.assertIn("positionalContext", prompt)
        self.assertIn("textOverlayBehavior", prompt)
        self.assertIn("productPresentation", prompt)
        self.assertIn("requiredAssetType", prompt)
        self.assertIn("dominantTone", prompt)
        self.assertIn("transferableMotifs", prompt)
        # Action-beat / shot-level timing now owned by code via peak_micro_scan
        self.assertNotIn('"actionBeats"', prompt)
        self.assertNotIn('"shotStructure"', prompt)
        self.assertNotIn('"beatSyncAnalysis"', prompt)
        self.assertNotIn('"alignedToAudioBeatMs"', prompt)
        self.assertNotIn('"audioAnalysis"', prompt)
        self.assertNotIn("{{audioAnalysis}}", prompt)
        # Old v0.1 fields stay removed
        self.assertNotIn("keyVisualAction", prompt)
        self.assertNotIn("emotionMicroStructure", prompt)
        self.assertNotIn("additionalFindings", prompt)

    def test_v1_prompt_requires_exactly_two_acceptance_alternatives(self):
        """E: anyOf tightened from 2-4 to exactly 2 — keeps migrationContract
        (and its downstream slot fields) while halving the slowest-to-decode
        generative chunk on the block-scan critical path."""
        prompt = (ROOT / "prompts" / "video_understanding" / "fine_structure_scan_v1.md").read_text(
            encoding="utf-8"
        )
        # Still v1 — migration contract intact.
        self.assertIn("migrationContract", prompt)
        self.assertIn("acceptanceCriteria", prompt)
        # New constraint present, old 2-4 range gone.
        self.assertIn("恰好为 2", prompt)
        self.assertNotIn("2 到 4 之间", prompt)

    def test_peak_micro_prompt_has_no_timing_fields(self):
        prompt = (ROOT / "prompts" / "video_understanding" / "peak_micro_scan_v0.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("peakId", prompt)
        self.assertIn("isMeaningfulAction", prompt)
        self.assertIn("semanticAction", prompt)
        self.assertIn("actionType", prompt)
        self.assertIn("beforeState", prompt)
        self.assertIn("afterState", prompt)
        self.assertIn("relativePositionBucket", prompt)
        self.assertIn("confidence", prompt)
        self.assertIn("peak_semantic_v0_1", prompt)
        self.assertNotIn('"tMs"', prompt)
        self.assertNotIn('"anchorMs"', prompt)
        self.assertNotIn('"timeRangeMs"', prompt)
        self.assertNotIn('"alignedToAudioBeatMs"', prompt)
        self.assertNotIn('"nearestAudioBeatMs"', prompt)
        self.assertNotIn('"beatSyncAnalysis"', prompt)

    def test_prepare_block_clip_uses_source_quality_stream_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp)
            block = {"id": "block_001", "timeRange": {"start": 2.0, "end": 5.5}}
            commands = []

            original_run_ffmpeg = self.module.run_ffmpeg
            try:
                self.module.run_ffmpeg = lambda command, *, dry_run=False: commands.append(command)

                output_path = self.module.prepare_block_clip(
                    ROOT / "seed_assets" / "raw_videos" / "TVC.mp4",
                    block,
                    work_dir,
                )
            finally:
                self.module.run_ffmpeg = original_run_ffmpeg

            self.assertEqual(output_path.name, "block_001_source.mp4")
            self.assertEqual(len(commands), 1)
            command = commands[0]
            self.assertNotIn("-vf", command)
            self.assertNotIn("libx264", command)
            self.assertNotIn("-crf", command)
            self.assertNotIn("-an", command)
            self.assertIn("-c", command)
            self.assertEqual(command[command.index("-c") + 1], "copy")

    def test_run_fine_scan_returns_failure_when_content_block_json_cannot_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_scan_path = tmp_dir / "rough_structure_scan.json"
            out_dir = tmp_dir / "fine_scan"
            work_dir = tmp_dir / "clips"
            rough_scan_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "contentBlocks": [
                            {
                                "id": "block_001",
                                "timeRange": {"start": 0, "end": 1},
                                "coarseRoleGuess": "attention_grab",
                                "boundaryReason": "test",
                                "observableSummary": "test",
                                "fineScanFocusQuestions": [],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(rough_scan_path),
                    "--video",
                    str(ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"),
                    "--out-dir",
                    str(out_dir),
                    "--work-dir",
                    str(work_dir),
                    "--base-url",
                    "https://example.invalid/api/v3",
                    "--api-key",
                    "dummy",
                    "--model",
                    "ep-test",
                    "--skip-audio",
                    "--no-hard-cut",
                ]
            )

            originals = {
                "prepare_block_clip": self.module.prepare_block_clip,
                "upload_file": self.module.upload_file,
                "wait_for_file": self.module.wait_for_file,
                "create_response": self.module.create_response,
            }
            upload_calls = []
            try:
                self.module.prepare_block_clip = lambda *args, **kwargs: ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"
                self.module.upload_file = lambda **kwargs: upload_calls.append(kwargs) or {"id": "file-test"}
                self.module.wait_for_file = lambda **kwargs: {"status": "processed"}
                self.module.create_response = lambda **kwargs: {"output_text": "not json"}

                result = self.module.run_fine_scan(args)
            finally:
                for name, value in originals.items():
                    setattr(self.module, name, value)

            self.assertEqual(result, 1)
            failure_path = out_dir / "fine_scan_failures.json"
            self.assertTrue(failure_path.exists())
            failures = json.loads(failure_path.read_text(encoding="utf-8"))
            self.assertEqual(failures["failedBlockCount"], 1)
            self.assertEqual(failures["failures"][0]["blockId"], "block_001")
            # PR #44: block-level fine_structure_scan upload now sends an explicit
            # low-fps hint (default --block-upload-fps=1.0) instead of provider
            # default. Block is 1.0s < min_block_seconds and --no-hard-cut, so no
            # candidate uploads precede it — upload_calls[0] is the block upload.
            self.assertEqual(upload_calls[0]["fps"], 1.0)

    def test_scan_config_fingerprint_tracks_prompt_video_block_and_candidate_config(self):
        block = {
            "id": "block_001",
            "timeRange": {"start": 0, "end": 2.5},
            "coarseRoleGuess": "attention_grab",
        }
        args = self.module.build_parser().parse_args(["--prompt-version", "v1"])

        first = self.module.build_scan_config_fingerprint(block, args, video_id="demo")

        args.max_peaks += 1
        second = self.module.build_scan_config_fingerprint(block, args, video_id="demo")

        self.assertNotEqual(first["hash"], second["hash"])
        self.assertEqual(first["config"]["promptVersion"], "v1")
        self.assertEqual(first["config"]["videoId"], "demo")
        self.assertEqual(first["config"]["blockId"], "block_001")
        self.assertEqual(first["config"]["blockTimeRange"], {"start": 0.0, "end": 2.5})
        self.assertIn("promptFileHash", first["config"])
        self.assertIn("peakMicroPromptFileHash", first["config"])

    def test_scan_config_fingerprint_invalidates_each_resume_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            prompt_path = tmp_dir / "fine_prompt.md"
            peak_prompt_path = tmp_dir / "peak_prompt.md"
            prompt_path.write_text("fine prompt v1", encoding="utf-8")
            peak_prompt_path.write_text("peak prompt v1", encoding="utf-8")
            block = {
                "id": "block_001",
                "timeRange": {"start": 0, "end": 2.5},
                "coarseRoleGuess": "attention_grab",
                "boundaryReason": "cut on movement",
                "observableSummary": "fast object entry",
                "fineScanFocusQuestions": ["what changed?"],
            }

            def make_args(*extra: str):
                return self.module.build_parser().parse_args(
                    [
                        "--prompt-version",
                        "v1",
                        "--prompt",
                        str(prompt_path),
                        "--peak-micro-prompt",
                        str(peak_prompt_path),
                        "--model",
                        "ep-a",
                        *extra,
                    ]
                )

            base_args = make_args()
            base_hash = self.module.build_scan_config_fingerprint(block, base_args, video_id="demo")["hash"]

            cases: list[tuple[str, dict[str, Any] | None, Any]] = [
                ("videoId", None, lambda: self.module.build_scan_config_fingerprint(block, base_args, video_id="demo-2")["hash"]),
                (
                    "blockTimeRange",
                    {**block, "timeRange": {"start": 0.5, "end": 2.5}},
                    None,
                ),
                ("model", None, lambda: self.module.build_scan_config_fingerprint(block, make_args("--model", "ep-b"), video_id="demo")["hash"]),
                (
                    "fps",
                    None,
                    lambda: self.module.build_scan_config_fingerprint(block, make_args("--peak-upload-fps", "1.5"), video_id="demo")["hash"],
                ),
                (
                    "candidateConfig",
                    None,
                    lambda: self.module.build_scan_config_fingerprint(block, make_args("--max-peaks", "13"), video_id="demo")["hash"],
                ),
            ]
            for label, changed_block, hash_factory in cases:
                with self.subTest(label=label):
                    changed_hash = (
                        self.module.build_scan_config_fingerprint(changed_block, base_args, video_id="demo")["hash"]
                        if changed_block is not None
                        else hash_factory()
                    )
                    self.assertNotEqual(base_hash, changed_hash)

            prompt_path.write_text("fine prompt v2", encoding="utf-8")
            prompt_changed_hash = self.module.build_scan_config_fingerprint(block, base_args, video_id="demo")["hash"]
            self.assertNotEqual(base_hash, prompt_changed_hash)

            prompt_path.write_text("fine prompt v1", encoding="utf-8")
            peak_prompt_path.write_text("peak prompt v2", encoding="utf-8")
            peak_prompt_changed_hash = self.module.build_scan_config_fingerprint(block, base_args, video_id="demo")["hash"]
            self.assertNotEqual(base_hash, peak_prompt_changed_hash)

    def test_candidate_budget_full_keeps_existing_density_formula(self):
        args = self.module.build_parser().parse_args([])
        block = {"id": "block_001", "coarseRoleGuess": "static_explainer"}

        self.assertEqual(self.module.candidate_budget_for_block(block, args, hard_cut_count=30), 30)

    def test_candidate_budget_quick_preserves_more_for_structurally_important_blocks(self):
        args = self.module.build_parser().parse_args(["--scan-preset", "quick"])
        block = {
            "id": "block_001",
            "coarseRoleGuess": "attention_grab",
            "observableSummary": "kinetic assembly reveal with CTA burst",
        }

        self.assertEqual(self.module.candidate_budget_for_block(block, args, hard_cut_count=3), 10)

    def test_candidate_budget_quick_reduces_static_low_motion_blocks(self):
        args = self.module.build_parser().parse_args(["--scan-preset", "quick"])
        block = {
            "id": "block_009",
            "coarseRoleGuess": "static_explainer",
            "observableSummary": "static text explanation on product details",
        }

        self.assertEqual(self.module.candidate_budget_for_block(block, args, hard_cut_count=0), 5)

    def test_candidate_budget_class_describes_budget_reason(self):
        important = {"coarseRoleGuess": "attention_grab", "observableSummary": "kinetic CTA reveal"}
        static = {"coarseRoleGuess": "static_explainer", "observableSummary": "static details"}
        ordinary = {"coarseRoleGuess": "middle", "observableSummary": "product movement"}

        self.assertEqual(self.module.candidate_budget_class_for_block(important), "important_structure")
        self.assertEqual(self.module.candidate_budget_class_for_block(static), "static_low_motion")
        self.assertEqual(self.module.candidate_budget_class_for_block(ordinary), "default")

    def test_candidate_source_counts_are_stable_for_benchmarking(self):
        candidates = [
            {"anchorSource": "visual_peak"},
            {"anchorSource": "hard_cut"},
            {"anchorSource": "hard_cut"},
            {"anchorSource": "regime_boundary"},
        ]

        self.assertEqual(
            self.module.count_candidate_sources(candidates),
            {"hard_cut": 2, "regime_boundary": 1, "visual_peak": 1},
        )

    def test_candidate_benchmark_report_computes_reduction_and_guardrails(self):
        full_scan = {
            "contentBlocks": [
                {
                    "blockId": "block_001",
                    "candidateBudgetClass": "important_structure",
                    "totalCandidateCount": 10,
                    "selectedHardCutCount": 2,
                    "candidateSourceCounts": {"hard_cut": 2, "visual_peak": 8},
                },
                {
                    "blockId": "block_002",
                    "candidateBudgetClass": "static_low_motion",
                    "totalCandidateCount": 8,
                    "selectedHardCutCount": 0,
                    "candidateSourceCounts": {"visual_peak": 8},
                },
            ],
        }
        quick_scan = {
            "contentBlocks": [
                {
                    "blockId": "block_001",
                    "candidateBudgetClass": "important_structure",
                    "totalCandidateCount": 6,
                    "selectedHardCutCount": 2,
                    "candidateSourceCounts": {"hard_cut": 2, "visual_peak": 4},
                },
                {
                    "blockId": "block_002",
                    "candidateBudgetClass": "static_low_motion",
                    "totalCandidateCount": 5,
                    "selectedHardCutCount": 0,
                    "candidateSourceCounts": {"visual_peak": 5},
                },
            ],
        }

        report = self.module.build_candidate_benchmark_report(
            video_id="demo",
            full_scan=full_scan,
            quick_scan=quick_scan,
        )

        self.assertEqual(report["summary"]["fullTotalCandidates"], 18)
        self.assertEqual(report["summary"]["quickTotalCandidates"], 11)
        self.assertEqual(report["summary"]["candidateReductionPct"], 38.889)
        self.assertTrue(report["qualityGuardrail"]["passed"])
        self.assertEqual(report["qualityGuardrail"]["hardCutLossBlocks"], [])
        self.assertEqual(report["qualityGuardrail"]["importantBlocksUnderFloor"], [])

    def test_candidate_benchmark_guardrail_fails_when_quick_loses_hard_cuts(self):
        full_scan = {
            "contentBlocks": [
                {
                    "blockId": "block_001",
                    "candidateBudgetClass": "important_structure",
                    "totalCandidateCount": 6,
                    "selectedHardCutCount": 2,
                }
            ],
        }
        quick_scan = {
            "contentBlocks": [
                {
                    "blockId": "block_001",
                    "candidateBudgetClass": "important_structure",
                    "totalCandidateCount": 6,
                    "selectedHardCutCount": 1,
                }
            ],
        }

        report = self.module.build_candidate_benchmark_report(
            video_id="demo",
            full_scan=full_scan,
            quick_scan=quick_scan,
        )

        self.assertFalse(report["qualityGuardrail"]["passed"])
        self.assertEqual(report["qualityGuardrail"]["hardCutLossBlocks"], ["block_001"])

    def test_candidate_benchmark_markdown_explains_timing_and_quality_guardrail(self):
        report = {
            "videoId": "demo",
            "summary": {
                "fullTotalCandidates": 18,
                "quickTotalCandidates": 11,
                "candidateReductionPct": 38.889,
            },
            "qualityGuardrail": {
                "passed": True,
                "missingQuickBlocks": [],
                "hardCutLossBlocks": [],
                "importantBlocksUnderFloor": [],
            },
            "timingReports": {
                "full": "tmp/fine-scan/full/fine_scan_timing.json",
                "quick": "tmp/fine-scan/quick/fine_scan_timing.json",
            },
            "timingSummary": {
                "full": {
                    "totalMs": 600.0,
                    "topStages": [{"stage": "peak_score", "totalMs": 300.0}],
                },
                "quick": {
                    "totalMs": 280.0,
                    "topStages": [{"stage": "peak_score", "totalMs": 150.0}],
                },
                "deltaMs": 320.0,
                "reductionPct": 53.333,
            },
            "benchmarkSource": {
                "sourceType": "structure_graph_derived",
                "effectiveRoughScan": "tmp/out/structure_graph_derived_rough_scan.json",
                "limitations": [
                    "structure_graph-derived contentBlocks are for no-LLM candidate/timing benchmarking only"
                ],
            },
            "perBlock": [],
        }

        markdown = self.module.render_candidate_benchmark_markdown(report)

        self.assertIn("Fine Scan Candidate Benchmark", markdown)
        self.assertIn("Quality Guardrail", markdown)
        self.assertIn("Timing report", markdown)
        self.assertIn("tmp/fine-scan/full/fine_scan_timing.json", markdown)
        self.assertIn("tmp/fine-scan/quick/fine_scan_timing.json", markdown)
        self.assertIn("full total: `600.0ms`", markdown)
        self.assertIn("quick total: `280.0ms`", markdown)
        self.assertIn("timing reduction: `53.333%`", markdown)
        self.assertIn("peak_score", markdown)
        self.assertIn("structure_graph_derived", markdown)
        self.assertIn("structure_graph-derived contentBlocks", markdown)

    def test_resume_skips_block_only_when_fingerprint_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_scan_path = tmp_dir / "rough_structure_scan.json"
            out_dir = tmp_dir / "fine_scan"
            work_dir = tmp_dir / "clips"
            out_dir.mkdir(parents=True)
            block = {
                "id": "block_001",
                "timeRange": {"start": 0, "end": 1},
                "coarseRoleGuess": "attention_grab",
                "boundaryReason": "test",
                "observableSummary": "test",
                "fineScanFocusQuestions": [],
            }
            rough_scan_path.write_text(
                json.dumps({"videoId": "demo", "contentBlocks": [block]}),
                encoding="utf-8",
            )
            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(rough_scan_path),
                    "--video",
                    str(ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"),
                    "--out-dir",
                    str(out_dir),
                    "--work-dir",
                    str(work_dir),
                    "--base-url",
                    "https://example.invalid/api/v3",
                    "--api-key",
                    "dummy",
                    "--model",
                    "ep-test",
                    "--skip-audio",
                    "--resume",
                ]
            )
            args.prompt = self.module.resolve_prompt_path(args)
            fingerprint = self.module.build_scan_config_fingerprint(block, args, video_id="demo")
            cached_block = {
                "schemaVersion": "fine_content_block_semantic_v0_3",
                "blockId": "block_001",
                "videoId": "demo",
                "scanConfigFingerprint": fingerprint["hash"],
                "scanConfig": fingerprint["config"],
                "actionBeats": [],
            }
            (out_dir / "block_001_fine_scan.json").write_text(
                json.dumps(cached_block),
                encoding="utf-8",
            )

            calls = []
            original_process = self.module.process_block_with_peak_micro
            try:
                self.module.process_block_with_peak_micro = (
                    lambda *args, **kwargs: calls.append("processed") or (cached_block, None)
                )
                result = self.module.run_fine_scan(args)
            finally:
                self.module.process_block_with_peak_micro = original_process

            self.assertEqual(result, 0)
            self.assertEqual(calls, [])
            combined = json.loads((out_dir / "fine_structure_scan.json").read_text(encoding="utf-8"))
            self.assertEqual(combined["blockCount"], 1)
            self.assertEqual(combined["contentBlocks"][0]["blockId"], "block_001")

    def test_resume_rejects_corrupt_or_incomplete_block_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            block = {
                "id": "block_001",
                "timeRange": {"start": 0, "end": 1},
                "coarseRoleGuess": "attention_grab",
            }
            args = self.module.build_parser().parse_args(["--resume"])

            block_path = out_dir / "block_001_fine_scan.json"
            block_path.write_text("{not valid json", encoding="utf-8")
            self.assertIsNone(
                self.module.load_resumable_block_output(block, args=args, video_id="demo", out_dir=out_dir)
            )

            fingerprint = self.module.build_scan_config_fingerprint(block, args, video_id="demo")
            incomplete = {
                "schemaVersion": "fine_content_block_semantic_v0_3",
                "blockId": "block_001",
                "videoId": "demo",
                "scanConfigFingerprint": fingerprint["hash"],
                "scanConfig": fingerprint["config"],
            }
            block_path.write_text(json.dumps(incomplete), encoding="utf-8")
            self.assertIsNone(
                self.module.load_resumable_block_output(block, args=args, video_id="demo", out_dir=out_dir)
            )

            wrong_schema = {**incomplete, "schemaVersion": "fine_scan_failure", "actionBeats": []}
            block_path.write_text(json.dumps(wrong_schema), encoding="utf-8")
            self.assertIsNone(
                self.module.load_resumable_block_output(block, args=args, video_id="demo", out_dir=out_dir)
            )

    def test_candidates_only_does_not_require_llm_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_scan_path = tmp_dir / "rough_structure_scan.json"
            out_dir = tmp_dir / "fine_scan"
            work_dir = tmp_dir / "clips"
            rough_scan_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "contentBlocks": [
                            {
                                "id": "block_001",
                                "timeRange": {"start": 0, "end": 1},
                                "coarseRoleGuess": "attention_grab",
                                "boundaryReason": "test",
                                "observableSummary": "test",
                                "fineScanFocusQuestions": [],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(rough_scan_path),
                    "--video",
                    str(ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"),
                    "--out-dir",
                    str(out_dir),
                    "--work-dir",
                    str(work_dir),
                    "--env",
                    str(tmp_dir / "missing.env"),
                    "--skip-audio",
                    "--no-hard-cut",
                    "--candidates-only",
                ]
            )

            originals = {
                "prepare_block_clip": self.module.prepare_block_clip,
                "compute_visual_score_series_from_clip": self.module.compute_visual_score_series_from_clip,
            }
            try:
                self.module.prepare_block_clip = lambda *args, **kwargs: ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"
                self.module.compute_visual_score_series_from_clip = lambda *args, **kwargs: []
                result = self.module.run_fine_scan(args)
            finally:
                for name, value in originals.items():
                    setattr(self.module, name, value)

            self.assertEqual(result, 0)
            combined = json.loads((out_dir / "fine_structure_scan.json").read_text(encoding="utf-8"))
            self.assertTrue(combined["contentBlocks"][0]["candidatesOnly"])

    def test_candidates_only_accepts_windows_utf8_bom_rough_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_scan_path = tmp_dir / "rough_structure_scan.json"
            out_dir = tmp_dir / "fine_scan"
            work_dir = tmp_dir / "clips"
            rough_scan_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "contentBlocks": [
                            {
                                "id": "block_001",
                                "timeRange": {"start": 0, "end": 1},
                                "coarseRoleGuess": "attention_grab",
                                "boundaryReason": "test",
                                "observableSummary": "test",
                                "fineScanFocusQuestions": [],
                            }
                        ],
                    }
                ),
                encoding="utf-8-sig",
            )
            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(rough_scan_path),
                    "--video",
                    str(ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"),
                    "--out-dir",
                    str(out_dir),
                    "--work-dir",
                    str(work_dir),
                    "--env",
                    str(tmp_dir / "missing.env"),
                    "--skip-audio",
                    "--no-hard-cut",
                    "--candidates-only",
                ]
            )

            originals = {
                "prepare_block_clip": self.module.prepare_block_clip,
                "compute_visual_score_series_from_clip": self.module.compute_visual_score_series_from_clip,
            }
            try:
                self.module.prepare_block_clip = lambda *args, **kwargs: ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"
                self.module.compute_visual_score_series_from_clip = lambda *args, **kwargs: []
                result = self.module.run_fine_scan(args)
            finally:
                for name, value in originals.items():
                    setattr(self.module, name, value)

            self.assertEqual(result, 0)

    def test_timing_report_writes_named_stage_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            block_results = [
                {
                    "blockId": "block_001",
                    "timingInfo": [
                        {"stage": "block_clip_cut", "elapsedMs": 10.0},
                        {"stage": "candidate_upload", "elapsedMs": 20.0},
                    ],
                }
            ]

            report_path = self.module.write_timing_report(out_dir, video_id="demo", block_results=block_results)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["videoId"], "demo")
            self.assertEqual(report["stageSummary"]["block_clip_cut"]["count"], 1)
            self.assertEqual(report["stageSummary"]["candidate_upload"]["totalMs"], 20.0)
            for stage in self.module.FINE_SCAN_TIMING_STAGES:
                self.assertIn(stage, report["stageSummary"])


class PromptVersionResolutionTests(unittest.TestCase):
    """--prompt-version switch + --prompt escape-hatch resolution.

    v1 is what lets fine_scan emit migrationContract for downstream
    structure-graph extraction; v0 stays the backward-compatible default.
    """

    def setUp(self):
        self.module = load_module()

    def test_prompt_default_is_none_sentinel(self):
        # default must be None so resolve_prompt_path can fall back to version
        args = self.module.build_parser().parse_args([])
        self.assertIsNone(args.prompt)

    def test_default_resolves_to_v0_prompt(self):
        args = self.module.build_parser().parse_args([])
        self.assertEqual(
            self.module.resolve_prompt_path(args),
            "prompts/video_understanding/fine_structure_scan_v0.md",
        )

    def test_prompt_version_v1_resolves_to_v1_prompt(self):
        args = self.module.build_parser().parse_args(["--prompt-version", "v1"])
        self.assertEqual(
            self.module.resolve_prompt_path(args),
            "prompts/video_understanding/fine_structure_scan_v1.md",
        )

    def test_explicit_prompt_overrides_version(self):
        # explicit --prompt wins even when --prompt-version is v1
        args = self.module.build_parser().parse_args(
            ["--prompt", "custom/my_prompt.md", "--prompt-version", "v1"]
        )
        self.assertEqual(
            self.module.resolve_prompt_path(args), "custom/my_prompt.md"
        )

    def test_prompt_version_rejects_unknown_value(self):
        with self.assertRaises(SystemExit):
            self.module.build_parser().parse_args(["--prompt-version", "v2"])


if __name__ == "__main__":
    unittest.main()
