#!/usr/bin/env python3
"""Bridge: rough_structure_scan + fine_structure_scan -> ViralStructureGraph JSON.

This adapter converts the Python-side scan artifacts into the
ViralStructureGraph format consumed by the TypeScript migration pipeline
(apps/api/src/services/slotMatcher.ts).

Source of truth for the output schema is packages/shared/src/schemas.ts.
Output JSON is validated downstream by ViralStructureGraphSchema (Zod)
when /api/slots/match or /api/structure/extract consumes it.

Usage:
    python scripts/extract_structure_graph.py
    python scripts/extract_structure_graph.py --video-id macbook_neo
    python scripts/extract_structure_graph.py --aspect-ratio 9:16
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from path_layout import DEFAULT_VIDEO_ID, analysis_paths


# --------------------------------------------------------------------------- #
# Enum mappings (output enums match packages/shared/src/schemas.ts)
# --------------------------------------------------------------------------- #

_FINE_ROLE_MAP = {
    "hook": "hook",
    "brand_opening": "hook",
    "product_reveal": "selling_point",
    "selling_point": "selling_point",
    "usage_scene": "usage",
    "proof": "proof",
    "comparison": "comparison",
    "cta": "cta",
    "feature_or_claim": "selling_point",
    "demo_or_usage": "usage",
    "closing_or_cta": "cta",
    "attention_grab": "hook",
    "product_or_brand_intro": "selling_point",
}

_ROUGH_ROLE_MAP = {
    "attention_grab": "hook",
    "product_or_brand_intro": "selling_point",
    "feature_or_claim": "selling_point",
    "demo_or_usage": "usage",
    "closing_or_cta": "cta",
}

_SHOT_SCALE_TO_CAMERA = {
    "close_up": "closeup",
    "medium_close": "closeup",
    "medium": "medium",
    "wide": "wide",
    "macro": "macro",
}

_CAMERA_MOVEMENT_TO_MOTION = {
    "static": "static",
    "push_in": "push_in",
    "pan": "pan",
}

_SEGMENT_ROLE_TO_SLOT_ROLE = {
    "hook": "opening_attention",
    "pain_point": "benefit_visual",
    "selling_point": "product_closeup",
    "usage": "usage_demo",
    "proof": "comparison",
    "comparison": "comparison",
    "cta": "cta_visual",
}

_ROLE_FALLBACK_STRATEGIES = {
    "hook": ["product_closeup_replacement", "caption_rewrite", "text_card"],
    "selling_point": ["selling_point_card", "crop_zoom", "caption_rewrite"],
    "usage": ["hand_demo", "selling_point_card", "caption_rewrite"],
    "proof": ["before_after_card", "comparison_card", "trust_card"],
    "comparison": ["before_after_card", "comparison_card", "trust_card"],
    "cta": ["cta_card", "selling_point_card", "trust_card"],
    "pain_point": ["text_card", "caption_rewrite", "selling_point_card"],
}

_ROLE_PURPOSE = {
    "hook": "建立第一眼注意力，揭示主体或制造好奇",
    "pain_point": "唤起目标用户的痛点共鸣",
    "selling_point": "展示核心卖点，建立产品价值感知",
    "proof": "通过证据或权威建立可信度",
    "usage": "演示真实使用场景，降低使用门槛",
    "comparison": "通过对比强化卖点感知",
    "cta": "明确行动号召并收束",
}

_ROLE_TRANSFER_RULE = {
    "hook": "替换为新商品的高强度视觉揭示或反常识开场，保留 3 秒内主体亮相节奏",
    "pain_point": "替换为新商品目标用户最高频的使用痛点",
    "selling_point": "映射到新商品最能驱动转化的核心卖点",
    "proof": "用对比、数据卡、用户评价或专家背书证明卖点",
    "usage": "替换为新商品的真实使用场景，保留手部演示节奏",
    "comparison": "保留对比结构，替换为新商品的对比维度",
    "cta": "用新商品场景化 CTA 收束（价格、限时、优惠）",
}

_ROLE_IMPORTANCE = {
    "hook": 5,
    "pain_point": 4,
    "selling_point": 5,
    "proof": 4,
    "usage": 4,
    "comparison": 4,
    "cta": 4,
}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _truncate(s: str, n: int = 200) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _strip_none(obj: Any) -> Any:
    """Recursively drop None-valued keys so Zod .optional() doesn't get null."""
    if isinstance(obj, dict):
        return {k: _strip_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_none(v) for v in obj]
    return obj


