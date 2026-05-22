import importlib.util
import json
import subprocess
import sys
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


class ClipStrategyTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def _seg(self, start, end):
        return {"approxTimeRange": {"start": start, "end": end}}

    def test_short_segment_uses_microscope(self):
        strategy = self.m.determine_clip_strategy(self._seg(0, 6))
        self.assertEqual(strategy["mode"], "microscope")
        self.assertEqual(strategy["upload_fps"], 5)
        self.assertIsNone(strategy["target_fps"])
        self.assertEqual(strategy["max_width"], 720)

    def test_boundary_8s_uses_microscope(self):
        strategy = self.m.determine_clip_strategy(self._seg(0, 8))
        self.assertEqual(strategy["mode"], "microscope")

    def test_medium_segment_uses_5fps_480p_preview(self):
        strategy = self.m.determine_clip_strategy(self._seg(9, 25))
        self.assertEqual(strategy["mode"], "preview")
        self.assertEqual(strategy["upload_fps"], 5)
        self.assertEqual(strategy["target_fps"], 5)
        self.assertEqual(strategy["max_width"], 480)

    def test_boundary_30s_uses_5fps_480p_preview(self):
        strategy = self.m.determine_clip_strategy(self._seg(0, 30))
        self.assertEqual(strategy["mode"], "preview")
        self.assertEqual(strategy["upload_fps"], 5)
        self.assertEqual(strategy["max_width"], 480)

    def test_long_segment_uses_5fps_preview(self):
        strategy = self.m.determine_clip_strategy(self._seg(0, 60))
        self.assertEqual(strategy["mode"], "preview")
        self.assertEqual(strategy["upload_fps"], 5)
        self.assertEqual(strategy["target_fps"], 5)
        self.assertEqual(strategy["max_width"], 360)


class MicroscopeCommandTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_uses_setpts_to_stretch_timestamps(self):
        cmd = self.m.build_segment_microscope_command(
            "input.mp4", "out.mp4", start=0.0, end=9.0, playback_fps=5
        )
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("setpts=N/(5*TB)", vf)

    def test_strips_audio(self):
        cmd = self.m.build_segment_microscope_command(
            "input.mp4", "out.mp4", start=0.0, end=9.0
        )
        self.assertIn("-an", cmd)

    def test_start_and_duration_are_correct(self):
        cmd = self.m.build_segment_microscope_command(
            "input.mp4", "out.mp4", start=2.5, end=7.5
        )
        self.assertEqual(cmd[cmd.index("-ss") + 1], "2.500")
        self.assertEqual(cmd[cmd.index("-t") + 1], "5.000")

    def test_scale_filter_is_applied(self):
        cmd = self.m.build_segment_microscope_command(
            "input.mp4", "out.mp4", start=0.0, end=5.0, max_width=720
        )
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("scale=w=min(720\\,iw):h=-2", vf)

    def test_output_path_is_last_arg(self):
        cmd = self.m.build_segment_microscope_command(
            "input.mp4", "slow.mp4", start=0.0, end=5.0
        )
        self.assertEqual(cmd[-1], "slow.mp4")


class PreviewCommandTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_uses_fps_filter(self):
        cmd = self.m.build_segment_preview_command(
            "input.mp4", "out.mp4", start=9.0, end=25.0, fps=15, max_width=480
        )
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("fps=15", vf)
        self.assertIn("scale=w=min(480\\,iw):h=-2", vf)

    def test_start_and_duration_are_correct(self):
        cmd = self.m.build_segment_preview_command(
            "input.mp4", "out.mp4", start=10.0, end=30.0, fps=15
        )
        self.assertEqual(cmd[cmd.index("-ss") + 1], "10.000")
        self.assertEqual(cmd[cmd.index("-t") + 1], "20.000")

    def test_strips_audio(self):
        cmd = self.m.build_segment_preview_command(
            "input.mp4", "out.mp4", start=0.0, end=20.0, fps=5
        )
        self.assertIn("-an", cmd)

    def test_output_path_is_last_arg(self):
        cmd = self.m.build_segment_preview_command(
            "input.mp4", "preview.mp4", start=0.0, end=10.0, fps=15
        )
        self.assertEqual(cmd[-1], "preview.mp4")


class PromptVariableTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()
        self.segment = {
            "id": "rough_seg_001",
            "approxTimeRange": {"start": 0, "end": 9},
            "possibleRole": "hook",
            "purpose": "开场抓住注意力",
            "whatHappens": "变色魔术",
            "inspectionQuestions": ["节奏是否对齐？"],
        }

    def test_basic_fields_are_mapped(self):
        strategy = {"mode": "microscope", "upload_fps": 5, "target_fps": None, "max_width": 720}
        v = self.m.build_segment_prompt_variables(self.segment, strategy, None, "macbook_neo")
        self.assertEqual(v["segmentId"], "rough_seg_001")
        self.assertEqual(v["videoId"], "macbook_neo")
        self.assertEqual(v["sourceStart"], 0.0)
        self.assertEqual(v["sourceEnd"], 9.0)
        self.assertEqual(v["segmentDuration"], 9.0)
        self.assertEqual(v["clipMode"], "microscope_slowdown")
        self.assertEqual(v["uploadFps"], 5)
        self.assertEqual(v["clipWidth"], 720)
        self.assertEqual(v["segmentRole"], "hook")

    def test_audio_unavailable_text_when_none(self):
        strategy = {"mode": "microscope", "upload_fps": 5, "target_fps": None, "max_width": 720}
        v = self.m.build_segment_prompt_variables(self.segment, strategy, None, "vid")
        self.assertIn("unavailable", v["audioAnalysis"])

    def test_audio_json_included_when_present(self):
        strategy = {"mode": "preview", "upload_fps": 15, "target_fps": 15, "max_width": 480}
        audio = {"source": "librosa", "bpm": 128.0, "beatTimestamps": [0.5, 1.0, 1.5]}
        v = self.m.build_segment_prompt_variables(self.segment, strategy, audio, "vid")
        parsed = json.loads(v["audioAnalysis"])
        self.assertEqual(parsed["bpm"], 128.0)
        self.assertEqual(len(parsed["beatTimestamps"]), 3)

    def test_preview_clip_mode_label(self):
        strategy = {"mode": "preview", "upload_fps": 15, "target_fps": 15, "max_width": 480}
        v = self.m.build_segment_prompt_variables(self.segment, strategy, None, "vid")
        self.assertEqual(v["clipMode"], "segment_preview_15fps")

    def test_inspection_questions_are_json_string(self):
        strategy = {"mode": "microscope", "upload_fps": 5, "target_fps": None, "max_width": 720}
        v = self.m.build_segment_prompt_variables(self.segment, strategy, None, "vid")
        parsed = json.loads(v["inspectionQuestions"])
        self.assertIsInstance(parsed, list)
        self.assertEqual(parsed[0], "节奏是否对齐？")


class ApiHelperTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_extract_response_text_output_text(self):
        self.assertEqual(
            self.m.extract_response_text({"output_text": '{"ok": true}'}),
            '{"ok": true}',
        )

    def test_extract_response_text_nested_content(self):
        nested = {
            "output": [{"content": [{"type": "output_text", "text": '{"segmentId":"rough_seg_001"}'}]}]
        }
        self.assertEqual(
            self.m.extract_response_text(nested),
            '{"segmentId":"rough_seg_001"}',
        )

    def test_extract_json_object_strips_markdown_fence(self):
        text = '```json\n{"segmentId": "rough_seg_001"}\n```'
        parsed = self.m.extract_json_object(text)
        self.assertEqual(parsed["segmentId"], "rough_seg_001")

    def test_extract_json_object_plain_json(self):
        parsed = self.m.extract_json_object('{"bpm": 128.0}')
        self.assertEqual(parsed["bpm"], 128.0)

    def test_build_responses_payload_structure(self):
        payload = self.m.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
        )
        self.assertEqual(payload["model"], "ep-test")
        content = payload["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_video", "file_id": "file-abc"})
        self.assertEqual(content[1]["type"], "input_text")

    def test_build_multipart_body_contains_fps_field(self):
        body, content_type = self.m.build_multipart_body(
            fields={"purpose": "user_data", "preprocess_configs[video][fps]": "5"},
            files={"file": ("seg.mp4", b"data", "video/mp4")},
            boundary="test-boundary",
        )
        decoded = body.decode("utf-8")
        self.assertIn("preprocess_configs[video][fps]", decoded)
        self.assertIn("test-boundary", content_type)
        self.assertIn('filename="seg.mp4"', decoded)


class CliTests(unittest.TestCase):
    def test_help_exits_successfully(self):
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("rough-scan", result.stdout)
        self.assertIn("segment-ids", result.stdout)
        self.assertIn("skip-audio", result.stdout)


if __name__ == "__main__":
    unittest.main()
