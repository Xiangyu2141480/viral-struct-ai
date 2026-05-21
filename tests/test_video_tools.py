import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "video_tools.py"


def load_video_tools():
    spec = importlib.util.spec_from_file_location("video_tools", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class VideoToolsCommandBuilderTests(unittest.TestCase):
    def setUp(self):
        self.tools = load_video_tools()

    def test_build_preview_command_lowers_fps_and_keeps_audio(self):
        command = self.tools.build_preview_command(
            "input.mp4",
            "preview.mp4",
            fps=5,
            max_width=720,
            audio="keep",
        )

        self.assertEqual(command[0], "ffmpeg")
        self.assertIn("-vf", command)
        self.assertIn("fps=5", command[command.index("-vf") + 1])
        self.assertIn("scale=w=min(720\\,iw):h=-2", command[command.index("-vf") + 1])
        self.assertIn("-c:a", command)
        self.assertIn("aac", command)
        self.assertEqual(command[-1], "preview.mp4")

    def test_build_clip_command_uses_accurate_reencode_by_default(self):
        command = self.tools.build_clip_command(
            "input.mp4",
            "clip.mp4",
            start=2.2,
            end=4.6,
            mode="accurate",
        )

        self.assertEqual(command[:3], ["ffmpeg", "-y", "-i"])
        self.assertIn("-ss", command)
        self.assertEqual(command[command.index("-ss") + 1], "2.200")
        self.assertIn("-t", command)
        self.assertEqual(command[command.index("-t") + 1], "2.400")
        self.assertIn("libx264", command)
        self.assertEqual(command[-1], "clip.mp4")

    def test_build_microscope_command_preserves_frames_at_playback_fps(self):
        command = self.tools.build_microscope_command(
            "input.mp4",
            "slow.mp4",
            start=3.0,
            end=3.8,
            playback_fps=5,
        )

        self.assertIn("-vf", command)
        self.assertIn("setpts=N/(5*TB)", command[command.index("-vf") + 1])
        self.assertIn("-an", command)
        self.assertEqual(command[-1], "slow.mp4")

    def test_build_inspection_pack_manifest_uses_boundary_context(self):
        pack = self.tools.build_inspection_pack(
            "input.mp4",
            out_dir="out",
            prefix="boundary_001",
            boundary=3.4,
            context_radius=1.2,
            microscope_radius=0.4,
            playback_fps=5,
        )

        self.assertEqual(pack["boundary"], 3.4)
        self.assertEqual(pack["realSpeedClip"]["sourceTimeRange"], {"start": 2.2, "end": 4.6})
        self.assertEqual(pack["slowMicroscopeClip"]["sourceTimeRange"], {"start": 3.0, "end": 3.8})
        self.assertTrue(pack["realSpeedClip"]["output"].endswith("boundary_001_real.mp4"))
        self.assertTrue(pack["slowMicroscopeClip"]["output"].endswith("boundary_001_slow.mp4"))


class VideoToolsCliTests(unittest.TestCase):
    def test_cli_help_exits_successfully(self):
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("preview", result.stdout)
        self.assertIn("inspection-pack", result.stdout)


if __name__ == "__main__":
    unittest.main()
