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

        self.assertEqual(args.rough_scan, "seed_assets/analysis/macbook_neo/rough_structure_scan.json")
        self.assertEqual(args.video, "seed_assets/raw_videos/macbook_neo.mp4")
        self.assertEqual(args.beat_map, "seed_assets/analysis/macbook_neo/audio_beat_map.json")
        self.assertEqual(args.out_dir, "seed_assets/analysis/macbook_neo/fine_scan")
        self.assertEqual(args.work_dir, "seed_assets/analysis/macbook_neo/fine_scan/clips")
        self.assertEqual(args.base_url, "")
        self.assertEqual(args.model, "")

    def test_build_block_audio_analysis_uses_beat_this_relative_times(self):
        beat_map = {
            "method": {"primary": "beat_this"},
            "tempo": {"bpm": 83.33, "confidence": None},
            "beats": [
                {"time": 8.96, "beatNumber": 1, "isDownbeat": True},
                {"time": 9.20, "beatNumber": 2, "isDownbeat": False},
                {"time": 10.00, "beatNumber": 3, "isDownbeat": False},
                {"time": 13.20, "beatNumber": 1, "isDownbeat": True},
            ],
            "downbeats": [
                {"time": 8.96, "beatNumber": 1, "isDownbeat": True},
                {"time": 13.20, "beatNumber": 1, "isDownbeat": True},
            ],
        }

        result = self.module.build_block_audio_analysis(
            beat_map,
            start=9.0,
            end=13.0,
            beat_map_ref="beat_map.json",
        )

        self.assertEqual(result["source"], "beat_this")
        self.assertEqual(result["bpm"], 83.33)
        self.assertEqual(result["sourceBeatMapRef"], "beat_map.json")
        self.assertEqual(result["beatTimestamps"], [0.2, 1.0])
        self.assertEqual(result["downbeatTimestamps"], [])
        self.assertEqual(result["beatMarkers"][0]["absTime"], 9.2)
        self.assertEqual(result["beatMarkers"][0]["segRelTime"], 0.2)

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
            audio_result=None,
            video_id="demo",
        )

        self.assertEqual(variables["blockId"], "block_001")
        self.assertEqual(variables["coarseRoleGuess"], "attention_grab")
        self.assertEqual(variables["observableSummary"], "hands reveal product")
        self.assertEqual(variables["clipMode"], "source_quality_clip")
        self.assertEqual(variables["uploadSampling"], "provider_default_source_video")
        self.assertEqual(variables["clipResolution"], "source")
        self.assertIn("q1", variables["fineScanFocusQuestions"])
        self.assertIn("Beat-This", variables["audioAnalysis"])

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
