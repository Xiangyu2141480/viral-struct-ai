"""Unit tests for the ffmpeg hard-cut detector (parsing + command shape)."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location(
        "shot_cut_detector", ROOT / "scripts" / "shot_cut_detector.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ParseShowinfoTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_parses_and_sorts_pts_times(self):
        stderr = (
            "[Parsed_showinfo_1 @ 0x] n:0 pts:124416 pts_time:10.125 ...\n"
            "[Parsed_showinfo_1 @ 0x] n:1 pts:244736 pts_time:19.916667 ...\n"
            "[Parsed_showinfo_1 @ 0x] n:2 pts:0 pts_time:2.5 ...\n"
        )
        self.assertEqual(self.m.parse_showinfo_pts(stderr), [2.5, 10.125, 19.916667])

    def test_empty_stderr_returns_empty(self):
        self.assertEqual(self.m.parse_showinfo_pts(""), [])
        self.assertEqual(self.m.parse_showinfo_pts(None), [])

    def test_command_shape_and_threshold_guard(self):
        cmd = self.m.build_scene_detect_command("v.mp4", 0.3)
        self.assertIn("select='gt(scene,0.3)',showinfo", cmd)
        self.assertIn("-i", cmd)
        self.assertEqual(cmd[-1], "-")
        for bad in (0.0, 1.0, 1.5, -0.2):
            with self.assertRaises(ValueError):
                self.m.build_scene_detect_command("v.mp4", bad)


if __name__ == "__main__":
    unittest.main()
