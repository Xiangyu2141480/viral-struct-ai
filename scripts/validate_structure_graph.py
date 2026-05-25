#!/usr/bin/env python3
"""Lightweight structural validator mirroring packages/shared/src/schemas.ts.

Not a replacement for Zod parsing — this catches the common shape/enum/
required-field violations so the adapter output is ready for the API.
Run the API tests for the authoritative validation:

    pnpm --filter @viral-struct/api test
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ASPECT = {"9:16", "16:9", "1:1", "unknown"}
VIDEO_TYPE = {"ecommerce", "local_service", "course", "brand", "unknown"}
STYLE = {"high_click", "high_conversion", "premium", "fast_pace", "unknown"}
SEG_ROLE = {"hook", "pain_point", "selling_point", "proof", "usage", "comparison", "cta"}
SLOT_ROLE = {"opening_attention", "product_closeup", "usage_demo", "benefit_visual",
             "comparison", "testimonial", "cta_visual"}
ASSET_TYPE = {"image", "video", "text", "generated"}
CAMERA = {"closeup", "medium", "wide", "macro", "unknown"}
MOTION = {"static", "push_in", "pan", "fast_cut", "hand_operation", "unknown"}
CUT_FREQ = {"low", "medium", "high"}
CAP_DENSITY = {"low", "medium", "high"}
CAP_POS = {"bottom_center", "center", "top", "mixed"}
INGRED_TYPE = {
    "human_presence", "face_closeup", "host_talking", "hand_demo",
    "beauty_demo", "makeup_application", "skin_texture_display",
    "before_after_comparison", "product_closeup_trait", "texture_display",
    "swatch_demo", "scene_style", "soft_light", "clean_background",
    "premium_visual", "trust_building", "social_proof",
    "professional_review", "lifestyle_context", "unknown",
}
TRANSFERABILITY = {"directly_transferable", "requires_user_asset",
                   "can_be_recreated_by_packaging", "can_be_replaced_by_repair",
                   "not_transferable"}
GAP_STRAT = {
    "structure_reorder", "caption_rewrite", "text_card", "selling_point_card",
    "comparison_card", "cta_card", "crop_zoom", "reuse_asset", "aigc_background",
    "aigc_voiceover", "hand_demo", "product_closeup_replacement", "texture_card",
    "swatch_card", "before_after_card", "trust_card", "style_filter_suggestion",
    "ask_user_for_human_demo",
}
EDGE_TYPE = {"sequence", "requires", "maps_to", "fallback"}
EVIDENCE_TYPE = {"frame", "timestamp", "transcript", "model_observation"}
HUMAN_ROLE = {"host", "model", "user", "hand_only", "none"}
HUMAN_FRAMING = {"face_closeup", "half_body", "full_body", "hands",
                 "skin_macro", "product_only"}
HUMAN_ACTION = {"talking", "applying_product", "showing_result",
                "swatching", "holding_product", "none"}


errors: list[str] = []


def fail(loc: str, msg: str) -> None:
    errors.append(f"{loc}: {msg}")


def require(obj: dict, key: str, loc: str) -> Any:
    if key not in obj:
        fail(loc, f"missing required key '{key}'")
        return None
    return obj[key]


def check_enum(value: Any, choices: set, loc: str) -> None:
    if value not in choices:
        fail(loc, f"invalid value {value!r}, expected one of {sorted(choices)}")


def check_number(value: Any, loc: str) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        fail(loc, f"expected number, got {type(value).__name__}")


def check_string(value: Any, loc: str, min_len: int = 0) -> None:
    if not isinstance(value, str):
        fail(loc, f"expected string, got {type(value).__name__}")
    elif len(value) < min_len:
        fail(loc, f"string too short (len={len(value)}, min={min_len})")


def validate(graph: dict) -> None:
    meta = require(graph, "meta", "meta") or {}
    check_number(meta.get("duration"), "meta.duration")
    check_enum(meta.get("aspectRatio"), ASPECT, "meta.aspectRatio")
    check_enum(meta.get("videoType"), VIDEO_TYPE, "meta.videoType")
    check_enum(meta.get("style"), STYLE, "meta.style")

    check_string(graph.get("structureSummary", ""), "structureSummary")

    segments = require(graph, "segments", "segments") or []
    for i, seg in enumerate(segments):
        loc = f"segments[{i}]"
        check_string(seg.get("id"), f"{loc}.id")
        check_enum(seg.get("role"), SEG_ROLE, f"{loc}.role")
        check_number(seg.get("start"), f"{loc}.start")
        check_number(seg.get("end"), f"{loc}.end")
        check_number(seg.get("duration"), f"{loc}.duration")
        check_string(seg.get("purpose"), f"{loc}.purpose")
        check_string(seg.get("transferRule"), f"{loc}.transferRule")
        if seg.get("importance") not in (1, 2, 3, 4, 5):
            fail(f"{loc}.importance", f"expected 1-5, got {seg.get('importance')!r}")

    seg_ids = {s.get("id") for s in segments}

    shot_slots = require(graph, "shotSlots", "shotSlots") or []
    for i, slot in enumerate(shot_slots):
        loc = f"shotSlots[{i}]"
        check_string(slot.get("id"), f"{loc}.id")
        if slot.get("segmentId") not in seg_ids:
            fail(f"{loc}.segmentId", f"references unknown segment {slot.get('segmentId')!r}")
        check_enum(slot.get("role"), SLOT_ROLE, f"{loc}.role")
        asset = slot.get("requiredAsset") or {}
        check_enum(asset.get("type"), ASSET_TYPE, f"{loc}.requiredAsset.type")
        check_string(asset.get("subject"), f"{loc}.requiredAsset.subject")
        if "camera" in asset:
            check_enum(asset["camera"], CAMERA, f"{loc}.requiredAsset.camera")
        if "motion" in asset:
            check_enum(asset["motion"], MOTION, f"{loc}.requiredAsset.motion")
        for j, strat in enumerate(slot.get("fallbackStrategies", [])):
            check_enum(strat, GAP_STRAT, f"{loc}.fallbackStrategies[{j}]")
        for j, req in enumerate(slot.get("visualIngredientRequirements", []) or []):
            check_enum(req, INGRED_TYPE, f"{loc}.visualIngredientRequirements[{j}]")
        hr = slot.get("humanRequirement")
        if hr is not None:
            if not isinstance(hr.get("required"), bool):
                fail(f"{loc}.humanRequirement.required", "expected boolean")
            if "role" in hr:
                check_enum(hr["role"], HUMAN_ROLE, f"{loc}.humanRequirement.role")
            if "framing" in hr:
                check_enum(hr["framing"], HUMAN_FRAMING, f"{loc}.humanRequirement.framing")
            if "action" in hr:
                check_enum(hr["action"], HUMAN_ACTION, f"{loc}.humanRequirement.action")

    rhythm = require(graph, "rhythm", "rhythm") or {}
    check_number(rhythm.get("avgShotDuration"), "rhythm.avgShotDuration")
    check_enum(rhythm.get("cutFrequency"), CUT_FREQ, "rhythm.cutFrequency")
    check_string(rhythm.get("pattern"), "rhythm.pattern")

    pkg = require(graph, "packaging", "packaging") or {}
    check_enum(pkg.get("captionDensity"), CAP_DENSITY, "packaging.captionDensity")
    check_enum(pkg.get("captionPosition"), CAP_POS, "packaging.captionPosition")
    check_string(pkg.get("titleStyle"), "packaging.titleStyle")
    check_string(pkg.get("coverStyle"), "packaging.coverStyle")

    ingredients = require(graph, "creativeIngredients", "creativeIngredients") or []
    ing_ids = set()
    for i, ing in enumerate(ingredients):
        loc = f"creativeIngredients[{i}]"
        check_string(ing.get("id"), f"{loc}.id")
        ing_ids.add(ing.get("id"))
        check_enum(ing.get("type"), INGRED_TYPE, f"{loc}.type")
        check_string(ing.get("name"), f"{loc}.name")
        check_string(ing.get("description"), f"{loc}.description")
        check_enum(ing.get("transferability"), TRANSFERABILITY, f"{loc}.transferability")
        conf = ing.get("confidence")
        if not isinstance(conf, (int, float)) or not 0 <= conf <= 1:
            fail(f"{loc}.confidence", f"expected 0-1, got {conf!r}")
        for j, ev in enumerate(ing.get("evidence", [])):
            check_enum(ev.get("type"), EVIDENCE_TYPE, f"{loc}.evidence[{j}].type")
            check_string(ev.get("value"), f"{loc}.evidence[{j}].value")
        for j, strat in enumerate(ing.get("fallbackStrategies", [])):
            check_enum(strat, GAP_STRAT, f"{loc}.fallbackStrategies[{j}]")
        for j, sid in enumerate(ing.get("segmentIds", [])):
            if sid not in seg_ids:
                fail(f"{loc}.segmentIds[{j}]", f"unknown segment {sid!r}")

    slot_ids = {s.get("id") for s in shot_slots}
    node_ids = seg_ids | slot_ids | ing_ids
    edges = require(graph, "edges", "edges") or []
    for i, edge in enumerate(edges):
        loc = f"edges[{i}]"
        check_enum(edge.get("type"), EDGE_TYPE, f"{loc}.type")
        if edge.get("from") not in node_ids:
            fail(f"{loc}.from", f"unknown node {edge.get('from')!r}")
        if edge.get("to") not in node_ids:
            fail(f"{loc}.to", f"unknown node {edge.get('to')!r}")


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "seed_assets/analysis/macbook_neo/structure_graph.json"
    )
    if not path.exists():
        print(f"ERROR: not found: {path}", file=sys.stderr)
        return 2
    with path.open(encoding="utf-8") as f:
        graph = json.load(f)
    validate(graph)
    if errors:
        print(f"FAIL: {path} ({len(errors)} issues)")
        for e in errors[:30]:
            print(f"  - {e}")
        if len(errors) > 30:
            print(f"  ... and {len(errors) - 30} more")
        return 1
    print(f"OK: {path}")
    print(f"  segments={len(graph['segments'])} "
          f"shotSlots={len(graph['shotSlots'])} "
          f"ingredients={len(graph['creativeIngredients'])} "
          f"edges={len(graph['edges'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
