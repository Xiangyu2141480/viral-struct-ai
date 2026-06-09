#!/usr/bin/env python3
"""Analyze a directory of user-uploaded clips/images into **full** AssetCard[] JSON.

Step 2 of the migration pipeline (rewritten v2 — see
docs/asset-card-extraction-pipeline.md §11): each raw clip/image is sent to the
configured multimodal LLM **as native media** (video sampled server-side at
~5fps via the Files API), and the model returns rich semantics (per-moment
captions, observed actions, per-dimension perceptual quality, visualContent,
motionPotential, candidate slot roles). We combine that with local ffprobe
objective metadata + ffmpeg key-moment thumbnails into a COMPLETE AssetCard
(with a populated `analysis` block) so the card no longer relies on the TS
loader synthesizing a uniform-quality analysis at read time.

Schema source of truth: packages/shared/src/schemas.ts → AssetCardSchema.
Validation happens downstream when the card array is loaded
(AssetCardArraySchema.parse in apps/api/src/services/assetLibraryLoader.ts).

Reused infrastructure (do not reimplement):
  - scripts/llm_client.py        upload_file(fps), wait_for_file, create_response,
                                 gated_call + concurrency semaphores, extract_*,
                                 load_prompt_sections, load_dotenv, write_json
  - scripts/extract_media_technical.py  run_ffprobe / select_stream /
                                 classify_aspect_ratio / parse_frame_rate

Layout convention:

    seed_assets/asset_libraries/<library_id>/
      clips/                              # user-uploaded raw media (or --clips-dir)
      keyframes/                          # ffmpeg-extracted key-moment thumbnails (generated)
      asset_cards.json                    # generated full AssetCard[] (output)
      _debug/<assetId>_raw_response.json  # per-clip LLM dumps

Usage:
    python scripts/analyze_asset_library.py --library new_product_demo
    python scripts/analyze_asset_library.py --library xx --clips-dir path/to/clips
    python scripts/analyze_asset_library.py --library xx --max-concurrent 3 --dry-run
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_client import (  # noqa: E402
    configure_http_semaphore,
    create_response,
    env_value,
    extract_json_object,
    extract_response_text,
    gated_call,
    load_dotenv,
    load_prompt_sections,
    upload_file,
    wait_for_file,
    write_json,
)

# Objective media metadata (ffprobe). Best-effort: if unavailable we still emit a
# card, just without resolution-derived quality. Imported defensively so a missing
# helper never aborts the whole bake.
try:
    from extract_media_technical import (  # noqa: E402
        classify_aspect_ratio,
        parse_frame_rate,
        run_ffprobe,
        select_stream,
    )
    _HAS_PROBE = True
except Exception:  # noqa: BLE001
    _HAS_PROBE = False

ASSET_LIBRARIES_ROOT = Path("seed_assets/asset_libraries")
ANALYZED_AT = "1970-01-01T00:00:00.000Z"

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Enums copied from packages/shared/src/schemas.ts. Mirror here so a stray LLM
# value is filtered before Zod rejects the whole file downstream.
SHOT_SLOT_ROLES = {
    "opening_attention", "product_closeup", "usage_demo", "benefit_visual",
    "comparison", "testimonial", "cta_visual",
}
INGREDIENT_TYPES = {
    "human_presence", "face_closeup", "host_talking", "hand_demo",
    "beauty_demo", "makeup_application", "skin_texture_display",
    "before_after_comparison", "product_closeup_trait", "texture_display",
    "swatch_demo", "scene_style", "soft_light", "clean_background",
    "premium_visual", "trust_building", "social_proof",
    "professional_review", "lifestyle_context", "unknown",
}
ASSET_HUMAN_ROLES = {"host", "model", "user", "hand_only", "unknown"}
HUMAN_FRAMINGS = {
    "face_closeup", "half_body", "full_body", "hands", "skin_macro", "product_only",
}
ASSET_HUMAN_ACTIONS = {
    "talking", "applying_product", "showing_result", "swatching", "holding_product",
}
VISUAL_STYLE_TAGS = {
    "soft_light", "clean_background", "premium_visual",
    "lifestyle_context", "beauty_style", "professional_review",
}
ASSET_MANAGER_ROLES = {
    "opening_hook", "product_closeup", "usage_demo", "comparison", "benefit_proof",
    "lifestyle_scene", "background", "packaging_card", "cta", "cover",
}
ALL_SHOT_SLOT_ROLES = [
    "opening_attention", "product_closeup", "usage_demo", "benefit_visual",
    "comparison", "testimonial", "cta_visual",
]

# Mirrors optionalVlmAssetAnalyzer.detectUnsupportedClaims — reject efficacy/ranking
# /celebrity language so a hallucinated caption is never used as product proof.
_UNSAFE_CLAIM_PATTERNS = ("100%", "guarantee", "cure", "best", "销量第一", "第一", "最好", "保证", "治愈", "立刻见效")


# --------------------------------------------------------------------------- #
# File classification + upload payload
# --------------------------------------------------------------------------- #

def classify_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in VIDEO_EXTS:
        return "video"
    if suffix in IMAGE_EXTS:
        return "image"
    raise ValueError(f"unsupported media type: {path.name} (ext={suffix})")


def discover_clips(clips_dir: Path) -> list[Path]:
    if not clips_dir.exists():
        raise FileNotFoundError(f"clips dir not found: {clips_dir}")
    out: list[Path] = []
    for child in sorted(clips_dir.iterdir()):
        if child.is_file() and child.suffix.lower() in VIDEO_EXTS | IMAGE_EXTS:
            out.append(child)
    return out


def build_responses_payload_for_asset(
    *,
    model: str,
    file_id: str,
    media_type: str,
    prompt_text: str,
    instructions: str | None,
    temperature: float = 0.0,
) -> dict[str, Any]:
    content_block_type = "input_video" if media_type == "video" else "input_image"
    payload: dict[str, Any] = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": content_block_type, "file_id": file_id},
                    {"type": "input_text", "text": prompt_text},
                ],
            }
        ],
        "store": True,
        "temperature": temperature,
    }
    if instructions:
        payload["instructions"] = instructions
    return payload


# --------------------------------------------------------------------------- #
# Objective metadata (ffprobe) + adaptive sampling + keyframe extraction
# --------------------------------------------------------------------------- #

def probe_media(clip_path: Path, media_type: str) -> dict[str, Any]:
    """Best-effort objective metadata: width/height/fps/durationSec/aspectRatio/hasAudio."""
    info: dict[str, Any] = {
        "width": None, "height": None, "fps": None, "durationSec": None,
        "aspectRatio": "unknown", "hasAudio": None,
        "fileSizeBytes": clip_path.stat().st_size if clip_path.exists() else None,
        "format": (clip_path.suffix.lstrip(".").lower() or None),
    }
    if not _HAS_PROBE:
        return info
    try:
        probe = run_ffprobe(clip_path)
    except Exception:  # noqa: BLE001 — objective metadata is optional
        return info
    streams = probe.get("streams", []) or []
    video = select_stream(streams, "video")
    audio = select_stream(streams, "audio")
    info["hasAudio"] = bool(audio)
    if video:
        w = int(video.get("width") or 0)
        h = int(video.get("height") or 0)
        if w > 0:
            info["width"] = w
        if h > 0:
            info["height"] = h
        if w > 0 and h > 0:
            ar = classify_aspect_ratio(w, h)
            info["aspectRatio"] = ar if ar in ("9:16", "16:9", "1:1") else "unknown"
        fps = parse_frame_rate(video.get("r_frame_rate") or video.get("avg_frame_rate"))
        if fps and fps > 0:
            info["fps"] = round(fps, 3)
    try:
        dur = float(probe.get("format", {}).get("duration") or (video or {}).get("duration") or 0)
    except (TypeError, ValueError):
        dur = 0.0
    if dur and dur > 0:
        info["durationSec"] = round(dur, 3)
    return info


def resolve_upload_fps(base_fps: float, duration_sec: float | None) -> float:
    """Short clips get a higher sampling fps so brief actions (cap open, sip) aren't skipped."""
    if duration_sec and duration_sec > 0:
        if duration_sec < 6:
            return max(base_fps, 10.0)
        if duration_sec < 12:
            return max(base_fps, 8.0)
    return base_fps


