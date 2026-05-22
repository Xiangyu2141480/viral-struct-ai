import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "doubao_boundary_scan.py"


def load_module():
    spec = importlib.util.spec_from_file_location("doubao_boundary_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DoubaoBoundaryScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_time_mapping_converts_between_original_and_microscope_time(self):
        mapping = self.module.build_time_mapping(
            window_start=42.0,
            window_end=48.0,
            slowdown_factor=6.0,
        )

        self.assertEqual(mapping["microscopeDuration"], 36.0)
        self.assertEqual(self.module.original_to_microscope(45.0, mapping), 18.0)
        self.assertEqual(self.module.microscope_to_original(19.8, mapping), 45.3)
        self.assertEqual(
            self.module.microscope_range_to_original({"start": 12.6, "end": 19.8}, mapping),
            {"start": 44.1, "end": 45.3},
        )

    def test_build_normalized_input_maps_stage_one_context_and_beats(self):
        rough_scan = {
            "videoId": "macbook_neo",
            "contentBlocks": [
                {
                    "id": "block_003",
                    "timeRange": {"start": 26.5, "end": 45.0},
                    "coarseRoleGuess": "feature_or_claim",
                    "observableSummary": "屏幕和机身展示",
                },
                {
                    "id": "block_004",
                    "timeRange": {"start": 45.0, "end": 70.0},
                    "coarseRoleGuess": "demo_or_usage",
                    "observableSummary": "键盘和触控板演示",
                },
            ],
            "boundaryCandidates": [
                {
                    "id": "boundary_003",
                    "fromBlockId": "block_003",
                    "toBlockId": "block_004",
                    "roughBoundaryTime": 45.0,
                    "inspectionWindow": {"start": 42.0, "end": 48.0},
                    "visibleBoundaryCue": "双手合掌后画面碎裂",
                    "whyNeedsMicroscope": "需要确认碎裂分镜的精确时间",
                }
            ],
        }
        beat_map = {
            "beats": [
                {"time": 41.9, "beatNumber": 4, "isDownbeat": False},
                {"time": 42.5, "beatNumber": 1, "isDownbeat": True},
                {"time": 45.1, "beatNumber": 2, "isDownbeat": False},
                {"time": 47.5, "beatNumber": 1, "isDownbeat": True},
                {"time": 48.2, "beatNumber": 2, "isDownbeat": False},
            ],
            "downbeats": [
                {"time": 42.5, "beatNumber": 1, "isDownbeat": True},
                {"time": 47.5, "beatNumber": 1, "isDownbeat": True},
            ],
        }

        normalized = self.module.build_boundary_normalized_input(
            rough_scan,
            boundary_id="boundary_003",
            beat_map=beat_map,
            slowdown_factor=6.0,
            clip_path="boundary_003_microscope.mp4",
        )

        self.assertEqual(normalized["boundaryId"], "boundary_003")
        self.assertEqual(normalized["microscopeTimeline"]["duration"], 36.0)
        self.assertEqual(normalized["normalizedBoundaryPrior"]["roughBoundaryTime"], 18.0)
        self.assertEqual(normalized["sourceContext"]["fromBlockSummary"], "屏幕和机身展示")
        self.assertEqual(normalized["sourceContext"]["toBlockSummary"], "键盘和触控板演示")
        self.assertEqual(
            [beat["microscopeTime"] for beat in normalized["normalizedBeatMap"]["beats"]],
            [3.0, 18.6, 33.0],
        )
        self.assertEqual(
            [beat["microscopeTime"] for beat in normalized["normalizedBeatMap"]["downbeats"]],
            [3.0, 33.0],
        )
        self.assertEqual(normalized["normalizedBeatMap"]["nearestBeatToRoughBoundary"]["microscopeTime"], 18.6)

    def test_normalize_model_output_adds_original_times(self):
        normalized_input = {
            "boundaryId": "boundary_003",
            "timeMapping": {
                "windowOriginalTimeRange": {"start": 42.0, "end": 48.0},
                "slowdownFactor": 6.0,
                "microscopeDuration": 36.0,
            },
            "sourceContext": {
                "fromBlockId": "block_003",
                "toBlockId": "block_004",
            },
        }
        model_output = {
            "boundaryId": "boundary_003",
            "microShots": [
                {
                    "id": "micro_001",
                    "microscopeTimeRange": {"start": 0.0, "end": 12.6},
                    "visualChange": "双手靠近笔记本",
                    "confidence": 0.82,
                },
                {
                    "id": "micro_002",
                    "microscopeTimeRange": {"start": 12.6, "end": 19.8},
                    "visualChange": "笔记本碎裂成键帽碎片",
                    "possibleTransition": True,
                    "techniqueTags": ["object_fragmentation", "impact_cut"],
                    "confidence": 0.9,
                },
            ],
            "transitionCandidate": {
                "exists": True,
                "microscopeTimeRange": {"start": 12.6, "end": 19.8},
                "techniqueTags": ["object_fragmentation", "impact_cut"],
                "confidence": 0.9,
            },
            "semanticPivotMicroscopeTime": 19.8,
        }

        normalized = self.module.normalize_boundary_model_output(model_output, normalized_input)

        self.assertEqual(normalized["boundaryId"], "boundary_003")
        self.assertEqual(
            normalized["microShots"][1]["originalTimeRange"],
            {"start": 44.1, "end": 45.3},
        )
        self.assertEqual(
            normalized["transitionCandidate"]["originalTimeRange"],
            {"start": 44.1, "end": 45.3},
        )
        self.assertEqual(normalized["timelinePatch"]["patchType"], "insert_transition_unit")
        self.assertEqual(normalized["timelinePatch"]["fromBlockPatch"]["timeRangePatch"]["end"], 44.1)
        self.assertEqual(normalized["timelinePatch"]["transitionUnit"]["id"], "transition_boundary_003")
        self.assertEqual(normalized["timelinePatch"]["transitionUnit"]["unitType"], "transition")
        self.assertEqual(
            normalized["timelinePatch"]["transitionUnit"]["timeRange"],
            {"start": 44.1, "end": 45.3},
        )
        self.assertEqual(normalized["timelinePatch"]["transitionUnit"]["semanticPivotTime"], 45.3)
        self.assertEqual(normalized["timelinePatch"]["toBlockPatch"]["timeRangePatch"]["start"], 45.3)

    def test_prompt_restricts_model_to_microscope_time(self):
        prompt = (ROOT / "prompts" / "video_understanding" / "boundary_micro_scan_v0.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("microscopeTimeRange", prompt)
        self.assertIn("不要输出 originalTimeRange", prompt)
        self.assertIn("microShots", prompt)
        self.assertIn("transitionCandidate", prompt)
        self.assertIn("semanticPivotMicroscopeTime", prompt)

    def test_parser_defaults_point_to_stage_one_boundary_flow(self):
        args = self.module.build_parser().parse_args([])

        self.assertEqual(args.rough_scan, "seed_assets/analysis/macbook_neo/rough_structure_scan.json")
        self.assertEqual(args.video, "seed_assets/raw_videos/macbook_neo.mp4")
        self.assertEqual(args.beat_map, "seed_assets/analysis/macbook_neo/audio_beat_map.json")
        self.assertEqual(args.out_dir, "seed_assets/analysis/macbook_neo/boundary_micro_scan")
        self.assertIsNone(args.slowdown_factor)
        self.assertEqual(args.upload_fps, 5.0)

    def test_derive_slowdown_factor_uses_source_fps_over_upload_fps(self):
        probe = {
            "streams": [
                {"codec_type": "audio", "avg_frame_rate": "0/0", "r_frame_rate": "0/0"},
                {"codec_type": "video", "avg_frame_rate": "24000/1001", "r_frame_rate": "24000/1001"},
            ]
        }

        slowdown = self.module.derive_slowdown_factor(probe, upload_fps=5.0)

        self.assertAlmostEqual(slowdown, 4.795, places=3)

    def test_redact_api_config_hides_boundary_scan_key(self):
        redacted = self.module.redact_api_config({
            "base_url": "https://example.com/api/v3",
            "api_key": "secret-value",
            "model": "ep-test",
        })

        self.assertEqual(redacted["api_key"], "***")
        self.assertEqual(redacted["model"], "ep-test")


if __name__ == "__main__":
    unittest.main()
