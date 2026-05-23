"""Tests for scripts/path_layout.py.

Pure-function tests — exercises the layout contract that every stage1
script depends on. If any of these break, every other script's tests
will also break, so keep the assertions specific (one path per test).
"""

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "path_layout.py"

sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("path_layout", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DefaultVideoIdTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_default_video_id_is_macbook_neo(self):
        # All scripts default to this id; changing it changes the entire
        # default pipeline target. Keep this test as a load-bearing check.
        self.assertEqual(self.module.DEFAULT_VIDEO_ID, "macbook_neo")


class AnalysisPathsContractTests(unittest.TestCase):
    """Contract tests — covers every field that ANY stage1 script reads."""

    def setUp(self):
        self.module = load_module()
        self.paths = self.module.analysis_paths("macbook_neo")

    def test_returns_video_paths_namedtuple(self):
        self.assertIsInstance(self.paths, self.module.VideoPaths)

    def test_raw_video_under_seed_assets_raw_videos(self):
        self.assertEqual(
            self.paths.raw_video,
            Path("seed_assets/raw_videos/macbook_neo.mp4"),
        )

    def test_preview_video_includes_default_transcode_profile(self):
        self.assertEqual(
            self.paths.preview_video,
            Path("seed_assets/processed_videos/macbook_neo_preview_5fps_720w.mp4"),
        )

    def test_rough_scan_under_stage1_rough(self):
        self.assertEqual(
            self.paths.rough_scan,
            Path("seed_assets/analysis/macbook_neo/stage1_rough/rough_structure_scan.json"),
        )

    def test_media_technical_under_stage1_media(self):
        self.assertEqual(
            self.paths.media_technical,
            Path("seed_assets/analysis/macbook_neo/stage1_media/media_technical.json"),
        )

    def test_audio_beat_map_and_wav_share_directory(self):
        # The wav is the source for ASR; both should live in stage1_media.
        self.assertEqual(
            self.paths.audio_beat_map,
            Path("seed_assets/analysis/macbook_neo/stage1_media/audio_beat_map.json"),
        )
        self.assertEqual(
            self.paths.audio_beat_wav,
            Path("seed_assets/analysis/macbook_neo/stage1_media/audio_beat_map.wav"),
        )

    def test_speech_transcript_under_stage1_media(self):
        self.assertEqual(
            self.paths.speech_transcript,
            Path("seed_assets/analysis/macbook_neo/stage1_media/speech_transcript.json"),
        )

    def test_fine_scan_dir_and_clips_subdir(self):
        self.assertEqual(
            self.paths.fine_scan_dir,
            Path("seed_assets/analysis/macbook_neo/fine_scan"),
        )
        # clips/ must be a direct child of fine_scan/, not a sibling —
        # doubao_fine_scan.py and tests depend on this nesting.
        self.assertEqual(
            self.paths.fine_scan_clips_dir,
            self.paths.fine_scan_dir / "clips",
        )

    def test_boundary_scan_dir_and_merged_file(self):
        self.assertEqual(
            self.paths.boundary_scan_dir,
            Path("seed_assets/analysis/macbook_neo/boundary_micro_scan"),
        )
        # The merged json sits inside the boundary dir so assemble_timeline
        # can find both via the same root.
        self.assertEqual(
            self.paths.boundary_scan_merged,
            self.paths.boundary_scan_dir / "boundary_micro_scan.json",
        )

    def test_timeline_under_stage1_5_assembly(self):
        self.assertEqual(
            self.paths.timeline,
            Path("seed_assets/analysis/macbook_neo/stage1_5_assembly/content_transition_timeline.json"),
        )

    def test_manifest_sits_at_analysis_root(self):
        self.assertEqual(
            self.paths.analysis_root,
            Path("seed_assets/analysis/macbook_neo"),
        )
        self.assertEqual(
            self.paths.manifest,
            self.paths.analysis_root / "analysis_manifest.json",
        )

    def test_debug_dumps_under_debug_subdir(self):
        debug = self.paths.analysis_root / "_debug"
        self.assertEqual(
            self.paths.rough_raw_response,
            debug / "rough_structure_scan_raw_response.json",
        )
        self.assertEqual(
            self.paths.rough_response_text,
            debug / "rough_structure_scan_response_text.txt",
        )
        self.assertEqual(
            self.paths.uploaded_file_info,
            debug / "uploaded_file_info.json",
        )


class VideoIdIsolationTests(unittest.TestCase):
    """Two distinct video_ids must not share any subpath."""

    def setUp(self):
        self.module = load_module()

    def test_different_video_ids_produce_disjoint_analysis_roots(self):
        a = self.module.analysis_paths("macbook_neo")
        b = self.module.analysis_paths("chocolate_mud_pie")
        self.assertNotEqual(a.analysis_root, b.analysis_root)
        # Every artifact under a's root must NOT be under b's root.
        for field_name in self.module.VideoPaths._fields:
            if field_name in {"raw_video", "preview_video"}:
                continue  # roots are independent (raw_videos/, processed_videos/)
            path_a = getattr(a, field_name)
            path_b = getattr(b, field_name)
            self.assertNotEqual(path_a, path_b, f"{field_name} collides")

    def test_video_id_is_embedded_in_every_analysis_path(self):
        paths = self.module.analysis_paths("custom_video_xyz")
        # Every analysis-tree field must contain the video_id as a directory.
        analysis_fields = (
            "rough_scan", "media_technical", "audio_beat_map", "audio_beat_wav",
            "speech_transcript", "fine_scan_dir", "fine_scan_clips_dir",
            "boundary_scan_dir", "boundary_scan_merged", "timeline",
            "analysis_root", "manifest", "rough_raw_response",
            "rough_response_text", "uploaded_file_info",
        )
        for field_name in analysis_fields:
            path = getattr(paths, field_name)
            self.assertIn("custom_video_xyz", str(path), f"{field_name} missing video_id")


class RootOverrideTests(unittest.TestCase):
    """Tests can override roots — e.g. to point at a tmp directory."""

    def setUp(self):
        self.module = load_module()

    def test_analysis_root_override_relocates_analysis_tree(self):
        custom_root = Path("custom_analysis")
        paths = self.module.analysis_paths(
            "macbook_neo",
            analysis_root=custom_root,
        )
        # Use pathlib comparison rather than string prefix to stay
        # platform-independent (Windows uses \, POSIX uses /).
        self.assertEqual(paths.analysis_root, custom_root / "macbook_neo")
        # raw_video unaffected — different root.
        self.assertEqual(
            paths.raw_video,
            Path("seed_assets/raw_videos/macbook_neo.mp4"),
        )

    def test_raw_videos_root_override_relocates_source_only(self):
        paths = self.module.analysis_paths(
            "macbook_neo",
            raw_videos_root=Path("custom_raw"),
        )
        self.assertEqual(paths.raw_video, Path("custom_raw/macbook_neo.mp4"))
        # analysis_root unaffected — different root.
        self.assertEqual(
            paths.analysis_root,
            Path("seed_assets/analysis/macbook_neo"),
        )

    def test_string_roots_are_accepted(self):
        # argparse hands us strings; the helper must not require Path() upfront.
        paths = self.module.analysis_paths(
            "macbook_neo",
            analysis_root="custom_a",
            raw_videos_root="custom_raw",
            processed_videos_root="custom_processed",
        )
        self.assertEqual(paths.analysis_root, Path("custom_a/macbook_neo"))
        self.assertEqual(paths.raw_video, Path("custom_raw/macbook_neo.mp4"))


if __name__ == "__main__":
    unittest.main()