def extract_keyframe(ffmpeg_path: str, clip_path: Path, time_sec: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [ffmpeg_path, "-y", "-hide_banner", "-loglevel", "error",
             "-ss", f"{max(0.0, time_sec):g}", "-i", str(clip_path),
             "-frames:v", "1", "-q:v", "2", str(out_path)],
            check=True, timeout=60,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return out_path.exists()
    except Exception:  # noqa: BLE001 — a missing thumbnail is non-fatal
        return False


# --------------------------------------------------------------------------- #
# Sanitization helpers
# --------------------------------------------------------------------------- #

def _filter_enum_list(values: Any, allowed: set[str]) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if isinstance(v, str) and v in allowed and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(v).strip() for v in values if isinstance(v, str) and str(v).strip()]


def _clamp01(value: Any, default: float = 0.5) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0.0, min(1.0, round(float(value), 3)))
    return default


def _avg(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def _strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_strip_none(v) for v in value]
    return value


def _has_unsafe_claim(*texts: str) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    return any(pat.lower() in blob for pat in _UNSAFE_CLAIM_PATTERNS)


def _score_resolution(width: int | None, height: int | None) -> float:
    if not width or not height:
        return 0.45
    px = width * height
    if px < 10_000:
        return 0.1
    if px < 250_000:
        return 0.35
    if px < 1_000_000:
        return 0.62
    if px < 2_000_000:
        return 0.78
    return 0.9