def _index_fine_blocks(fine_doc: dict) -> dict[str, dict]:
    return {
        blk.get("blockId", ""): blk
        for blk in fine_doc.get("contentBlocks", [])
    }


def _fine_role(fine_block: dict) -> str:
    role_info = fine_block.get("roleConfirmation", {}) or {}
    # v0.3 uses `role`; early experiments used `confirmedRole`.
    return str(role_info.get("role") or role_info.get("confirmedRole") or "")


def _resolve_segment_role(rough_block: dict, fine_block: dict | None, index: int) -> str:
    if fine_block:
        confirmed = _fine_role(fine_block)
        if confirmed == "product_reveal" and index == 0:
            return "hook"
        if confirmed in _FINE_ROLE_MAP:
            return _FINE_ROLE_MAP[confirmed]

    rough_role = rough_block.get("coarseRoleGuess", "")
    if rough_role in _ROUGH_ROLE_MAP:
        mapped = _ROUGH_ROLE_MAP[rough_role]
        if index == 0 and mapped != "cta":
            return "hook"
        return mapped

    return "hook" if index == 0 else "selling_point"


def _aspect_ratio(value: str | None) -> str:
    return value if value in ("9:16", "16:9", "1:1") else "unknown"


def _block_time_range_seconds(rough_block: dict, fine_block: dict | None) -> tuple[float, float]:
    if fine_block:
        ms_range = fine_block.get("sourceTimeRangeMs")
        if isinstance(ms_range, dict):
            start = float(ms_range.get("start", 0) or 0) / 1000.0
            end = float(ms_range.get("end", 0) or 0) / 1000.0
            return start, end

        seconds_range = fine_block.get("sourceTimeRange")
        if isinstance(seconds_range, dict):
            return (
                float(seconds_range.get("start", 0) or 0),
                float(seconds_range.get("end", 0) or 0),
            )

    rough_range = rough_block.get("timeRange", {}) or {}
    return (
        float(rough_range.get("start", 0) or 0),
        float(rough_range.get("end", 0) or 0),
    )


def _text_elements(fine_block: dict | None) -> list[dict]:
    if not fine_block:
        return []
    elements = fine_block.get("textOverlayBehavior", {}).get("textElements", [])
    return elements if isinstance(elements, list) else []


def _caption_from_fine_or_rough(fine_block: dict | None, rough_block: dict) -> str:
    text = " / ".join(
        str(element.get("content", "")).strip()
        for element in _text_elements(fine_block)
        if str(element.get("content", "")).strip()
    )
    if text:
        return text

    if fine_block:
        feature_seq = fine_block.get("productPresentation", {}).get("featureSequence") or []
        if feature_seq:
            return "、".join(str(item) for item in feature_seq)

    return str(rough_block.get("observableSummary", "") or "")


def _fine_reasoning(fine_block: dict) -> str:
    role_info = fine_block.get("roleConfirmation", {}) or {}
    if role_info.get("reasoning"):
        return str(role_info["reasoning"])
    answers = fine_block.get("inspectionAnswers", []) or []
    for answer in answers:
        if isinstance(answer, dict) and answer.get("answer"):
            return str(answer["answer"])
    motifs = fine_block.get("transferableMotifs", []) or []
    for motif in motifs:
        if isinstance(motif, dict) and motif.get("description"):
            return str(motif["description"])
    return ""


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #

def _build_segment(rough_block: dict, fine_block: dict | None, role: str, seg_id: str) -> dict:
    start, end = _block_time_range_seconds(rough_block, fine_block)
    if fine_block:
        reasoning = _fine_reasoning(fine_block)
        caption_text = _caption_from_fine_or_rough(fine_block, rough_block)
        purpose_base = _ROLE_PURPOSE[role]
        purpose = f"{purpose_base}（精扫定位：{_truncate(reasoning, 120)}）" if reasoning else purpose_base
    else:
        caption_text = _caption_from_fine_or_rough(None, rough_block)
        purpose = _ROLE_PURPOSE[role]

    caption = _truncate(caption_text, 200) if caption_text else None

    return {
        "id": seg_id,
        "role": role,
        "start": start,
        "end": end,
        "duration": round(end - start, 3),
        "purpose": purpose,
        "caption": caption,
        "transferRule": _ROLE_TRANSFER_RULE[role],
        "importance": _ROLE_IMPORTANCE[role],
    }


