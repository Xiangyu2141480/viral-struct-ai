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

    def test_build_peak_window_command_uses_default_pre_post_around_peak(self):
        command = self.tools.build_peak_window_command(
            "input.mp4",
            "peak.mp4",
            block_start=0.0,
            block_end=9.5,
            peak_time=5.7,
        )

        self.assertEqual(command[command.index("-ss") + 1], "5.100")
        self.assertEqual(command[command.index("-t") + 1], "1.400")
        self.assertIn("-c", command)
        self.assertEqual(command[command.index("-c") + 1], "copy")
        self.assertEqual(command[-1], "peak.mp4")

    def test_build_peak_window_command_clamps_to_block_start(self):
        command = self.tools.build_peak_window_command(
            "input.mp4",
            "peak.mp4",
            block_start=10.0,
            block_end=20.0,
            peak_time=10.2,
            pre_context=0.6,
            post_context=0.8,
        )

        self.assertEqual(command[command.index("-ss") + 1], "10.000")
        self.assertEqual(command[command.index("-t") + 1], "1.000")

    def test_build_peak_window_command_clamps_to_block_end(self):
        command = self.tools.build_peak_window_command(
            "input.mp4",
            "peak.mp4",
            block_start=0.0,
            block_end=9.5,
            peak_time=9.3,
            pre_context=0.6,
            post_context=0.8,
        )

        self.assertEqual(command[command.index("-ss") + 1], "8.700")
        self.assertEqual(command[command.index("-t") + 1], "0.800")

    def test_build_peak_window_command_rejects_peak_outside_block(self):
        with self.assertRaises(ValueError):
            self.tools.build_peak_window_command(
                "input.mp4",
                "peak.mp4",
                block_start=10.0,
                block_end=20.0,
                peak_time=25.0,
            )

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

    def test_build_microscope_command_limits_source_window_before_slowing(self):
        command = self.tools.build_microscope_command(
            "input.mp4",
            "slow.mp4",
            start=24.0,
            end=29.0,
            playback_fps=5,
        )

        input_index = command.index("-i")
        self.assertLess(command.index("-ss"), input_index)
        self.assertLess(command.index("-t"), input_index)
        self.assertEqual(command[command.index("-ss") + 1], "24.000")
        self.assertEqual(command[command.index("-t") + 1], "5.000")

    def test_build_extract_audio_command_outputs_wav_for_beat_tracking(self):
        command = self.tools.build_extract_audio_command(
            "input.mp4",
            "audio.wav",
            sample_rate=44100,
            channels=1,
        )

        self.assertEqual(command[:3], ["ffmpeg", "-y", "-i"])
        self.assertIn("-vn", command)
        self.assertIn("-ac", command)
        self.assertEqual(command[command.index("-ac") + 1], "1")
        self.assertIn("-ar", command)
        self.assertEqual(command[command.index("-ar") + 1], "44100")
        self.assertIn("pcm_s16le", command)
        self.assertEqual(command[-1], "audio.wav")

    def test_build_beat_this_command_uses_cli_output_path(self):
        command = self.tools.build_beat_this_command(
            "audio.wav",
            "audio.beats",
            beat_this_bin="beat_this",
            gpu=-1,
        )

        self.assertEqual(command[:2], ["beat_this", "audio.wav"])
        self.assertIn("-o", command)
        self.assertEqual(command[command.index("-o") + 1], "audio.beats")
        self.assertIn("--gpu", command)
        self.assertEqual(command[command.index("--gpu") + 1], "-1")

    def test_parse_beat_this_file_marks_downbeats(self):
        beats_path = ROOT / "tests" / "tmp_sample.beats"
        beats_path.write_text("0.50\t1\n1.00\t2\n1.50\t3\n2.00\t1\n", encoding="utf-8")
        try:
            beats = self.tools.parse_beat_this_file(beats_path)
        finally:
            beats_path.unlink()

        self.assertEqual(len(beats), 4)
        self.assertEqual(beats[0]["time"], 0.5)
        self.assertTrue(beats[0]["isDownbeat"])
        self.assertFalse(beats[1]["isDownbeat"])
        self.assertEqual(beats[1]["beatNumber"], 2)

    def test_build_audio_beat_map_computes_tempo_and_downbeats(self):
        beats = [
            {"time": 0.5, "beatNumber": 1, "isDownbeat": True},
            {"time": 1.0, "beatNumber": 2, "isDownbeat": False},
            {"time": 1.5, "beatNumber": 3, "isDownbeat": False},
            {"time": 2.0, "beatNumber": 1, "isDownbeat": True},
        ]

        beat_map = self.tools.build_audio_beat_map(
            video_id="demo",
            audio_source="audio.wav",
            beats=beats,
            method="beat_this",
        )

        self.assertEqual(beat_map["videoId"], "demo")
        self.assertEqual(beat_map["method"]["primary"], "beat_this")
        self.assertEqual(beat_map["tempo"]["bpm"], 120.0)
        self.assertEqual(len(beat_map["beats"]), 4)
        self.assertEqual(len(beat_map["downbeats"]), 2)


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
        self.assertIn("extract-audio", result.stdout)
        self.assertIn("beat-map", result.stdout)


if __name__ == "__main__":
    unittest.main()