def _format_fit(aspect_ratio: str) -> float:
    return {"9:16": 0.92, "16:9": 0.76, "1:1": 0.68}.get(aspect_ratio, 0.55)


def _sanitize_human_presence(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    has_human = bool(value.get("hasHuman", False))
    out: dict[str, Any] = {"hasHuman": has_human}
    if not has_human:
        return out
    role = value.get("role")
    if isinstance(role, str) and role in ASSET_HUMAN_ROLES:
        out["role"] = role
    framing = _filter_enum_list(value.get("framing"), HUMAN_FRAMINGS)
    if framing:
        out["framing"] = framing
    actions = _filter_enum_list(value.get("actions"), ASSET_HUMAN_ACTIONS)
    if actions:
        out["actions"] = actions
    return out


def _sanitize_visual_content(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    primary = value.get("primarySubject")
    position = value.get("subjectPosition")
    if not isinstance(primary, str) or not isinstance(position, str):
        return None
    out: dict[str, Any] = {
        "primarySubject": primary.strip(),
        "subjectPosition": position.strip(),
        "kinematicElements": _str_list(value.get("kinematicElements")),
    }
    for opt in ("negativeSpace", "lighting"):
        v = value.get(opt)
        if isinstance(v, str) and v.strip():
            out[opt] = v.strip()
    palette = _str_list(value.get("colorPalette"))
    if palette:
        out["colorPalette"] = palette
    return out


def _sanitize_motion_potential(value: Any, media_type: str) -> dict[str, Any]:
    motion = value if isinstance(value, dict) else {}
    implicit = motion.get("implicitMotion")
    if implicit not in ("low", "medium", "high"):
        implicit = "high" if media_type == "video" else "medium"
    out: dict[str, Any] = {
        "isStill": bool(motion.get("isStill", media_type != "video")),
        "implicitMotion": implicit,
    }
    sim = _str_list(motion.get("canSimulateMotion"))
    if sim:
        out["canSimulateMotion"] = sim
    dur = motion.get("canSimulateDurationMs")
    if isinstance(dur, list) and len(dur) == 2 and all(isinstance(x, (int, float)) for x in dur):
        lo, hi = int(dur[0]), int(dur[1])
        if 0 < lo <= hi:
            out["canSimulateDurationMs"] = [lo, hi]
    return out


def _sanitize_candidate_roles(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for entry in value[:4]:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        if not (isinstance(role, str) and role in SHOT_SLOT_ROLES):
            continue
        item: dict[str, Any] = {"role": role, "confidence": _clamp01(entry.get("confidence"), 0.6)}
        caveat = entry.get("caveat")
        if isinstance(caveat, str) and caveat.strip():
            item["caveat"] = caveat.strip()[:120]
        out.append(item)
    return out


# --------------------------------------------------------------------------- #
# Keyframes from model-reported key moments
# --------------------------------------------------------------------------- #

def _build_keyframes(
    *,
    asset_id: str,
    media_type: str,
    clip_path: Path,
    parsed: dict[str, Any],
    duration_sec: float | None,
    frame_dir: Path,
    frame_url_prefix: str,
    ffmpeg_path: str,
    short_caption: str,
    max_frames: int,
) -> list[dict[str, Any]]:
    if media_type != "video":
        return []
    moments = parsed.get("keyMoments")
    cleaned: list[tuple[float, str]] = []
    if isinstance(moments, list):
        for m in moments:
            if not isinstance(m, dict):
                continue
            ts = m.get("timeSec")
            if not isinstance(ts, (int, float)) or isinstance(ts, bool):
                continue
            ts = float(ts)
            if duration_sec and duration_sec > 0:
                ts = max(0.0, min(ts, max(duration_sec - 0.1, 0.0)))
            caption = m.get("caption")
            cleaned.append((round(ts, 3), str(caption).strip() if isinstance(caption, str) else short_caption))
    # Fallback: model gave no usable moments -> uniform sampling so the card still
    # carries thumbnails (captioned with the whole-clip summary).
    if not cleaned and duration_sec and duration_sec > 0:
        n = min(max_frames, 5)
        cleaned = [(round((i + 1) * duration_sec / (n + 1), 3), short_caption) for i in range(n)]
    cleaned = sorted(cleaned, key=lambda x: x[0])[:max_frames]

    keyframes: list[dict[str, Any]] = []
    for index, (ts, caption) in enumerate(cleaned):
        kf: dict[str, Any] = {
            "id": f"{asset_id}_frame_{index + 1}",
            "timeSec": ts,
            "description": caption,
            "source": "sampled_frame",
        }
        out_path = frame_dir / f"{asset_id}_frame_{index + 1}.jpg"
        if extract_keyframe(ffmpeg_path, clip_path, ts, out_path):
            kf["url"] = f"{frame_url_prefix}/{out_path.name}"
        keyframes.append(kf)
    return keyframes


# --------------------------------------------------------------------------- #
# Full AssetCard assembly
# --------------------------------------------------------------------------- #

def build_full_card(
    *,
    asset_id: str,
    media_type: str,
    clip_path: Path,
    parsed: dict[str, Any],
    media_info: dict[str, Any],
    frame_dir: Path,
    frame_url_prefix: str,
    ffmpeg_path: str,
    max_frames: int,
) -> dict[str, Any]:
    url = str(clip_path).replace("\\", "/")

    spatial = parsed.get("spatialDescription") if isinstance(parsed.get("spatialDescription"), str) else None
    temporal = parsed.get("temporalDescription") if (media_type == "video" and isinstance(parsed.get("temporalDescription"), str)) else None
    short_caption = parsed.get("shortCaption") if isinstance(parsed.get("shortCaption"), str) else (spatial or f"{media_type} asset")

    # Safety: drop a caption that smuggled an unsupported claim; keep a neutral one.
    warnings: list[str] = []
    claim_risk = "low"
    if _has_unsafe_claim(short_caption, spatial or "", temporal or ""):
        warnings.append("Model caption contained unsupported product/efficacy claim language; replaced with neutral summary.")
        claim_risk = "medium"
        short_caption = f"{media_type} asset (caption withheld: unsupported claim)."
        spatial = spatial if spatial and not _has_unsafe_claim(spatial) else None
        temporal = temporal if temporal and not _has_unsafe_claim(temporal) else None

    suitable = _filter_enum_list(parsed.get("suitableSlots"), SHOT_SLOT_ROLES) or ["product_closeup"]
    detected_objects = _str_list(parsed.get("detectedObjects"))
    detected_ingredients = _filter_enum_list(parsed.get("detectedIngredients"), INGREDIENT_TYPES)
    style_tags = _filter_enum_list(parsed.get("visualStyleTags"), VISUAL_STYLE_TAGS)
    human_presence = _sanitize_human_presence(parsed.get("humanPresence"))
    visual_content = _sanitize_visual_content(parsed.get("visualContent"))
    motion_potential = _sanitize_motion_potential(parsed.get("motionPotential"), media_type)
    candidate_roles = _sanitize_candidate_roles(parsed.get("candidateSlotRoles"))
    if not candidate_roles:
        candidate_roles = [{"role": r, "confidence": 0.6} for r in suitable]
    manager_roles = _filter_enum_list(parsed.get("suggestedAssetManagerRoles"), ASSET_MANAGER_ROLES)
    risks = _str_list(parsed.get("risks"))

    width, height = media_info.get("width"), media_info.get("height")
    aspect = media_info.get("aspectRatio", "unknown")
    duration_sec = media_info.get("durationSec")

    keyframes = _build_keyframes(
        asset_id=asset_id, media_type=media_type, clip_path=clip_path, parsed=parsed,
        duration_sec=duration_sec, frame_dir=frame_dir, frame_url_prefix=frame_url_prefix,
        ffmpeg_path=ffmpeg_path, short_caption=short_caption, max_frames=max_frames,
    )

    # --- quality: objective resolution + model perceptual cues (no fixed constants) ---
    cues = parsed.get("qualityCues") if isinstance(parsed.get("qualityCues"), dict) else {}
    resolution = _score_resolution(width, height)
    sharpness = _clamp01(cues.get("sharpness"))
    brightness = _clamp01(cues.get("brightness"))
    contrast = _clamp01(cues.get("contrast"))
    composition = _clamp01(cues.get("composition"))
    lighting = _clamp01(cues.get("lighting"))
    subject_prominence = _clamp01(cues.get("subjectProminence"))
    product_focus = _clamp01(cues.get("productFocus"))
    text_safe_area = 0.7
    format_fit = _format_fit(aspect)
    clarity = _avg([resolution, sharpness])
    overall = _clamp01(parsed.get("qualityScore"), default=_avg([
        resolution, sharpness, brightness, contrast, composition, product_focus, text_safe_area, format_fit,
    ]))

    issues: list[dict[str, Any]] = []
    if resolution < 0.35:
        issues.append({"type": "low_resolution", "severity": "medium",
                       "message": "Resolution is below the recommended threshold for final short-video composition."})
    if overall < 0.5:
        issues.append({"type": "low_quality", "severity": "medium",
                       "message": "Overall quality estimate is below the recommended threshold."})
    if media_type == "video" and not keyframes:
        issues.append({"type": "no_motion_evidence", "severity": "low",
                       "message": "No key-moment thumbnails could be extracted for this video."})

    summary = short_caption if not temporal else f"{short_caption} {temporal}"

    semantic: dict[str, Any] = {
        "summary": summary[:400],
        "detectedObjects": detected_objects,
        "detectedIngredients": detected_ingredients,
        "visualStyleTags": style_tags,
        "humanPresence": human_presence,
        "visualContent": visual_content,
        "motionPotential": motion_potential,
    }

    media: dict[str, Any] = {
        "kind": media_type,
        "sourceUrl": url,
        "fileSizeBytes": media_info.get("fileSizeBytes"),
        "format": media_info.get("format"),
        "durationSec": duration_sec,
        "fps": media_info.get("fps"),
        "width": width,
        "height": height,
        "aspectRatio": aspect,
        "keyframes": keyframes,
        "hasAudio": media_info.get("hasAudio"),
        "fileExtension": media_info.get("format"),
    }

    slot_affordance = {
        "suitableSlots": suitable,
        "primaryRoles": candidate_roles,
        "missingRoles": [r for r in ALL_SHOT_SLOT_ROLES if r not in suitable],
        "rationale": "Derived from multimodal asset analysis (native-video understanding).",
    }
    editability = {
        "canCropZoom": True,
        "canUseAsBackground": overall >= 0.6,
        "canLoop": media_type == "video",
        "canExtendWithCards": True,
        "suggestedEdits": (["trim_to_highlight", "sample_keyframes", "add_caption_overlay"]
                           if media_type == "video" else ["crop_zoom", "ken_burns_motion", "add_caption_overlay"]),
    }
    safety = {
        "status": "needs_review" if claim_risk != "low" else "passed",
        "brandRisk": "low",
        "ipRisk": "low",
        "claimRisk": claim_risk,
        "reasons": risks,
    }
    search = {
        "tags": _dedupe([media_type, *detected_objects, *detected_ingredients, *style_tags, *suitable, *manager_roles]),
        "keywords": _dedupe([summary, *detected_objects, *suitable]),
        "embeddingText": " | ".join(t for t in [
            summary, " ".join(detected_objects), " ".join(suitable), " ".join(detected_ingredients),
        ] if t),
    }

    analysis = {
        "profileVersion": "asset_analysis_v1",
        "analyzedAt": ANALYZED_AT,
        "source": "llm_multimodal",
        "fallbackUsed": False,
        "warnings": warnings,
        "media": media,
        "semantic": semantic,
        "quality": {
            "overallScore": overall,
            "resolution": resolution,
            "sharpness": sharpness,
            "brightness": brightness,
            "contrast": contrast,
            "clarity": clarity,
            "composition": composition,
            "lighting": lighting,
            "subjectProminence": subject_prominence,
            "productFocus": product_focus,
            "textSafeArea": text_safe_area,
            "formatFit": format_fit,
            "issues": issues,
        },
        "slotAffordance": slot_affordance,
        "editability": editability,
        "safety": safety,
        "search": search,
    }

    card: dict[str, Any] = {
        "id": asset_id,
        "type": media_type,
        "url": url,
        "spatialDescription": spatial,
        "temporalDescription": temporal,
        "detectedObjects": detected_objects,
        "suitableSlots": suitable,
        "qualityScore": overall,
        "detectedIngredients": detected_ingredients or None,
        "humanPresence": human_presence,
        "visualStyleTags": style_tags or None,
        "visualContent": visual_content,
        "motionPotential": motion_potential,
        "candidateSlotRoles": candidate_roles,
        "analysisSource": "llm_multimodal",
        "analysis": analysis,
    }
    return _strip_none(card)


def build_fallback_card(
    *,
    asset_id: str,
    media_type: str,
    clip_path: Path,
    media_info: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    """Honest low-confidence card when visual analysis is unavailable — objective
    metadata only, no fabricated semantics."""
    url = str(clip_path).replace("\\", "/")
    width, height = media_info.get("width"), media_info.get("height")
    aspect = media_info.get("aspectRatio", "unknown")
    resolution = _score_resolution(width, height)
    overall = round(min(resolution, 0.4), 3)
    summary = f"Unanalyzed {media_type} asset (visual analysis unavailable)."

    analysis = {
        "profileVersion": "asset_analysis_v1",
        "analyzedAt": ANALYZED_AT,
        "source": "deterministic",
        "fallbackUsed": True,
        "warnings": [reason],
        "media": {
            "kind": media_type, "sourceUrl": url,
            "fileSizeBytes": media_info.get("fileSizeBytes"), "format": media_info.get("format"),
            "durationSec": media_info.get("durationSec"), "fps": media_info.get("fps"),
            "width": width, "height": height, "aspectRatio": aspect,
            "keyframes": [], "hasAudio": media_info.get("hasAudio"), "fileExtension": media_info.get("format"),
        },
        "semantic": {
            "summary": summary, "detectedObjects": [], "detectedIngredients": [], "visualStyleTags": [],
        },
        "quality": {
            "overallScore": overall, "resolution": resolution, "sharpness": 0.4, "brightness": 0.4,
            "contrast": 0.4, "clarity": round(_avg([resolution, 0.4]), 3), "composition": 0.4, "lighting": 0.4,
            "subjectProminence": 0.4, "productFocus": 0.4, "textSafeArea": 0.5, "formatFit": _format_fit(aspect),
            "issues": [{"type": "missing_metadata", "severity": "medium", "message": reason}],
        },
        "slotAffordance": {
            "suitableSlots": ["product_closeup"],
            "primaryRoles": [{"role": "product_closeup", "confidence": 0.3}],
            "missingRoles": [r for r in ALL_SHOT_SLOT_ROLES if r != "product_closeup"],
            "rationale": "Visual analysis unavailable; treat as weak coverage.",
        },
        "editability": {
            "canCropZoom": True, "canUseAsBackground": False, "canLoop": media_type == "video",
            "canExtendWithCards": True, "suggestedEdits": ["crop_zoom"],
        },
        "safety": {"status": "needs_review", "brandRisk": "low", "ipRisk": "low", "claimRisk": "low", "reasons": [reason]},
        "search": {"tags": [media_type], "keywords": [summary], "embeddingText": summary},
    }
    card = {
        "id": asset_id, "type": media_type, "url": url,
        "detectedObjects": [], "suitableSlots": ["product_closeup"], "qualityScore": overall,
        "analysisSource": "deterministic", "analysis": analysis,
    }
    return _strip_none(card)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        v = (v or "").strip()
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


# --------------------------------------------------------------------------- #
# Per-clip pipeline (probe -> adaptive upload -> classify -> assemble)
# --------------------------------------------------------------------------- #

def process_clip(
    *,
    clip_path: Path,
    asset_id: str,
    base_url: str,
    api_key: str,
    model: str,
    instructions: str | None,
    prompt_template: str,
    debug_dir: Path,
    frame_dir: Path,
    frame_url_prefix: str,
    ffmpeg_path: str,
    base_fps: float,
    max_frames: int,
    poll_interval: float,
    max_wait_seconds: float,
    response_timeout: int,
) -> dict[str, Any]:
    media_type = classify_media_type(clip_path)
    media_info = probe_media(clip_path, media_type)
    upload_fps = resolve_upload_fps(base_fps, media_info.get("durationSec")) if media_type == "video" else None

    prompt_text = (
        prompt_template
        .replace("{{assetId}}", asset_id)
        .replace("{{mediaType}}", media_type)
        .replace("{{filename}}", clip_path.name)
    )

    try:
        print(f"[{asset_id}] uploading {clip_path.name} ({media_type}, fps={upload_fps})")
        uploaded = gated_call(upload_file, base_url=base_url, api_key=api_key, video_path=clip_path, fps=upload_fps)
        file_id = uploaded["id"]
        ready = wait_for_file(
            base_url=base_url, api_key=api_key, file_id=file_id,
            poll_interval=poll_interval, max_wait_seconds=max_wait_seconds,
        )
        payload = build_responses_payload_for_asset(
            model=model, file_id=file_id, media_type=media_type,
            prompt_text=prompt_text, instructions=instructions,
        )
        response = gated_call(create_response, base_url=base_url, api_key=api_key, payload=payload, timeout=response_timeout)
        response_text = extract_response_text(response)
        parsed = extract_json_object(response_text)
        write_json(debug_dir / f"{asset_id}_raw_response.json",
                   {"uploaded": uploaded, "ready": ready, "mediaInfo": media_info, "response": response})
        if not isinstance(parsed, dict):
            raise ValueError("model did not return a JSON object")
        card = build_full_card(
            asset_id=asset_id, media_type=media_type, clip_path=clip_path, parsed=parsed,
            media_info=media_info, frame_dir=frame_dir, frame_url_prefix=frame_url_prefix,
            ffmpeg_path=ffmpeg_path, max_frames=max_frames,
        )
        kf = len(card.get("analysis", {}).get("media", {}).get("keyframes", []))
        print(f"[{asset_id}] analyzed -> slots={card.get('suitableSlots')} q={card.get('qualityScore')} keyframes={kf}")
        return card
    except Exception as exc:  # noqa: BLE001 — emit an honest fallback rather than dropping the asset
        reason = f"visual analysis failed: {exc!r}"
        print(f"[{asset_id}] FALLBACK: {reason}", file=sys.stderr)
        return build_fallback_card(asset_id=asset_id, media_type=media_type, clip_path=clip_path, media_info=media_info, reason=reason)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def run(args: argparse.Namespace) -> int:
    library_root = ASSET_LIBRARIES_ROOT / args.library
    clips_dir = Path(args.clips_dir) if args.clips_dir else (library_root / "clips")
    out_path = Path(args.out) if args.out else (library_root / "asset_cards.json")
    debug_dir = library_root / "_debug"
    frame_dir = Path(args.frame_dir) if args.frame_dir else (library_root / "keyframes")
    frame_url_prefix = args.frame_url_prefix or f"seed_assets/asset_libraries/{args.library}/keyframes"

    clips = discover_clips(clips_dir)
    if not clips:
        print(f"no clips found under {clips_dir}", file=sys.stderr)
        return 2

    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    model = args.model or env_value("LLM_MODEL", env_values)

    missing = [n for n, v in {"LLM_BASE_URL": base_url, "LLM_API_KEY": api_key, "LLM_MODEL": model}.items() if not v]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    instructions, prompt_template = load_prompt_sections(args.prompt, {})

    if args.dry_run:
        preview = {
            "library": args.library,
            "clipsDir": str(clips_dir),
            "outPath": str(out_path),
            "frameDir": str(frame_dir),
            "clipCount": len(clips),
            "clips": [c.name for c in clips],
            "ffprobeAvailable": _HAS_PROBE,
            "promptInstructionsPreview": (instructions or "")[:240],
            "promptUserPreview": prompt_template[:240],
        }
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    configure_http_semaphore(args.max_concurrent_http)

    cards: list[dict[str, Any]] = []
    errors: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=args.max_concurrent) as pool:
        futures = {}
        for index, clip_path in enumerate(clips, start=1):
            asset_id = args.id_prefix + f"{index:03d}"
            fut = pool.submit(
                process_clip,
                clip_path=clip_path,
                asset_id=asset_id,
                base_url=base_url,
                api_key=api_key,
                model=model,
                instructions=instructions,
                prompt_template=prompt_template,
                debug_dir=debug_dir,
                frame_dir=frame_dir,
                frame_url_prefix=frame_url_prefix,
                ffmpeg_path=args.ffmpeg,
                base_fps=args.upload_fps,
                max_frames=args.max_frames,
                poll_interval=args.poll_interval,
                max_wait_seconds=args.max_wait_seconds,
                response_timeout=args.response_timeout,
            )
            futures[fut] = (asset_id, clip_path)

        for fut in as_completed(futures):
            asset_id, clip_path = futures[fut]
            try:
                cards.append(fut.result())
            except Exception as exc:  # noqa: BLE001 — last-resort guard
                errors.append((asset_id, f"{clip_path.name}: {exc!r}"))
                print(f"[{asset_id}] HARD-FAILED: {exc!r}", file=sys.stderr)

    cards.sort(key=lambda c: c["id"])
    write_json(out_path, cards)
    fallback_count = sum(1 for c in cards if c.get("analysisSource") == "deterministic")
    print(f"\nWrote {len(cards)} AssetCard(s) -> {out_path}  ({fallback_count} honest-fallback)")
    if errors:
        print(f"WARNING: {len(errors)} clip(s) hard-failed:", file=sys.stderr)
        for asset_id, msg in errors:
            print(f"  - {asset_id}: {msg}", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Classify a directory of clips/images into full AssetCard[] JSON (multimodal).")
    p.add_argument("--library", required=True, help="Asset library id (subdir under seed_assets/asset_libraries/).")
    p.add_argument("--clips-dir", help="Override input clips dir (default: <library_root>/clips).")
    p.add_argument("--out", help="Override output JSON path (default: <library_root>/asset_cards.json).")
    p.add_argument("--frame-dir", help="Override keyframe output dir (default: <library_root>/keyframes).")
    p.add_argument("--frame-url-prefix", help="URL prefix stored on keyframes (default: seed_assets/asset_libraries/<lib>/keyframes).")
    p.add_argument("--prompt", default="prompts/asset_library/asset_card_v2.md")
    p.add_argument("--id-prefix", default="asset_", help="Prefix for generated asset ids (default: asset_).")
    p.add_argument("--env", default=".env")
    p.add_argument("--base-url")
    p.add_argument("--api-key")
    p.add_argument("--model")
    p.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg binary for keyframe extraction.")
    p.add_argument("--upload-fps", type=float, default=5, help="Base sampling fps for video uploads (short clips auto-raise).")
    p.add_argument("--max-frames", type=int, default=6, help="Max key-moment thumbnails per video.")
    p.add_argument("--poll-interval", type=float, default=5)
    p.add_argument("--max-wait-seconds", type=float, default=300)
    p.add_argument("--response-timeout", type=int, default=300)
    p.add_argument("--max-concurrent", type=int, default=3, help="ThreadPoolExecutor worker count for clip-level parallelism.")
    p.add_argument("--max-concurrent-http", type=int, default=5, help="Global HTTP semaphore cap.")
    p.add_argument("--dry-run", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