def _slot_role(segment_role: str, index_in_block: int, total_in_block: int) -> str:
    base = _SEGMENT_ROLE_TO_SLOT_ROLE[segment_role]
    if segment_role == "selling_point" and total_in_block > 1 and index_in_block > 0:
        return "benefit_visual"
    return base


def _shot_ingredients(shot: dict, additional_findings: list[str]) -> list[str]:
    text = (shot.get("visualKeyAction", "") or "") + " " + " ".join(additional_findings or [])
    ingredients: list[str] = []
    if "纯白" in text or "干净" in text or "极简" in text:
        ingredients.append("clean_background")
    if "手" in text or shot.get("subjectFocus") == "human_with_product":
        ingredients.append("hand_demo")
    if "近景" in text or "特写" in text or shot.get("shotScale") in ("close_up", "macro"):
        ingredients.append("product_closeup_trait")
    if "光" in text or "亮" in text:
        ingredients.append("soft_light")
    if "特效" in text or "变色" in text or "形变" in text or "动画" in text or "高级" in text:
        ingredients.append("premium_visual")
    return ingredients or ["product_closeup_trait"]


def _human_requirement(shot: dict) -> dict | None:
    focus = shot.get("subjectFocus", "")
    if focus == "human_with_product":
        return {
            "required": True,
            "role": "hand_only",
            "framing": "hands",
            "action": "holding_product",
        }
    if focus == "product_only":
        return {"required": False}
    return None


def _asset_type_to_required_asset_type(asset_type: str) -> str:
    if asset_type in {"product_still", "comparison_chart"}:
        return "image"
    if asset_type in {"text_card", "voiceover_line"}:
        return "text"
    return "video"


def _slot_role_from_required_asset(asset_type: str, purpose: str, segment_role: str) -> str:
    if purpose in {"hook_visual", "product_reveal"} and segment_role == "hook":
        return "opening_attention"
    if asset_type in {"product_still", "product_video"}:
        return "usage_demo" if segment_role == "usage" or purpose == "feature_demo" else "product_closeup"
    if asset_type == "hand_demo":
        return "usage_demo" if segment_role == "usage" else _SEGMENT_ROLE_TO_SLOT_ROLE[segment_role]
    if asset_type == "comparison_chart" or purpose == "comparison":
        return "comparison"
    if asset_type == "ugc_clip":
        return "testimonial"
    if purpose == "cta" or segment_role == "cta":
        return "cta_visual"
    return _SEGMENT_ROLE_TO_SLOT_ROLE[segment_role]


def _ingredients_from_required_asset(
    asset_type: str,
    fine_block: dict | None,
    rough_block: dict,
) -> list[str]:
    if asset_type in {"text_card", "voiceover_line"}:
        return []

    text = " ".join([
        str(asset_type),
        str(rough_block.get("observableSummary", "") or ""),
        " ".join(str(v) for v in rough_block.get("visualSignals", []) or []),
        " ".join(
            str(motif.get("description", ""))
            for motif in (fine_block or {}).get("transferableMotifs", []) or []
            if isinstance(motif, dict)
        ),
    ])
    ingredients: list[str] = []
    if asset_type == "hand_demo" or "手" in text:
        ingredients.extend(["human_presence", "hand_demo"])
    if asset_type in {"product_still", "product_video"} or "产品" in text or "近景" in text:
        ingredients.append("product_closeup_trait")
    if asset_type == "comparison_chart" or "对比" in text:
        ingredients.append("before_after_comparison")
    if asset_type == "ugc_clip":
        ingredients.extend(["human_presence", "social_proof"])
    if "纯白" in text or "纯色" in text or "干净" in text or "极简" in text:
        ingredients.append("clean_background")
    if "光" in text or "亮" in text:
        ingredients.append("soft_light")
    if "特效" in text or "变色" in text or "形变" in text or "动画" in text or "高级" in text:
        ingredients.append("premium_visual")

    deduped: list[str] = []
    for ingredient in ingredients:
        if ingredient not in deduped:
            deduped.append(ingredient)
    return deduped or ["product_closeup_trait"]


def _human_requirement_from_required_asset(asset_type: str) -> dict:
    if asset_type == "hand_demo":
        return {
            "required": True,
            "role": "hand_only",
            "framing": "hands",
            "action": "holding_product",
        }
    if asset_type == "ugc_clip":
        return {"required": True, "role": "user"}
    return {"required": False}


