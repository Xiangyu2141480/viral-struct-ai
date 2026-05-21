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
        self.assertEqual(args.out_dir, "seed_assets/analysis/macbook_neo/fine_scan")
        self.assertEqual(args.work_dir, "seed_assets/analysis/macbook_neo/fine_scan/clips")
        self.assertEqual(args.base_url, "")
        self.assertEqual(args.model, "")

    def test_run_fine_scan_returns_failure_when_segment_json_cannot_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_scan_path = tmp_dir / "rough_structure_scan.json"
            out_dir = tmp_dir / "fine_scan"
            work_dir = tmp_dir / "clips"
            rough_scan_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "roughSegments": [
                            {
                                "id": "rough_seg_001",
                                "approxTimeRange": {"start": 0, "end": 1},
                                "possibleRole": "hook",
                                "purpose": "test",
                                "whatHappens": "test",
                                "inspectionQuestions": [],
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
                "prepare_segment_clip": self.module.prepare_segment_clip,
                "upload_file": self.module.upload_file,
                "wait_for_file": self.module.wait_for_file,
                "create_response": self.module.create_response,
            }
            try:
                self.module.prepare_segment_clip = lambda *args, **kwargs: ROOT / "seed_assets" / "raw_videos" / "TVC.mp4"
                self.module.upload_file = lambda **kwargs: {"id": "file-test"}
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
            self.assertEqual(failures["failedSegmentCount"], 1)
            self.assertEqual(failures["failures"][0]["segmentId"], "rough_seg_001")


if __name__ == "__main__":
    unittest.main()
