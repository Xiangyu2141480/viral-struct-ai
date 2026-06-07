"""Gate A (free, deterministic): lint the de-biased scan prompts.

Asserts the ad-persona / ad-pre-label priming is gone from the de-biased prompt
set, the genre-neutral v1 rough prompt carries the genre-first + instructional-role
guidance, and the preserved v0 rough prompt is untouched (kept for A/B + repro).
"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "prompts" / "video_understanding"
sys.path.insert(0, str(ROOT / "scripts"))

# Prompts that MUST be free of ad priming after de-bias.
DEBIASED = [
    "rough_structure_scan_v1.md",
    "fine_structure_scan_v0.md",
    "fine_structure_scan_v1.md",
    "peak_micro_scan_v0.md",
    "boundary_micro_scan_v0.md",
]

# Persona / pre-label strings that pre-assert an e-commerce/ad genre.
FORBIDDEN = [
    "你是一个电商/广告",      # ad persona (rough / fine / peak)
    "广告/电商视频的边界",    # ad persona (boundary)
    "电商/广告宣传视频",      # ad pre-label (rough)
    "电商/广告视频内容块",    # ad pre-label (fine)
    "爆款",                   # viral/explosive framing
]


def _load_rough_scan():
    spec = importlib.util.spec_from_file_location(
        "rough_scan", ROOT / "scripts" / "rough_scan.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class PromptDebiasLintTests(unittest.TestCase):
    def test_debiased_prompts_have_no_ad_priming(self):
        for name in DEBIASED:
            text = (PROMPTS / name).read_text(encoding="utf-8")
            for needle in FORBIDDEN:
                self.assertNotIn(
                    needle, text, f"{name} still contains ad priming: {needle!r}"
                )

    def test_rough_v1_is_genre_neutral_and_instructional(self):
        text = (PROMPTS / "rough_structure_scan_v1.md").read_text(encoding="utf-8")
        self.assertIn("你是一个短视频内容结构分析专家。", text)
        self.assertIn("请勿预设为广告", text)         # explicit anti-anchor
        self.assertIn("tutorial_step", text)            # instructional-role guidance
        # the neutral genre list is allowed to mention 电商/广告 as one option
        self.assertIn("可能是电商/广告、教程、课程", text)

    def test_rough_v0_baseline_is_preserved(self):
        text = (PROMPTS / "rough_structure_scan_v0.md").read_text(encoding="utf-8")
        self.assertIn("你是一个电商/广告短视频内容块切片专家。", text)

    def test_prompt_version_switch_resolves(self):
        rough = _load_rough_scan()
        import argparse

        v1 = argparse.Namespace(prompt=None, prompt_version="v1")
        v0 = argparse.Namespace(prompt=None, prompt_version="v0")
        override = argparse.Namespace(prompt="custom/path.md", prompt_version="v1")
        self.assertTrue(rough.resolve_prompt_path(v1).endswith("rough_structure_scan_v1.md"))
        self.assertTrue(rough.resolve_prompt_path(v0).endswith("rough_structure_scan_v0.md"))
        self.assertEqual(rough.resolve_prompt_path(override), "custom/path.md")


if __name__ == "__main__":
    unittest.main()