def _camera_from_required_asset(asset_type: str) -> str:
    if asset_type in {"product_still", "product_video", "hand_demo"}:
        return "closeup"
    if asset_type == "lifestyle_shot":
        return "medium"
    return "unknown"


def _motion_from_required_asset(asset_type: str) -> str:
    if asset_type == "hand_demo":
        return "hand_operation"
    if asset_type in {"product_video", "lifestyle_shot", "ugc_clip"}:
        return "static"
    return "static"


def _subject_from_required_asset(asset_req: dict, rough_block: dict, fine_block: dict | None) -> str:
    purpose = str(asset_req.get("purpose", "") or "")
    asset_type = str(asset_req.get("assetType", "") or "")
    caption = _caption_from_fine_or_rough(fine_block, rough_block)
    if caption:
        return caption
    summary = str(rough_block.get("observableSummary", "") or "")
    if summary:
        return summary
    return f"{asset_type or 'asset'} for {purpose or 'slot'}"


def _fallback_asset_requirements(role: str) -> list[dict[str, str]]:
    if role == "hook":
        return [{"assetType": "product_video", "purpose": "hook_visual", "criticality": "must"}]
    if role == "usage":
        return [{"assetType": "product_video", "purpose": "feature_demo", "criticality": "must"}]
    if role == "comparison":
        return [{"assetType": "comparison_chart", "purpose": "comparison", "criticality": "must"}]
    if role == "cta":
        return [{"assetType": "text_card", "purpose": "cta", "criticality": "must"}]
    return [{"assetType": "product_still", "purpose": "product_reveal", "criticality": "must"}]


def _required_asset_types(fine_block: dict | None, role: str) -> list[dict]:
    if fine_block:
        assets = fine_block.get("requiredAssetType", []) or []
        normalized = [asset for asset in assets if isinstance(asset, dict) and asset.get("assetType")]
        if normalized:
            return normalized
    return _fallback_asset_requirements(role)


def _first_action_duration_seconds(fine_block: dict | None, segment_duration: float) -> float:
    if not fine_block:
        return segment_duration
    for beat in fine_block.get("actionBeats", []) or []:
        time_range = beat.get("timeRangeMs")
        if isinstance(time_range, dict):
            start = float(time_range.get("start", 0) or 0)
            end = float(time_range.get("end", 0) or 0)
            if end > start:
                return round((end - start) / 1000.0, 2)
    return segment_duration


def _build_slot_from_required_asset(
    *,
    seg_id: str,
    segment_role: str,
    rough_block: dict,
    fine_block: dict | None,
    asset_req: dict,
    block_id: str,
    index_in_block: int,
    segment_duration: float,
    importance: int,
) -> dict:
    asset_type = str(asset_req.get("assetType", "") or "product_video")
    purpose = str(asset_req.get("purpose", "") or "")
    role = _slot_role_from_required_asset(asset_type, purpose, segment_role)
    min_duration = _first_action_duration_seconds(fine_block, segment_duration)
    return {
        "id": f"slot_{block_id}_asset_{index_in_block + 1:03d}",
        "segmentId": seg_id,
        "role": role,
        "requiredAsset": {
            "type": _asset_type_to_required_asset_type(asset_type),
            "subject": _truncate(_subject_from_required_asset(asset_req, rough_block, fine_block), 200),
            "camera": _camera_from_required_asset(asset_type),
            "motion": _motion_from_required_asset(asset_type),
            "minDuration": max(round(min_duration, 2), 0.5),
        },
        "visualIngredientRequirements": _ingredients_from_required_asset(asset_type, fine_block, rough_block),
        "humanRequirement": _human_requirement_from_required_asset(asset_type),
        "fallbackStrategies": _ROLE_FALLBACK_STRATEGIES[segment_role],
        "importance": importance,
    }


