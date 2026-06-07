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


class GenreAwareCourseTests(unittest.TestCase):
    """A tutorial/course video must NOT be force-fit into the ad ontology.

    RCA finding (DS-02): the extractor computed ``videoType`` last and never
    branched on it, so a course video got ``selling_point``/``product_closeup``
    roles, product-substitution ``transferRule``s, and a fabricated
    ``product_closeup_trait`` ingredient carrying the literally-false evidence
    "全片以产品本体为核心呈现". These tests pin genre-aware dispatch.
    """

    def setUp(self):
        self.module = load_module()

    def _course_rough_doc(self) -> dict:
        return {
            "roughSummary": {
                "likelyVideoType": "tutorial",
                "detectedCategory": "course",
                "oneSentenceStructure": "讲解如何把打斗剪辑做得更燃更有节奏。",
            },
            "contentBlocks": [
                {"id": "block_001", "timeRange": {"start": 0, "end": 10},
                 "coarseRoleGuess": "attention_grab",
                 "observableSummary": "炫酷打斗开场并抛出教学主题",
                 "visualSignals": ["黑底文字", "特效"]},
                {"id": "block_002", "timeRange": {"start": 10, "end": 20},
                 "coarseRoleGuess": "feature_or_claim",
                 "observableSummary": "讲解镜头切换与卡点要点",
                 "visualSignals": ["黑底标题"]},
                {"id": "block_003", "timeRange": {"start": 20, "end": 30},
                 "coarseRoleGuess": "demo_or_usage",
                 "observableSummary": "示范打斗片段如何卡点",
                 "visualSignals": ["打斗示例片段"]},
                {"id": "block_004", "timeRange": {"start": 30, "end": 40},
                 "coarseRoleGuess": "closing_or_cta",
                 "observableSummary": "鼓励多练习并关注作者",
                 "visualSignals": ["关注引导"]},
            ],
        }

    def test_course_video_type_detected(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        self.assertEqual(graph["meta"]["videoType"], "course")

    def test_course_detected_from_category_when_likely_type_blank(self):
        """Regression guard: genre must survive a blank likelyVideoType as long
        as detectedCategory identifies the course — otherwise the whole genre
        dispatch silently degrades back to the ad ontology."""
        doc = self._course_rough_doc()
        doc["roughSummary"]["likelyVideoType"] = ""
        doc["roughSummary"]["detectedCategory"] = "course"
        graph = self.module.build_structure_graph(doc, None)
        self.assertEqual(graph["meta"]["videoType"], "course")
        self.assertNotIn("selling_point", [s["role"] for s in graph["segments"]])

    def test_course_segments_use_instructional_roles_not_ad_roles(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        roles = [s["role"] for s in graph["segments"]]
        self.assertEqual(roles[0], "hook")
        self.assertEqual(roles[-1], "cta")
        self.assertEqual(roles[1], "explanation")
        self.assertEqual(roles[2], "demonstration")
        self.assertNotIn("selling_point", roles)
        self.assertNotIn("usage", roles)

    def test_course_slots_are_not_product_closeup(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        slot_roles = [s["role"] for s in graph["shotSlots"]]
        self.assertNotIn("product_closeup", slot_roles)
        self.assertIn("instruction_card", slot_roles)

    def test_course_transfer_rule_is_technique_reuse_not_product_swap(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        explanation = next(s for s in graph["segments"] if s["role"] == "explanation")
        self.assertNotIn("商品", explanation["transferRule"])
        self.assertNotIn("产品", explanation["transferRule"])

    def test_course_does_not_fabricate_product_ingredient(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        types = [ing["type"] for ing in graph["creativeIngredients"]]
        self.assertNotIn("product_closeup_trait", types)
        for ing in graph["creativeIngredients"]:
            for ev in ing.get("evidence", []):
                self.assertNotEqual(ev.get("value"), "全片以产品本体为核心呈现")

    def test_course_cover_style_is_not_product_centered(self):
        graph = self.module.build_structure_graph(self._course_rough_doc(), None)
        self.assertNotEqual(
            graph["packaging"]["coverStyle"], "product_centered_clean_background"
        )

    def test_ecommerce_default_is_unchanged(self):
        """Regression guard: an ad video still maps to the ad ontology."""
        rough_doc = {
            "roughSummary": {"likelyVideoType": "product ad",
                             "oneSentenceStructure": "产品亮相并演示卖点。"},
            "contentBlocks": [
                {"id": "block_001", "timeRange": {"start": 0, "end": 5},
                 "coarseRoleGuess": "feature_or_claim",
                 "observableSummary": "产品近景展示卖点",
                 "visualSignals": ["产品近景"]},
            ],
        }
        graph = self.module.build_structure_graph(rough_doc, None)
        self.assertEqual(graph["meta"]["videoType"], "ecommerce")
        self.assertEqual(graph["segments"][0]["role"], "hook")
        self.assertEqual(
            graph["packaging"]["coverStyle"], "product_centered_clean_background"
        )


class BuildBoundariesTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def _make_boundary_doc(self, count: int) -> dict:
        boundaries = []
        for i in range(count):
            boundaries.append({
                "boundaryId": f"boundary_{i+1:03d}",
                "transitionCandidate": {
                    "exists": True,
                    "techniqueTags": ["object_morph"],
                    "confidence": 0.95,
                    "visualChange": f"transition {i+1} description"
                },
                "microShots": [
                    {"id": f"ms_{i+1}_1", "microscopeTimeRange": {"start": 0.0, "end": 0.2}, "visualChange": "before"},
                    {"id": f"ms_{i+1}_2", "microscopeTimeRange": {"start": 0.2, "end": 0.3}, "visualChange": "peak"}
                ]
            })
        return {"videoId": "test", "boundaries": boundaries}

    def _make_rough_blocks(self, count: int) -> list:
        return [{"id": f"block_{i+1:03d}", "timeRange": {"start": i*10, "end": (i+1)*10}}
                for i in range(count)]

    def test_build_boundaries_with_full_doc(self):
        rough_blocks = self._make_rough_blocks(4)         # 4 blocks → 3 boundaries
        boundary_doc = self._make_boundary_doc(3)
        result = self.module._build_boundaries(rough_blocks, boundary_doc)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["id"], "boundary_001")
        self.assertEqual(result[0]["from"], "seg_block_001")
        self.assertEqual(result[0]["to"], "seg_block_002")
        self.assertEqual(result[0]["transitionType"], "morph")
        self.assertEqual(result[0]["intensity"], "strong")
        self.assertNotIn("alignedToBeat", result[0])
        self.assertEqual(len(result[0]["microShots"]), 2)
        self.assertEqual(result[0]["microShots"][0]["role"], "pre_transition")
        self.assertEqual(result[0]["microShots"][1]["role"], "post_transition")
        self.assertEqual(result[0]["microShots"][0]["durationMs"], 200.0)
        self.assertEqual(result[0]["microShots"][1]["durationMs"], 100.0)

    def test_build_boundaries_returns_none_when_doc_absent(self):
        rough_blocks = self._make_rough_blocks(4)
        result = self.module._build_boundaries(rough_blocks, None)
        self.assertIsNone(result)

    def test_build_boundaries_skips_missing_boundary_ids(self):
        rough_blocks = self._make_rough_blocks(4)                    # 4 blocks → expect 3 boundaries
        boundary_doc = self._make_boundary_doc(3)
        boundary_doc["boundaries"].pop(1)                            # delete boundary_002 input
        result = self.module._build_boundaries(rough_blocks, boundary_doc)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 2)                             # 001 and 003 only
        ids = [b["id"] for b in result]
        self.assertEqual(ids, ["boundary_001", "boundary_003"])


class ExtractMigrationContractTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def _valid_contract(self) -> dict:
        return {
            "intent": {
                "purpose": "1.5s 内制造高强度视觉冲击",
                "energyLevel": "high",
                "motionPattern": "centripetal_impact_or_dynamic_entry",
                "compositionPrincipal": "single_subject_center_with_dynamic_negative_space",
                "durationMs": [800, 2000],
                "soundDesignHint": "transient_attack_aligned_with_visual_peak"
            },
            "sourceInstance": {
                "productInSource": "MacBook 银色机身",
                "specificAction": "双手左右托举旋转",
                "colorSignature": "silver_yellow_gradient"
            },
            "acceptanceCriteria": {
                "anyOf": [
                    {"motionType": "fluid_dynamics", "examples": ["液体飞溅", "颗粒爆炸"]},
                    {"motionType": "object_kinetic", "compositionType": "left_right_symmetry", "examples": ["物体快速入画"]}
                ],
                "rejectIf": ["低动感纯静物图"]
            }
        }

    def test_returns_three_keys_when_contract_well_formed(self):
        fine_block = {"migrationContract": self._valid_contract()}
        result = self.module._extract_migration_contract(fine_block)
        self.assertEqual(set(result.keys()), {"intent", "sourceInstance", "acceptanceCriteria"})
        self.assertEqual(result["intent"]["energyLevel"], "high")
        self.assertEqual(result["intent"]["durationMs"], [800.0, 2000.0])
        self.assertEqual(result["sourceInstance"]["productInSource"], "MacBook 银色机身")
        self.assertEqual(len(result["acceptanceCriteria"]["anyOf"]), 2)
        self.assertEqual(result["acceptanceCriteria"]["rejectIf"], ["低动感纯静物图"])

    def test_returns_empty_when_fine_block_missing_contract(self):
        self.assertEqual(self.module._extract_migration_contract({}), {})
        self.assertEqual(self.module._extract_migration_contract(None), {})
        self.assertEqual(self.module._extract_migration_contract({"migrationContract": "not a dict"}), {})

    def test_drops_malformed_intent_but_keeps_other_valid_sections(self):
        contract = self._valid_contract()
        contract["intent"]["energyLevel"] = "extreme"   # not in enum
        fine_block = {"migrationContract": contract}
        result = self.module._extract_migration_contract(fine_block)
        self.assertNotIn("intent", result)
        self.assertIn("sourceInstance", result)
        self.assertIn("acceptanceCriteria", result)


class BuildStructureGraphSchemaVersionTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_schema_version_v1_when_any_block_has_contract(self):
        rough_doc = {"contentBlocks": [
            {"id": "block_001", "timeRange": {"start": 0, "end": 5}},
            {"id": "block_002", "timeRange": {"start": 5, "end": 10}},
        ], "roughSummary": {"oneSentenceStructure": "test"}}
        fine_doc = {"contentBlocks": [
            {"blockId": "block_001", "migrationContract": {
                "intent": {
                    "purpose": "x", "energyLevel": "high",
                    "motionPattern": "p", "compositionPrincipal": "c",
                    "durationMs": [100, 200]
                }
            }}
        ]}
        graph = self.module.build_structure_graph(rough_doc, fine_doc)
        self.assertEqual(graph.get("schemaVersion"), "v1")

    def test_schema_version_omitted_for_v0_input(self):
        rough_doc = {"contentBlocks": [
            {"id": "block_001", "timeRange": {"start": 0, "end": 5}},
        ], "roughSummary": {"oneSentenceStructure": "test"}}
        fine_doc = {"contentBlocks": [{"blockId": "block_001"}]}  # no migrationContract
        graph = self.module.build_structure_graph(rough_doc, fine_doc)
        self.assertNotIn("schemaVersion", graph)


class ResolveAspectRatioTests(unittest.TestCase):
    """_resolve_aspect_ratio: explicit flag wins, else auto-read media_technical.

    Fixes the footgun where forgetting --aspect-ratio silently yields 'unknown'
    even though media_technical already knows the real ratio (the bug that left
    chocolate_mud_pie's graph at unknown on the first run).
    """

    def setUp(self):
        self.module = load_module()

    def test_explicit_override_wins(self):
        self.assertEqual(self.module._resolve_aspect_ratio("any_vid", "16:9"), "16:9")

    def test_unknown_without_media_returns_unknown(self):
        # nonexistent video_id -> no media_technical on disk -> unknown
        self.assertEqual(
            self.module._resolve_aspect_ratio("no_such_video_xyz", "unknown"), "unknown"
        )

    def _patch_media_technical(self, aspect_ratio: str) -> Path:
        tmp = tempfile.mkdtemp()
        media = Path(tmp) / "media_technical.json"
        media.write_text(f'{{"aspectRatio": "{aspect_ratio}"}}', encoding="utf-8")
        orig = self.module.analysis_paths

        class _FakePaths:
            media_technical = media

        self.module.analysis_paths = lambda vid: _FakePaths()
        self.addCleanup(setattr, self.module, "analysis_paths", orig)
        return media

    def test_unknown_auto_reads_from_media_technical(self):
        self._patch_media_technical("9:16")
        self.assertEqual(self.module._resolve_aspect_ratio("x", "unknown"), "9:16")

    def test_nonstandard_ratio_in_media_returns_unknown(self):
        self._patch_media_technical("9:19.5")  # not in (9:16, 16:9, 1:1)
        self.assertEqual(self.module._resolve_aspect_ratio("x", "unknown"), "unknown")
