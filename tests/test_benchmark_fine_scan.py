import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "benchmark_fine_scan.py"

sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("benchmark_fine_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class BenchmarkFineScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_find_bundled_ffmpeg_prefers_ffmpeg_static_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg_path = (
                root
                / "node_modules"
                / ".pnpm"
                / "ffmpeg-static@5.3.0"
                / "node_modules"
                / "ffmpeg-static"
                / "ffmpeg.exe"
            )
            ffmpeg_path.parent.mkdir(parents=True)
            ffmpeg_path.write_bytes(b"fake exe")

            self.assertEqual(self.module.find_bundled_ffmpeg(root), ffmpeg_path)

    def test_build_child_env_prepends_bundled_ffmpeg_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg_path = (
                root
                / "node_modules"
                / ".pnpm"
                / "ffmpeg-static@5.3.0"
                / "node_modules"
                / "ffmpeg-static"
                / "ffmpeg.exe"
            )
            ffmpeg_path.parent.mkdir(parents=True)
            ffmpeg_path.write_bytes(b"fake exe")

            env = self.module.build_child_env(repo_root=root, base_env={"PATH": "C:/Windows/System32"})

            path_head = env["PATH"].split(self.module.os.pathsep)[0]
            self.assertEqual(Path(path_head), ffmpeg_path.parent)

    def test_validate_inputs_explains_how_to_create_missing_rough_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_path = root / "video.mp4"
            video_path.write_bytes(b"fake video")
            missing_rough_scan = root / "analysis" / "rough_structure_scan.json"

            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(missing_rough_scan),
                    "--video",
                    str(video_path),
                    "--video-id",
                    "demo_video",
                ]
            )

            issues = self.module.validate_inputs(args)

            issue_text = "\n".join(issues)
            self.assertIn("Rough scan file not found", issue_text)
            self.assertIn("python scripts/rough_scan.py", issue_text)
            self.assertIn("--video-id demo_video", issue_text)
            self.assertIn(str(missing_rough_scan), issue_text)

    def test_build_rough_scan_from_structure_graph_segments(self):
        structure_graph = {
            "meta": {"duration": 12.0},
            "segments": [
                {
                    "id": "seg_block_001",
                    "role": "hook",
                    "start": 0.0,
                    "end": 3.0,
                    "purpose": "高能开场",
                    "caption": "产品入画",
                    "transferRule": "保留高能揭示",
                },
                {
                    "id": "seg_block_002",
                    "role": "cta",
                    "start": 3.0,
                    "end": 8.0,
                    "purpose": "CTA 收口",
                    "caption": "行动号召",
                    "transferRule": "保留收口节奏",
                },
            ],
        }

        rough_scan = self.module.build_rough_scan_from_structure_graph(structure_graph, video_id="demo")

        self.assertEqual(rough_scan["videoId"], "demo")
        self.assertEqual(len(rough_scan["contentBlocks"]), 2)
        self.assertEqual(rough_scan["contentBlocks"][0]["id"], "seg_block_001")
        self.assertEqual(rough_scan["contentBlocks"][0]["coarseRoleGuess"], "hook")
        self.assertEqual(rough_scan["contentBlocks"][0]["timeRange"], {"start": 0.0, "end": 3.0})
        self.assertIn("高能开场", rough_scan["contentBlocks"][0]["observableSummary"])
        self.assertIn("保留高能揭示", rough_scan["contentBlocks"][0]["fineScanFocusQuestions"][0])

    def test_validate_inputs_accepts_structure_graph_as_benchmark_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_path = root / "video.mp4"
            video_path.write_bytes(b"fake video")
            missing_rough_scan = root / "analysis" / "rough_structure_scan.json"
            structure_graph = root / "structure_graph.json"
            structure_graph.write_text(
                self.module.json.dumps({"segments": [{"id": "seg_001", "start": 0.0, "end": 1.0}]}),
                encoding="utf-8",
            )

            args = self.module.build_parser().parse_args(
                [
                    "--rough-scan",
                    str(missing_rough_scan),
                    "--structure-graph",
                    str(structure_graph),
                    "--video",
                    str(video_path),
                ]
            )

            self.assertEqual(self.module.validate_inputs(args), [])

    def test_build_benchmark_source_metadata_marks_structure_graph_as_derived(self):
        args = self.module.build_parser().parse_args(
            [
                "--structure-graph",
                "seed_assets/analysis/macbook_neo/structure_graph.json",
                "--rough-scan",
                "tmp/derived_rough_scan.json",
            ]
        )

        metadata = self.module.build_benchmark_source_metadata(
            args,
            effective_rough_scan="tmp/out/structure_graph_derived_rough_scan.json",
        )

        self.assertEqual(metadata["sourceType"], "structure_graph_derived")
        self.assertIn("structure_graph", metadata["limitations"][0])
        self.assertEqual(metadata["structureGraph"], "seed_assets/analysis/macbook_neo/structure_graph.json")
        self.assertEqual(metadata["effectiveRoughScan"], "tmp/out/structure_graph_derived_rough_scan.json")

    def test_build_timing_comparison_summarizes_stage_totals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            full_path = root / "full_timing.json"
            quick_path = root / "quick_timing.json"
            full_path.write_text(
                self.module.json.dumps(
                    {
                        "stageSummary": {
                            "block_clip_cut": {"totalMs": 100.0, "count": 1},
                            "peak_score": {"totalMs": 300.0, "count": 1},
                            "candidate_upload": {"totalMs": 200.0, "count": 2},
                        }
                    }
                ),
                encoding="utf-8",
            )
            quick_path.write_text(
                self.module.json.dumps(
                    {
                        "stageSummary": {
                            "block_clip_cut": {"totalMs": 80.0, "count": 1},
                            "peak_score": {"totalMs": 150.0, "count": 1},
                            "candidate_upload": {"totalMs": 50.0, "count": 1},
                        }
                    }
                ),
                encoding="utf-8",
            )

            comparison = self.module.build_timing_comparison(full_path, quick_path)

            self.assertEqual(comparison["full"]["totalMs"], 600.0)
            self.assertEqual(comparison["quick"]["totalMs"], 280.0)
            self.assertEqual(comparison["deltaMs"], 320.0)
            self.assertAlmostEqual(comparison["reductionPct"], 53.333)
            self.assertEqual(comparison["full"]["topStages"][0]["stage"], "peak_score")
            self.assertEqual(comparison["quick"]["topStages"][0]["stage"], "peak_score")


if __name__ == "__main__":
    unittest.main()
