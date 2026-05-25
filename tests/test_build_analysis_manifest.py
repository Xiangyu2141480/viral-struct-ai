"""Tests for scripts/build_analysis_manifest.py."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "build_analysis_manifest.py"

sys.path.insert(0, str(ROOT / "scripts"))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_PATHS = analysis_paths(DEFAULT_VIDEO_ID)


def load_module():
    spec = importlib.util.spec_from_file_location("build_analysis_manifest", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ReadSchemaVersionTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)

    def test_returns_schema_version_when_present(self):
        f = self.tmp_path / "x.json"
        f.write_text(json.dumps({"schemaVersion": "rough_content_blocks_v1"}), encoding="utf-8")
        self.assertEqual(self.module.read_schema_version(f), "rough_content_blocks_v1")

    def test_returns_none_for_missing_file(self):
        self.assertIsNone(self.module.read_schema_version(self.tmp_path / "missing.json"))

    def test_returns_none_for_malformed_json(self):
        f = self.tmp_path / "broken.json"
        f.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.module.read_schema_version(f))

    def test_returns_none_for_non_dict_payload(self):
        f = self.tmp_path / "list.json"
        f.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
        self.assertIsNone(self.module.read_schema_version(f))

    def test_returns_none_when_schema_version_field_missing(self):
        f = self.tmp_path / "no_version.json"
        f.write_text(json.dumps({"data": "x"}), encoding="utf-8")
        self.assertIsNone(self.module.read_schema_version(f))


class FileMtimeIsoTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)

    def test_returns_iso_string_for_existing_file(self):
        f = self.tmp_path / "x.json"
        f.write_text("{}", encoding="utf-8")
        result = self.module.file_mtime_iso(f)
        assert result is not None
        # ISO 8601 with seconds precision; example: 2026-05-23T09:30:00+00:00
        self.assertRegex(result, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$")

    def test_returns_none_for_missing_file(self):
        self.assertIsNone(self.module.file_mtime_iso(self.tmp_path / "missing.json"))


class BuildManifestTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.analysis_root = Path(self.tmp.name)

        # Lay out a minimal v2 structure with two artifacts present, two missing.
        rough_dir = self.analysis_root / "stage1_rough"
        rough_dir.mkdir()
        (rough_dir / "rough_structure_scan.json").write_text(
            json.dumps({"schemaVersion": "rough_content_blocks_v1"}), encoding="utf-8"
        )
        media_dir = self.analysis_root / "stage1_media"
        media_dir.mkdir()
        (media_dir / "media_technical.json").write_text(
            json.dumps({"schemaVersion": "media_technical_v1"}), encoding="utf-8"
        )
        # audio_beat_map.json and content_transition_timeline.json deliberately absent

    def test_manifest_has_required_top_level_fields(self):
        manifest = self.module.build_manifest(
            video_id="demo",
            analysis_root=self.analysis_root,
            video_category="3c",
        )
        self.assertEqual(manifest["schemaVersion"], "analysis_manifest_v1")
        self.assertEqual(manifest["videoId"], "demo")
        self.assertEqual(manifest["videoCategory"], "3c")
        self.assertIn("generatedAt", manifest)
        self.assertIn("artifacts", manifest)

    def test_manifest_marks_present_artifacts_with_schema_version(self):
        manifest = self.module.build_manifest(
            video_id="demo", analysis_root=self.analysis_root,
        )
        rough = manifest["artifacts"]["rough"]
        self.assertTrue(rough["exists"])
        self.assertEqual(rough["schemaVersion"], "rough_content_blocks_v1")
        self.assertEqual(rough["path"], "stage1_rough/rough_structure_scan.json")
        self.assertIsNotNone(rough["lastModified"])

        media = manifest["artifacts"]["media"]
        self.assertTrue(media["exists"])
        self.assertEqual(media["schemaVersion"], "media_technical_v1")

    def test_manifest_marks_missing_artifacts_as_absent(self):
        manifest = self.module.build_manifest(
            video_id="demo", analysis_root=self.analysis_root,
        )
        audio = manifest["artifacts"]["audio"]
        self.assertFalse(audio["exists"])
        self.assertIsNone(audio["schemaVersion"])
        self.assertIsNone(audio["lastModified"])
        self.assertEqual(audio["path"], "stage1_media/audio_beat_map.json")

        timeline = manifest["artifacts"]["timeline"]
        self.assertFalse(timeline["exists"])

    def test_manifest_enumerates_all_canonical_artifacts(self):
        manifest = self.module.build_manifest(
            video_id="demo", analysis_root=self.analysis_root,
        )
        self.assertEqual(
            set(manifest["artifacts"].keys()),
            {"rough", "media", "audio", "speech", "timeline"},
        )

    def test_default_video_category_is_unknown(self):
        manifest = self.module.build_manifest(
            video_id="demo", analysis_root=self.analysis_root,
        )
        self.assertEqual(manifest["videoCategory"], "unknown")


class CliDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_parser_defaults_point_to_macbook_neo_root(self):
        args = self.module.build_parser().parse_args([])
        self.assertEqual(args.analysis_root, str(_PATHS.analysis_root))
        self.assertEqual(args.video_id, DEFAULT_VIDEO_ID)
        self.assertEqual(args.video_category, "unknown")
        self.assertIsNone(args.out)


if __name__ == "__main__":
    unittest.main()