def _build_shot_slot(
    *,
    seg_id: str,
    segment_role: str,
    shot: dict,
    block_id: str,
    index_in_block: int,
    total_in_block: int,
    additional_findings: list[str],
    importance: int,
) -> dict:
    duration = float(shot.get("duration", 0))
    shot_id = shot.get("id", f"shot_{index_in_block + 1:03d}")
    return {
        "id": f"slot_{block_id}_{shot_id}",
        "segmentId": seg_id,
        "role": _slot_role(segment_role, index_in_block, total_in_block),
        "requiredAsset": {
            "type": "video",
            "subject": _truncate(shot.get("visualKeyAction", "未指定主体"), 200),
            "camera": _SHOT_SCALE_TO_CAMERA.get(shot.get("shotScale", ""), "unknown"),
            "motion": _CAMERA_MOVEMENT_TO_MOTION.get(shot.get("cameraMovement", ""), "unknown"),
            "minDuration": max(round(duration, 2), 0.5),
        },
        "visualIngredientRequirements": _shot_ingredients(shot, additional_findings),
        "humanRequirement": _human_requirement(shot),
        "fallbackStrategies": _ROLE_FALLBACK_STRATEGIES[segment_role],
        "importance": importance,
    }


def _build_creative_ingredients(
    rough_blocks: list[dict],
    fine_blocks: dict[str, dict],
    segments: list[dict],
    shot_slots: list[dict],
) -> list[dict]:
    signal_buckets: dict[str, dict[str, Any]] = {}

    def _add(ing_type: str, evidence: str, seg_id: str, slot_ids: list[str]) -> None:
        bucket = signal_buckets.setdefault(
            ing_type,
            {"evidence": [], "segmentIds": set(), "slotIds": set()},
        )
        bucket["evidence"].append(evidence)
        bucket["segmentIds"].add(seg_id)
        for sid in slot_ids:
            bucket["slotIds"].add(sid)

    for rough, segment in zip(rough_blocks, segments):
        seg_id = segment["id"]
        slots_in_seg = [s["id"] for s in shot_slots if s["segmentId"] == seg_id]
        block_id = rough.get("id", "")
        fine = fine_blocks.get(block_id)

        signals = list(rough.get("visualSignals", []) or [])
        if fine:
            signals.extend(fine.get("additionalFindings", []) or [])
            for asset_req in fine.get("requiredAssetType", []) or []:
                if not isinstance(asset_req, dict):
                    continue
                asset_type = asset_req.get("assetType")
                purpose = asset_req.get("purpose", "")
                evidence = f"{block_id}: requiredAssetType={asset_type}, purpose={purpose}"
                if asset_type == "hand_demo":
                    _add("human_presence", evidence, seg_id, slots_in_seg)
                    _add("hand_demo", evidence, seg_id, slots_in_seg)
                elif asset_type in {"product_still", "product_video"}:
                    _add("product_closeup_trait", evidence, seg_id, slots_in_seg)
                elif asset_type == "comparison_chart":
                    _add("before_after_comparison", evidence, seg_id, slots_in_seg)
                elif asset_type == "ugc_clip":
                    _add("human_presence", evidence, seg_id, slots_in_seg)
                    _add("social_proof", evidence, seg_id, slots_in_seg)
                elif asset_type == "lifestyle_shot":
                    _add("lifestyle_context", evidence, seg_id, slots_in_seg)

            for motif in fine.get("transferableMotifs", []) or []:
                if not isinstance(motif, dict):
                    continue
                motif_type = motif.get("motifType", "")
                description = _truncate(str(motif.get("description", "")), 100)
                if motif_type == "product_handling":
                    _add("hand_demo", f"{block_id}: {description}", seg_id, slots_in_seg)
                elif motif_type in {"visual_metaphor", "transition_signature", "text_choreography"}:
                    _add("premium_visual", f"{block_id}: {description}", seg_id, slots_in_seg)

            for shot in fine.get("shotStructure", {}).get("shots", []) or []:
                if shot.get("subjectFocus") == "human_with_product":
                    _add(
                        "hand_demo",
                        f"{block_id}/{shot.get('id', '')}: {_truncate(shot.get('visualKeyAction', ''), 80)}",
                        seg_id,
                        slots_in_seg,
                    )

        text = " ".join(signals)
        if "纯白" in text or "干净" in text or "极简" in text:
            _add("clean_background", f"{block_id}: {_truncate(text, 80)}", seg_id, slots_in_seg)
        if "光" in text or "亮" in text:
            _add("soft_light", f"{block_id}: {_truncate(text, 80)}", seg_id, slots_in_seg)
        if "特效" in text or "变色" in text or "形变" in text or "动画" in text or "高级" in text:
            _add("premium_visual", f"{block_id}: {_truncate(text, 80)}", seg_id, slots_in_seg)

    # Always include product_closeup_trait as a baseline ingredient
    all_seg_ids = {s["id"] for s in segments}
    closeup_slot_ids = [
        s["id"] for s in shot_slots if s["role"] in ("product_closeup", "opening_attention")
    ]
    signal_buckets.setdefault(
        "product_closeup_trait",
        {
            "evidence": ["全片以产品本体为核心呈现"],
            "segmentIds": all_seg_ids,
            "slotIds": set(closeup_slot_ids),
        },
    )

    spec = {
        "clean_background": (
            "directly_transferable",
            "纯净背景拍摄要求",
            "新素材需在纯白/纯色无干扰背景下拍摄，避免环境元素分散注意力",
            ["style_filter_suggestion", "crop_zoom"],
        ),
        "soft_light": (
            "can_be_recreated_by_packaging",
            "柔光高级光感",
            "可通过打光或后期调色复现",
            ["style_filter_suggestion", "selling_point_card"],
        ),
        "premium_visual": (
            "can_be_recreated_by_packaging",
            "创意特效与高级包装",
            "可通过 AIGC 包装或转场动画复现核心创意",
            ["aigc_background", "style_filter_suggestion"],
        ),
        "hand_demo": (
            "requires_user_asset",
            "手部操作演示",
            "需要新视频提供手部展示/操作素材",
            ["hand_demo", "ask_user_for_human_demo"],
        ),
        "human_presence": (
            "requires_user_asset",
            "人物出镜要求",
            "需要新素材提供人物或手部参与画面",
            ["hand_demo", "ask_user_for_human_demo"],
        ),
        "product_closeup_trait": (
            "requires_user_asset",
            "产品本体近景特写",
            "需要新视频提供产品清晰特写素材",
            ["product_closeup_replacement", "crop_zoom"],
        ),
        "before_after_comparison": (
            "can_be_recreated_by_packaging",
            "前后对比或对照表达",
            "可用对比卡片或新素材中的对照镜头复现",
            ["before_after_card", "comparison_card"],
        ),
        "social_proof": (
            "can_be_recreated_by_packaging",
            "社会证明元素",
            "可用评价、销量、背书或 UGC 片段补足",
            ["trust_card", "selling_point_card"],
        ),
        "lifestyle_context": (
            "requires_user_asset",
            "生活方式场景",
            "需要新素材提供匹配的场景环境或氛围镜头",
            ["aigc_background", "style_filter_suggestion"],
        ),
    }

    ingredients: list[dict] = []
    for ing_type, bucket in signal_buckets.items():
        transferability, name, description, fallbacks = spec.get(
            ing_type,
            ("requires_user_asset", ing_type, "通用视觉要素", []),
        )
        ingredients.append({
            "id": f"ing_{ing_type}",
            "type": ing_type,
            "name": name,
            "description": description,
            "segmentIds": sorted(bucket["segmentIds"]),
            "requiredForSlotIds": sorted(bucket["slotIds"]),
            "transferability": transferability,
            "fallbackStrategies": fallbacks,
            "evidence": [
                {"type": "model_observation", "value": _truncate(ev, 200)}
                for ev in bucket["evidence"][:5]
            ],
            "confidence": 0.85,
        })
    return ingredients


