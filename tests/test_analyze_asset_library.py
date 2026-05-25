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

    def test_normalize_asset_card_filters_invalid_values_and_strips_nulls(self):
        card = self.module.normalize_asset_card(
            asset_id="asset_001",
            media_type="image",
            parsed={
                "spatialDescription": "产品居中，纯色背景，近景构图。",
                "temporalDescription": "图片不应保留时间描述",
                "detectedObjects": ["product", 123, "hand"],
                "suitableSlots": ["product_closeup", "made_up_slot"],
                "qualityScore": 1.4,
                "detectedIngredients": ["clean_background", "fake_ingredient"],
                "humanPresence": {
                    "hasHuman": True,
                    "role": "hand_only",
                    "framing": ["hands", "bad_frame"],
                    "actions": ["holding_product", "bad_action"],
                },
                "visualStyleTags": ["clean_background", "bad_style"],
            },
        )

        self.assertEqual(card["id"], "asset_001")
        self.assertEqual(card["type"], "image")
        self.assertNotIn("temporalDescription", card)
        self.assertEqual(card["detectedObjects"], ["product", "hand"])
        self.assertEqual(card["suitableSlots"], ["product_closeup"])
        self.assertEqual(card["qualityScore"], 1.0)
        self.assertEqual(card["detectedIngredients"], ["clean_background"])
        self.assertEqual(card["humanPresence"]["framing"], ["hands"])
        self.assertEqual(card["humanPresence"]["actions"], ["holding_product"])
        self.assertEqual(card["visualStyleTags"], ["clean_background"])
