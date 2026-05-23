import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "doubao_fine_scan.py"


def load_module():
    spec = importlib.util.spec_from_file_location("doubao_fine_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DoubaoFineScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_parser_defaults_point_to_seed_analysis_flow_and_env_config(self):
        args = self.module.build_parser().parse_args([])

        self.assertEqual(args.rough_scan, "seed_assets/analysis/macbook_neo/stage1_rough/rough_structure_scan.json")
        self.assertEqual(args.video, "seed_assets/raw_videos/macbook_neo.mp4")
        self.assertEqual(args.beat_map, "seed_assets/analysis/macbook_neo/stage1_media/audio_beat_map.json")
        self.assertEqual(args.out_dir, "seed_assets/analysis/macbook_neo/fine_scan")
        self.assertEqual(args.work_dir, "seed_assets/analysis/macbook_neo/fine_scan/clips")
        self.assertEqual(args.base_url, "")
        self.assertEqual(args.model, "")

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
            self.assertEqual(upload_calls[0]["fps"], None)


if __name__ == "__main__":
    unittest.main()