def _build_rhythm(rough_blocks: list[dict], fine_blocks: dict[str, dict]) -> dict:
    durations: list[float] = []
    peak_at: float | None = None
    best_confidence = -1.0
    for rough in rough_blocks:
        fine = fine_blocks.get(rough.get("id", ""))
        if not fine:
            continue
        for shot in fine.get("shotStructure", {}).get("shots", []) or []:
            d = float(shot.get("duration", 0) or 0)
            if d > 0:
                durations.append(d)
        for beat in fine.get("actionBeats", []) or []:
            time_range = beat.get("timeRangeMs")
            if isinstance(time_range, dict):
                start = float(time_range.get("start", 0) or 0)
                end = float(time_range.get("end", 0) or 0)
                if end > start:
                    durations.append((end - start) / 1000.0)
            anchor_ms = beat.get("anchorMs")
            if anchor_ms is not None:
                confidence = float(beat.get("anchorConfidence", 0.0) or 0.0)
                if confidence > best_confidence:
                    best_confidence = confidence
                    peak_at = round(float(anchor_ms) / 1000.0, 3)

    avg = round(sum(durations) / len(durations), 2) if durations else 0.0
    if avg <= 0:
        cut_freq = "low"
    elif avg < 3:
        cut_freq = "high"
    elif avg < 8:
        cut_freq = "medium"
    else:
        cut_freq = "low"

    if peak_at is None:
        intensity_rank = {"strong": 3, "medium": 2, "weak": 1}
        best_rank = -1
        for fine in fine_blocks.values():
            for change in fine.get("beatSyncAnalysis", {}).get("prominentVisualChanges", []) or []:
                rank = intensity_rank.get(change.get("intensity", ""), 0)
                if rank > best_rank:
                    best_rank = rank
                    peak_at = float(change.get("absTime", 0) or 0)

    result: dict[str, Any] = {
        "avgShotDuration": avg,
        "cutFrequency": cut_freq,
        "pattern": f"avg_{avg}s_per_shot_{cut_freq}_cut",
    }
    if peak_at is not None:
        result["peakAt"] = peak_at
    return result


