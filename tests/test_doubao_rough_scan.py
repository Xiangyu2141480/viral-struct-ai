import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "doubao_rough_scan.py"


def load_module():
    spec = importlib.util.spec_from_file_location("doubao_rough_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DoubaoRoughScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_load_dotenv_reads_key_value_pairs_without_quotes(self):
        env_path = ROOT / "tests" / "tmp_env.test"
        env_path.write_text(
            "LLM_BASE_URL=https://example.com/api/v3\n"
            "SAMPLE_TOKEN='dummy-value'\n"
            "LLM_MODEL=ep-test\n",
            encoding="utf-8",
        )
        try:
            values = self.module.load_dotenv(env_path)
        finally:
            env_path.unlink()

        self.assertEqual(values["LLM_BASE_URL"], "https://example.com/api/v3")
        self.assertEqual(values["SAMPLE_TOKEN"], "dummy-value")
        self.assertEqual(values["LLM_MODEL"], "ep-test")

    def test_render_prompt_replaces_video_placeholders(self):
        template = "video={{videoId}}, fps={{previewFps}}, size={{previewWidth}}x{{previewHeight}}"
        rendered = self.module.render_prompt(
            template,
            {
                "videoId": "macbook_neo",
                "previewFps": 5,
                "previewWidth": 720,
                "previewHeight": 406,
            },
        )

        self.assertEqual(rendered, "video=macbook_neo, fps=5, size=720x406")

    def test_build_responses_payload_uses_input_video_and_input_text(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
        )

        self.assertEqual(payload["model"], "ep-test")
        self.assertTrue(payload["store"])
        content = payload["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_video", "file_id": "file-abc"})
        self.assertEqual(content[1], {"type": "input_text", "text": "只输出 JSON"})

    def test_build_responses_payload_defaults_to_deterministic_temperature(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
        )

        self.assertEqual(payload["temperature"], 0)

    def test_build_responses_payload_allows_temperature_override(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
            temperature=0.3,
        )

        self.assertEqual(payload["temperature"], 0.3)

    def test_extract_response_text_handles_output_text_and_content_array(self):
        self.assertEqual(
            self.module.extract_response_text({"output_text": "{\"ok\": true}"}),
            "{\"ok\": true}",
        )

        nested = {
            "output": [
                {
                    "content": [
                        {"type": "output_text", "text": "{\"ok\": true}"}
                    ]
                }
            ]
        }
        self.assertEqual(self.module.extract_response_text(nested), "{\"ok\": true}")

    def test_extract_json_object_strips_markdown_fence(self):
        text = "```json\n{\"videoId\":\"macbook_neo\"}\n```"
        parsed = self.module.extract_json_object(text)

        self.assertEqual(parsed, {"videoId": "macbook_neo"})

    def test_normalize_rough_scan_keeps_only_stage_one_contract(self):
        parsed = {
            "videoId": "demo",
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 9},
                    "coarseRoleGuess": "attention_grab",
                    "boundaryReason": "opening block ends before a visual reset",
                    "observableSummary": "fast product reveal opening",
                    "visualSignals": ["hands", "product"],
                    "textSignals": ["headline"],
                    "audioOrRhythmSignals": ["fast beat"],
                    "confidence": 0.86,
                    "fineScanFocusQuestions": ["what is the hook mechanism?"],
                },
                {
                    "id": "block_002",
                    "timeRange": {"start": 10, "end": 27},
                    "coarseRoleGuess": "product_or_brand_intro",
                    "observableSummary": "product assembly",
                    "confidence": 0.9,
                },
            ],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                    "inspectionWindow": {"start": 7.0, "end": 12.0},
                    "visibleBoundaryCue": "white flash between blocks",
                    "whyNeedsMicroscope": "possible flash transition",
                    "confidence": 0.78,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)

        self.assertEqual(normalized["schemaVersion"], "rough_content_blocks_v1")
        self.assertEqual(len(normalized["contentBlocks"]), 2)
        self.assertEqual(normalized["contentBlocks"][0]["id"], "block_001")
        self.assertEqual(normalized["contentBlocks"][0]["coarseRoleGuess"], "attention_grab")
        self.assertEqual(len(normalized["boundaryCandidates"]), 1)
        self.assertEqual(normalized["boundaryCandidates"][0]["id"], "boundary_001")
        self.assertEqual(normalized["boundaryCandidates"][0]["roughBoundaryTime"], 9.5)

    def test_normalize_rough_scan_requires_content_blocks(self):
        with self.assertRaisesRegex(ValueError, "contentBlocks"):
            self.module.normalize_rough_scan({"videoId": "demo"})

    def test_normalize_rough_scan_requires_boundary_candidates(self):
        with self.assertRaisesRegex(ValueError, "boundaryCandidates"):
            self.module.normalize_rough_scan({
                "videoId": "demo",
                "contentBlocks": [
                    {
                        "id": "block_001",
                        "timeRange": {"start": 0, "end": 1},
                    }
                ],
            })

    def test_rough_prompt_uses_segmentation_plan_as_primary_schema(self):
        prompt = (ROOT / "prompts" / "video_understanding" / "rough_structure_scan_v0.md").read_text(
            encoding="utf-8"
        )

        self.assertIn('"contentBlocks"', prompt)
        self.assertIn('"boundaryCandidates"', prompt)
        self.assertIn('"roughBoundaryTime"', prompt)
        self.assertIn('"coarseRoleGuess"', prompt)
        self.assertIn("第一阶段只负责识别内容块", prompt)
        self.assertIn("不要在第一阶段判断转场类型", prompt)
        self.assertIn("请不要做深度角色分类", prompt)
        self.assertNotIn('"unitType": "segment | transition"', prompt)
        self.assertNotIn('"role": "hook | brand_opening', prompt)

    def test_build_multipart_body_contains_file_and_fps(self):
        body, content_type = self.module.build_multipart_body(
            fields={
                "purpose": "user_data",
                "preprocess_configs[video][fps]": "5",
            },
            files={
                "file": ("demo.mp4", b"abc", "video/mp4"),
            },
            boundary="fixed-boundary",
        )

        decoded = body.decode("utf-8")
        self.assertIn("multipart/form-data; boundary=fixed-boundary", content_type)
        self.assertIn('name="purpose"', decoded)
        self.assertIn("user_data", decoded)
        self.assertIn('name="preprocess_configs[video][fps]"', decoded)
        self.assertIn('filename="demo.mp4"', decoded)
        self.assertIn("abc", decoded)


if __name__ == "__main__":
    unittest.main()
