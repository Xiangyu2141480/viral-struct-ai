"""Tests for scripts/extract_media_technical.py.

Pure-function tests only — does not invoke ffprobe (mocked at the boundary).
"""

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "extract_media_technical.py"


def load_module():
    spec = importlib.util.spec_from_file_location("extract_media_technical", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ReduceRatioTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_reduces_common_landscape_pixels(self):
        self.assertEqual(self.module.reduce_ratio(1920, 1080), (16, 9))

    def test_reduces_common_portrait_pixels(self):
        self.assertEqual(self.module.reduce_ratio(1080, 1920), (9, 16))

    def test_reduces_square(self):
        self.assertEqual(self.module.reduce_ratio(720, 720), (1, 1))

    def test_zero_dimensions_return_zero(self):
        self.assertEqual(self.module.reduce_ratio(0, 1080), (0, 0))
        self.assertEqual(self.module.reduce_ratio(1920, 0), (0, 0))


class ClassifyAspectRatioTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_classifies_horizontal_16_9(self):
        self.assertEqual(self.module.classify_aspect_ratio(1920, 1080), "16:9")

    def test_classifies_vertical_9_16(self):
        self.assertEqual(self.module.classify_aspect_ratio(1080, 1920), "9:16")

    def test_classifies_xiaohongshu_4_5(self):
        self.assertEqual(self.module.classify_aspect_ratio(1080, 1350), "4:5")

    def test_unknown_aspect_returns_unknown(self):
        self.assertEqual(self.module.classify_aspect_ratio(1234, 567), "unknown")


class ParseFrameRateTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_parses_ntsc_fraction(self):
        self.assertAlmostEqual(self.module.parse_frame_rate("30000/1001"), 29.97, places=2)

    def test_parses_integer_fraction(self):
        self.assertEqual(self.module.parse_frame_rate("30/1"), 30.0)

    def test_returns_zero_on_zero_denominator(self):
        self.assertEqual(self.module.parse_frame_rate("0/0"), 0.0)

    def test_returns_zero_on_none(self):
        self.assertEqual(self.module.parse_frame_rate(None), 0.0)

    def test_parses_plain_float_string(self):
        self.assertEqual(self.module.parse_frame_rate("25"), 25.0)


class SelectStreamTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_returns_first_matching_codec_type(self):
        streams = [
            {"codec_type": "audio", "codec_name": "aac"},
            {"codec_type": "video", "codec_name": "h264"},
        ]
        video = self.module.select_stream(streams, "video")
        assert video is not None
        self.assertEqual(video["codec_name"], "h264")

    def test_returns_none_when_codec_type_missing(self):
        self.assertIsNone(self.module.select_stream([], "video"))
        self.assertIsNone(
            self.module.select_stream([{"codec_type": "video", "codec_name": "h264"}], "audio")
        )


class BuildMediaTechnicalTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def _probe(self) -> dict:
        return {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1080,
                    "height": 1920,
                    "r_frame_rate": "30000/1001",
                    "duration": "222.5",
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                },
            ],
            "format": {"duration": "222.5"},
        }

    def test_builds_full_payload_from_probe(self):
        payload = self.module.build_media_technical(self._probe(), video_id="macbook_neo")

        self.assertEqual(payload["schemaVersion"], "media_technical_v1")
        self.assertEqual(payload["producedBy"], "ffprobe")
        self.assertEqual(payload["videoId"], "macbook_neo")
        self.assertEqual(payload["aspectRatio"], "9:16")
        self.assertEqual(payload["width"], 1080)
        self.assertEqual(payload["height"], 1920)
        self.assertEqual(payload["durationMs"], 222500)
        self.assertEqual(payload["videoCodec"], "h264")
        self.assertEqual(payload["audioCodec"], "aac")
        self.assertAlmostEqual(payload["fps"], 29.97, places=2)

    def test_falls_back_to_format_duration_when_stream_duration_missing(self):
        probe = self._probe()
        probe["streams"][0].pop("duration")
        payload = self.module.build_media_technical(probe, video_id="x")
        self.assertEqual(payload["durationMs"], 222500)

    def test_returns_null_audio_codec_when_no_audio_stream(self):
        probe = self._probe()
        probe["streams"] = [probe["streams"][0]]  # drop audio
        payload = self.module.build_media_technical(probe, video_id="x")
        self.assertIsNone(payload["audioCodec"])

    def test_raises_when_no_video_stream(self):
        probe = {"streams": [{"codec_type": "audio", "codec_name": "aac"}], "format": {}}
        with self.assertRaisesRegex(ValueError, "no video stream"):
            self.module.build_media_technical(probe, video_id="x")


if __name__ == "__main__":
    unittest.main()