def _build_packaging(fine_blocks: dict[str, dict]) -> dict:
    has_text = False
    transitions: set[str] = set()
    for fine in fine_blocks.values():
        text_behavior = fine.get("textOverlayBehavior", {}) or {}
        if text_behavior.get("hasText") or _text_elements(fine):
            has_text = True
        transition = fine.get("transitionOut", {}) or {}
        ttype = transition.get("type") or transition.get("transitionType")
        if ttype:
            transitions.add(ttype)

    return {
        "captionDensity": "medium" if has_text else "low",
        "captionPosition": "mixed",
        "titleStyle": "balanced_text" if has_text else "minimal_clean",
        "cardTypes": ["selling_point_card"] if has_text else [],
        "transitions": sorted(transitions) if transitions else ["hard_cut"],
        "coverStyle": "product_centered_clean_background",
    }


def _infer_video_type(rough_doc: dict) -> str:
    likely = (rough_doc.get("roughSummary", {}).get("likelyVideoType") or "").lower()
    if any(k in likely for k in ("product", "ecommerce", "ad")):
        return "ecommerce"
    if any(k in likely for k in ("course", "tutorial")):
        return "course"
    if "brand" in likely:
        return "brand"
    if any(k in likely for k in ("local", "service")):
        return "local_service"
    return "ecommerce"


def _infer_style(rough_doc: dict, avg_shot_duration: float) -> str:
    summary = rough_doc.get("roughSummary", {}) or {}
    text = (summary.get("oneSentenceStructure", "") or "") + (
        summary.get("globalConversionLogic", "") or ""
    )
    if any(k in text for k in ("创意", "特效", "高级", "质感")):
        return "premium"
    if 0 < avg_shot_duration < 2:
        return "fast_pace"
    return "high_conversion"


def _build_edges(
    segments: list[dict],
    shot_slots: list[dict],
    creative_ingredients: list[dict],
) -> list[dict]:
    edges: list[dict] = []
    for prev, nxt in zip(segments, segments[1:]):
        edges.append({"from": prev["id"], "to": nxt["id"], "type": "sequence"})
    for slot in shot_slots:
        edges.append({"from": slot["id"], "to": slot["segmentId"], "type": "maps_to"})
    for ing in creative_ingredients:
        for seg_id in ing["segmentIds"]:
            edges.append({"from": ing["id"], "to": seg_id, "type": "requires"})
    return edges


# --------------------------------------------------------------------------- #
# Main pipeline
# --------------------------------------------------------------------------- #

