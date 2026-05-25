import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "extract_structure_graph.py"

sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("extract_structure_graph", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class BuildStructureGraphTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_load_json_accepts_utf8_bom(self):
        with self.subTest("Windows PowerShell UTF8 files may include a BOM"):
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "bom_fixture.json"
                path.write_text('{"ok": true}', encoding="utf-8-sig")

                loaded = self.module._load_json(path)

        self.assertEqual(loaded, {"ok": True})

    def test_builds_graph_from_current_fine_scan_v03_contract(self):
        rough_doc = {
            "roughSummary": {
                "likelyVideoType": "product ad",
                "oneSentenceStructure": "开场亮相产品，随后演示使用场景。",
                "globalConversionLogic": "用高级质感和真实演示推动转化。",
            },
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 6},
                    "coarseRoleGuess": "attention_grab",
                    "observableSummary": "双手举起产品并完成亮相",
                    "visualSignals": ["干净背景", "手部演示"],
                },
                {
                    "id": "block_002",
                    "timeRange": {"start": 6, "end": 12},
                    "coarseRoleGuess": "demo_or_usage",
                    "observableSummary": "产品在桌面上完成使用演示",
                    "visualSignals": ["产品近景", "柔和光线"],
                },
            ],
        }
        fine_doc = {
            "videoId": "demo",
            "scanMode": "fine_scan_v03",
            "contentBlocks": [
                {
                    "schemaVersion": "fine_content_block_semantic_v0_3",
                    "blockId": "block_001",
                    "videoId": "demo",
                    "sourceTimeRangeMs": {"start": 0, "end": 6000},
                    "roleConfirmation": {
                        "role": "product_reveal",
                        "confidence": 0.92,
                        "coarseRoleWas": "attention_grab",
                        "correctionFromCoarse": False,
                    },
                    "textOverlayBehavior": {
                        "textElements": [
                            {
                                "type": "main_title",
                                "content": "新品亮相",
                                "positionGrid": 5,
                                "animationIn": "pop",
                                "animationOut": "fade",
                                "relativePositionBucket": "early",
                            }
                        ]
                    },
                    "productPresentation": {
                        "revealMode": "hands_presenting",
                        "salesPointOrdering": "feature_first",
                    },
                    "transitionOut": {
                        "type": "beat_cut",
                        "outgoingSubjectAnchor": 5,
                        "incomingHintForNextBlock": "beat_hit",
                    },
                    "requiredAssetType": [
                        {
                            "assetType": "hand_demo",
                            "purpose": "product_reveal",
                            "criticality": "must",
                        }
                    ],
                    "inspectionAnswers": [
                        {
                            "question": "如何亮相？",
                            "answer": "开头由手部快速托出产品。",
                            "confidence": 0.8,
                        }
                    ],
                    "claimVisualizationPattern": {
                        "pattern": "none",
                        "relativePositionBucket": "unknown",
                    },
                    "dominantTone": "aspirational",
                    "transferableMotifs": [
                        {
                            "motifType": "product_handling",
                            "description": "手部快速托出产品制造开场亮相",
                            "relativePositionBucket": "early",
                            "transferability": "category_specific",
                        }
                    ],
                    "actionBeats": [
                        {
                            "beatId": "beat_001",
                            "semanticAction": "托出产品",
                            "actionType": "entry",
                            "anchorMs": 500,
                            "timeRangeMs": {"start": 0, "end": 1200},
                            "anchorConfidence": 0.9,
                        }
                    ],
                },
                {
                    "schemaVersion": "fine_content_block_semantic_v0_3",
                    "blockId": "block_002",
                    "videoId": "demo",
                    "sourceTimeRangeMs": {"start": 6000, "end": 12000},
                    "roleConfirmation": {
                        "role": "usage_scene",
                        "confidence": 0.88,
                        "coarseRoleWas": "demo_or_usage",
                        "correctionFromCoarse": False,
                    },
                    "textOverlayBehavior": {"textElements": []},
                    "productPresentation": {
                        "revealMode": "direct_show",
                        "salesPointOrdering": "benefit_first",
                    },
                    "transitionOut": {
                        "type": "match_cut",
                        "outgoingSubjectAnchor": 5,
                        "incomingHintForNextBlock": "product_exit",
                    },
                    "requiredAssetType": [
                        {
                            "assetType": "product_video",
                            "purpose": "feature_demo",
                            "criticality": "must",
                        }
                    ],
                    "inspectionAnswers": [],
                    "claimVisualizationPattern": {
                        "pattern": "usage_demo",
                        "relativePositionBucket": "mid",
                    },
                    "dominantTone": "calm",
                    "transferableMotifs": [],
                    "actionBeats": [
                        {
                            "beatId": "beat_001",
                            "semanticAction": "产品开始运行",
                            "actionType": "usage",
                            "anchorMs": 7200,
                            "timeRangeMs": {"start": 6500, "end": 8500},
                            "anchorConfidence": 0.8,
                        }
                    ],
                },
            ],
        }

        graph = self.module.build_structure_graph(rough_doc, fine_doc, aspect_ratio="9:16")

        self.assertEqual(graph["segments"][0]["role"], "hook")
        self.assertEqual(graph["segments"][0]["start"], 0.0)
        self.assertEqual(graph["segments"][0]["end"], 6.0)
        self.assertEqual(graph["segments"][0]["duration"], 6.0)
        self.assertEqual(graph["segments"][0]["caption"], "新品亮相")
        self.assertEqual(graph["segments"][1]["role"], "usage")
        self.assertEqual(graph["segments"][1]["start"], 6.0)
        self.assertEqual(graph["segments"][1]["end"], 12.0)

        self.assertEqual(graph["rhythm"]["avgShotDuration"], 1.6)
        self.assertEqual(graph["rhythm"]["cutFrequency"], "high")
        self.assertEqual(graph["rhythm"]["peakAt"], 0.5)

        self.assertEqual(graph["packaging"]["captionDensity"], "medium")
        self.assertEqual(graph["packaging"]["transitions"], ["beat_cut", "match_cut"])

        first_slot = graph["shotSlots"][0]
        self.assertEqual(first_slot["role"], "opening_attention")
        self.assertTrue(first_slot["humanRequirement"]["required"])
        self.assertIn("hand_demo", first_slot["visualIngredientRequirements"])

        second_slot = graph["shotSlots"][1]
        self.assertEqual(second_slot["role"], "usage_demo")
        self.assertEqual(second_slot["requiredAsset"]["type"], "video")
        self.assertEqual(second_slot["humanRequirement"]["required"], False)
        self.assertIn("product_closeup_trait", second_slot["visualIngredientRequirements"])

    def test_rough_only_fallback_does_not_force_hand_demo_requirement(self):
        rough_doc = {
            "roughSummary": {"oneSentenceStructure": "单镜头产品展示。"},
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 4},
                    "coarseRoleGuess": "feature_or_claim",
                    "observableSummary": "产品本体在纯色背景下旋转展示",
                    "visualSignals": ["产品近景", "纯色背景"],
                }
            ],
        }

        graph = self.module.build_structure_graph(rough_doc, None, aspect_ratio="1:1")

        self.assertEqual(graph["segments"][0]["start"], 0.0)
        self.assertEqual(graph["segments"][0]["end"], 4.0)
        self.assertEqual(graph["segments"][0]["duration"], 4.0)
        self.assertEqual(graph["shotSlots"][0]["humanRequirement"]["required"], False)
        self.assertNotIn("hand_demo", graph["shotSlots"][0]["visualIngredientRequirements"])

    def test_text_card_slot_does_not_require_product_visual_ingredient(self):
        rough_doc = {
            "roughSummary": {"oneSentenceStructure": "结尾 CTA 收束。"},
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 10, "end": 13},
                    "coarseRoleGuess": "closing_or_cta",
                    "observableSummary": "画面出现产品价格和行动号召文字卡",
                    "visualSignals": ["产品价格"],
                }
            ],
        }
        fine_doc = {
            "contentBlocks": [
                {
                    "blockId": "block_001",
                    "sourceTimeRangeMs": {"start": 10000, "end": 13000},
                    "roleConfirmation": {"role": "cta"},
                    "textOverlayBehavior": {"textElements": [{"content": "立即下单"}]},
                    "transitionOut": {"type": "hard_cut"},
                    "requiredAssetType": [
                        {"assetType": "text_card", "purpose": "cta", "criticality": "must"}
                    ],
                    "actionBeats": [],
                }
            ]
        }

        graph = self.module.build_structure_graph(rough_doc, fine_doc, aspect_ratio="9:16")

        slot = graph["shotSlots"][0]
        self.assertEqual(slot["requiredAsset"]["type"], "text")
        self.assertEqual(slot["role"], "cta_visual")
        self.assertEqual(slot["visualIngredientRequirements"], [])
