import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "analyze_asset_library.py"

sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("analyze_asset_library", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class AnalyzeAssetLibraryTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_build_payload_uses_image_modality_for_images(self):
        payload = self.module.build_responses_payload_for_asset(
            model="ep-test",
            file_id="file-img",
            media_type="image",
            prompt_text="classify",
            instructions="only json",
        )

        content = payload["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_image", "file_id": "file-img"})
        self.assertEqual(content[1], {"type": "input_text", "text": "classify"})
        self.assertEqual(payload["instructions"], "only json")
        self.assertEqual(payload["temperature"], 0.0)

    def test_build_payload_uses_video_modality_for_videos(self):
        payload = self.module.build_responses_payload_for_asset(
            model="ep-test",
            file_id="file-video",
            media_type="video",
            prompt_text="classify",
            instructions=None,
        )

        content = payload["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_video", "file_id": "file-video"})
        self.assertNotIn("instructions", payload)

    # The native-video rewrite split the old monolithic `normalize_asset_card` into focused pure helpers
    # (`_filter_enum_list` / `_str_list` / `_clamp01` / `_strip_none` / `_sanitize_human_presence`) composed
    # by `build_full_card`. These cover the same "drop invalid enums / clamp score / strip nulls / sanitize
    # human presence" behaviour the old single-function test asserted.

    def test_filter_enum_list_keeps_only_allowed_strings_and_dedupes(self):
        out = self.module._filter_enum_list(
            ["product_closeup", "made_up_slot", "product_closeup", 123],
            {"product_closeup", "usage_demo"},
        )
        self.assertEqual(out, ["product_closeup"])

    def test_str_list_drops_non_string_and_blank_values(self):
        self.assertEqual(self.module._str_list(["product", 123, " hand ", ""]), ["product", "hand"])

    def test_clamp01_clamps_out_of_range_and_falls_back_on_non_numbers(self):
        self.assertEqual(self.module._clamp01(1.4), 1.0)
        self.assertEqual(self.module._clamp01(-0.2), 0.0)
        self.assertEqual(self.module._clamp01("not a number", default=0.5), 0.5)

    def test_strip_none_removes_null_keys_recursively(self):
        self.assertEqual(
            self.module._strip_none({"a": 1, "b": None, "c": {"d": None, "e": 2}}),
            {"a": 1, "c": {"e": 2}},
        )

    def test_sanitize_human_presence_filters_invalid_framing_and_actions(self):
        out = self.module._sanitize_human_presence(
            {
                "hasHuman": True,
                "role": "hand_only",
                "framing": ["hands", "bad_frame"],
                "actions": ["holding_product", "bad_action"],
            }
        )
        self.assertEqual(out["hasHuman"], True)
        self.assertEqual(out["role"], "hand_only")
        self.assertEqual(out["framing"], ["hands"])
        self.assertEqual(out["actions"], ["holding_product"])