def build_structure_graph(
    rough_doc: dict,
    fine_doc: dict | None,
    *,
    aspect_ratio: str = "unknown",
) -> dict:
    rough_blocks = rough_doc.get("contentBlocks", []) or []
    fine_blocks = _index_fine_blocks(fine_doc) if fine_doc else {}

    segments: list[dict] = []
    shot_slots: list[dict] = []

    for idx, rough in enumerate(rough_blocks):
        block_id = rough.get("id", f"block_{idx + 1:03d}")
        fine = fine_blocks.get(block_id)
        role = _resolve_segment_role(rough, fine, idx)
        seg_id = f"seg_{block_id}"

        segment = _build_segment(rough, fine, role, seg_id)
        segments.append(segment)

        legacy_shots = fine.get("shotStructure", {}).get("shots", []) if fine else []
        if legacy_shots:
            additional = fine.get("additionalFindings", []) or []
            for s_idx, shot in enumerate(legacy_shots):
                shot_slots.append(_build_shot_slot(
                    seg_id=seg_id,
                    segment_role=role,
                    shot=shot,
                    block_id=block_id,
                    index_in_block=s_idx,
                    total_in_block=len(legacy_shots),
                    additional_findings=additional,
                    importance=segment["importance"],
                ))
        else:
            asset_requirements = _required_asset_types(fine, role)
            for a_idx, asset_req in enumerate(asset_requirements):
                shot_slots.append(_build_slot_from_required_asset(
                    seg_id=seg_id,
                    segment_role=role,
                    rough_block=rough,
                    fine_block=fine,
                    asset_req=asset_req,
                    block_id=block_id,
                    index_in_block=a_idx,
                    segment_duration=segment["duration"],
                    importance=segment["importance"],
                ))

    rhythm = _build_rhythm(rough_blocks, fine_blocks)
    packaging = _build_packaging(fine_blocks)
    creative_ingredients = _build_creative_ingredients(
        rough_blocks, fine_blocks, segments, shot_slots
    )
    edges = _build_edges(segments, shot_slots, creative_ingredients)

    duration = 0.0
    if rough_blocks:
        duration = float(rough_blocks[-1].get("timeRange", {}).get("end", 0) or 0)

    graph = {
        "meta": {
            "duration": duration,
            "aspectRatio": _aspect_ratio(aspect_ratio),
            "videoType": _infer_video_type(rough_doc),
            "style": _infer_style(rough_doc, rhythm["avgShotDuration"]),
        },
        "structureSummary": (
            rough_doc.get("roughSummary", {}).get("oneSentenceStructure")
            or "结构总览不可用，使用规则化提取的 segments 作为参考"
        ),
        "segments": segments,
        "shotSlots": shot_slots,
        "rhythm": rhythm,
        "packaging": packaging,
        "creativeIngredients": creative_ingredients,
        "edges": edges,
    }
    return _strip_none(graph)


# --------------------------------------------------------------------------- #
# Path resolution (canonical layout with legacy fallback)
# --------------------------------------------------------------------------- #

def _resolve_rough_scan(video_id: str, override: Path | None) -> Path:
    if override:
        return override
    paths = analysis_paths(video_id)
    if paths.rough_scan.exists():
        return paths.rough_scan
    legacy = paths.analysis_root / "rough_structure_scan.json"
    return legacy if legacy.exists() else paths.rough_scan


def _resolve_fine_scan(video_id: str, override: Path | None) -> Path | None:
    if override:
        return override
    merged = analysis_paths(video_id).fine_scan_dir / "fine_structure_scan.json"
    return merged if merged.exists() else None


def _resolve_output(video_id: str, override: Path | None) -> Path:
    if override:
        return override
    return analysis_paths(video_id).analysis_root / "structure_graph.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video-id", default=DEFAULT_VIDEO_ID)
    parser.add_argument("--rough-scan", type=Path, default=None)
    parser.add_argument("--fine-scan", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument(
        "--aspect-ratio",
        default="unknown",
        choices=["9:16", "16:9", "1:1", "unknown"],
    )
    parser.add_argument("--indent", type=int, default=2)
    args = parser.parse_args()

    rough_path = _resolve_rough_scan(args.video_id, args.rough_scan)
    fine_path = _resolve_fine_scan(args.video_id, args.fine_scan)
    out_path = _resolve_output(args.video_id, args.output)

    if not rough_path.exists():
        print(f"ERROR: rough scan not found: {rough_path}", file=sys.stderr)
        return 2

    rough_doc = _load_json(rough_path)
    fine_doc = _load_json(fine_path) if fine_path else None

    print(f"rough_scan -> {rough_path}")
    print(f"fine_scan  -> {fine_path if fine_path else '(none, rough-only)'}")
    print(f"output     -> {out_path}")

    graph = build_structure_graph(rough_doc, fine_doc, aspect_ratio=args.aspect_ratio)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=args.indent)

    print(f"\nsegments: {len(graph['segments'])}")
    print(f"shotSlots: {len(graph['shotSlots'])}")
    print(f"creativeIngredients: {len(graph['creativeIngredients'])}")
    print(f"edges: {len(graph['edges'])}")
    print(f"duration: {graph['meta']['duration']}s")
    print(f"videoType: {graph['meta']['videoType']}, style: {graph['meta']['style']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
