#!/usr/bin/env python3
"""Analyze a directory of user-uploaded clips/images into AssetCard[] JSON.

Step 2 of the migration pipeline: given a folder of raw media uploaded for
a new product, classify each file via Doubao/ModelArk into the AssetCard
schema consumed by slotMatcher (apps/api/src/services/slotMatcher.ts).

Schema source of truth: packages/shared/src/schemas.ts → AssetCardSchema.
Validation happens downstream when POST /api/slots/match parses the input.

Layout convention (kept local; not added to path_layout.py because asset
libraries are per-target-product, not per-source-video):

    seed_assets/asset_libraries/<library_id>/
      clips/                              # user-uploaded raw media
        clip_001.mp4
        clip_002.jpg
      asset_cards.json                    # generated AssetCard[] (output)
      _debug/<assetId>_raw_response.json  # per-clip LLM dumps

Usage:
    python scripts/analyze_asset_library.py --library new_product_demo
    python scripts/analyze_asset_library.py --library xx --clips-dir path/to/clips
    python scripts/analyze_asset_library.py --library xx --max-concurrent 3 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from doubao_rough_scan import (  # noqa: E402
    api_url,
    build_multipart_body,
    configure_http_semaphore,
    create_response,
    env_value,
    extract_json_object,
    extract_response_text,
    gated_call,
    load_dotenv,
    load_prompt_sections,
    request_json,
    upload_file,
    wait_for_file,
    write_json,
)

ASSET_LIBRARIES_ROOT = Path("seed_assets/asset_libraries")

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Enums copied from packages/shared/src/schemas.ts. Mirror here so a stray
# LLM value can be filtered before Zod rejects the whole file downstream.
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
    "face_closeup", "half_body", "full_body", "hands",
    "skin_macro", "product_only",
}
ASSET_HUMAN_ACTIONS = {
    "talking", "applying_product", "showing_result",
    "swatching", "holding_product",
}
VISUAL_STYLE_TAGS = {
    "soft_light", "clean_background", "premium_visual",
    "lifestyle_context", "beauty_style", "professional_review",
}


# --------------------------------------------------------------------------- #
# File classification + upload
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
        if not child.is_file():
            continue
        if child.suffix.lower() in VIDEO_EXTS | IMAGE_EXTS:
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
    """Same shape as doubao_rough_scan.build_responses_payload but switches
    input content block between input_video and input_image so the model
    receives the right modality marker."""
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
# LLM output sanitization
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


def _coerce_quality_score(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0.0, min(1.0, float(value)))
    return 0.5  # neutral default if LLM omits or returns garbage


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


def _strip_none(value: Any) -> Any:
    """Recursively drop keys whose value is None — Zod .optional() expects
    omitted fields, not JSON null."""
    if isinstance(value, dict):
        return {k: _strip_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_strip_none(v) for v in value]
    return value


def normalize_asset_card(
    *,
    asset_id: str,
    media_type: str,
    parsed: dict[str, Any],
) -> dict[str, Any]:
    """Map raw LLM JSON into AssetCardSchema-shaped dict."""
    spatial = parsed.get("spatialDescription") if isinstance(parsed.get("spatialDescription"), str) else None
    temporal_raw = parsed.get("temporalDescription")
    temporal = temporal_raw if (media_type == "video" and isinstance(temporal_raw, str)) else None

    suitable = _filter_enum_list(parsed.get("suitableSlots"), SHOT_SLOT_ROLES)
    if not suitable:
        suitable = ["product_closeup"]  # AssetCardSchema requires at least the field present; default to neutral

    detected_objects = parsed.get("detectedObjects")
    if not isinstance(detected_objects, list):
        detected_objects = []
    else:
        detected_objects = [str(o) for o in detected_objects if isinstance(o, str)]

    card: dict[str, Any] = {
        "id": asset_id,
        "type": media_type,
        "spatialDescription": spatial,
        "temporalDescription": temporal,
        "detectedObjects": detected_objects,
        "suitableSlots": suitable,
        "qualityScore": _coerce_quality_score(parsed.get("qualityScore")),
        "detectedIngredients": _filter_enum_list(parsed.get("detectedIngredients"), INGREDIENT_TYPES) or None,
        "humanPresence": _sanitize_human_presence(parsed.get("humanPresence")),
        "visualStyleTags": _filter_enum_list(parsed.get("visualStyleTags"), VISUAL_STYLE_TAGS) or None,
    }
    return _strip_none(card)


# --------------------------------------------------------------------------- #
# Per-clip pipeline (upload → wait → classify → sanitize)
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
    poll_interval: float,
    max_wait_seconds: float,
    response_timeout: int,
    upload_fps: float | None,
) -> dict[str, Any]:
    media_type = classify_media_type(clip_path)
    fps = upload_fps if media_type == "video" else None
    prompt_text = (
        prompt_template
        .replace("{{assetId}}", asset_id)
        .replace("{{mediaType}}", media_type)
        .replace("{{filename}}", clip_path.name)
    )

    print(f"[{asset_id}] uploading {clip_path.name} ({media_type})")
    uploaded = gated_call(
        upload_file,
        base_url=base_url,
        api_key=api_key,
        video_path=clip_path,
        fps=fps,
    )
    file_id = uploaded["id"]

    ready = wait_for_file(
        base_url=base_url,
        api_key=api_key,
        file_id=file_id,
        poll_interval=poll_interval,
        max_wait_seconds=max_wait_seconds,
    )
    print(f"[{asset_id}] file ready (status={ready.get('status', 'unknown')})")

    payload = build_responses_payload_for_asset(
        model=model,
        file_id=file_id,
        media_type=media_type,
        prompt_text=prompt_text,
        instructions=instructions,
    )
    response = gated_call(
        create_response,
        base_url=base_url,
        api_key=api_key,
        payload=payload,
        timeout=response_timeout,
    )

    response_text = extract_response_text(response)
    parsed = extract_json_object(response_text)
    card = normalize_asset_card(asset_id=asset_id, media_type=media_type, parsed=parsed)

    write_json(debug_dir / f"{asset_id}_raw_response.json", {
        "uploaded": uploaded,
        "ready": ready,
        "response": response,
    })
    print(f"[{asset_id}] classified -> suitableSlots={card.get('suitableSlots')} quality={card.get('qualityScore')}")
    return card


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def run(args: argparse.Namespace) -> int:
    library_root = ASSET_LIBRARIES_ROOT / args.library
    clips_dir = Path(args.clips_dir) if args.clips_dir else (library_root / "clips")
    out_path = Path(args.out) if args.out else (library_root / "asset_cards.json")
    debug_dir = library_root / "_debug"

    clips = discover_clips(clips_dir)
    if not clips:
        print(f"no clips found under {clips_dir}", file=sys.stderr)
        return 2

    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    model = args.model or env_value("LLM_MODEL", env_values)

    missing = [n for n, v in {
        "LLM_BASE_URL": base_url, "LLM_API_KEY": api_key, "LLM_MODEL": model,
    }.items() if not v]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    instructions, prompt_template = load_prompt_sections(args.prompt, {})

    if args.dry_run:
        preview = {
            "library": args.library,
            "clipsDir": str(clips_dir),
            "outPath": str(out_path),
            "clipCount": len(clips),
            "clips": [c.name for c in clips],
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
                poll_interval=args.poll_interval,
                max_wait_seconds=args.max_wait_seconds,
                response_timeout=args.response_timeout,
                upload_fps=args.upload_fps,
            )
            futures[fut] = (asset_id, clip_path)

        for fut in as_completed(futures):
            asset_id, clip_path = futures[fut]
            try:
                cards.append(fut.result())
            except Exception as exc:  # noqa: BLE001 — log and keep going
                errors.append((asset_id, f"{clip_path.name}: {exc!r}"))
                print(f"[{asset_id}] FAILED: {exc!r}", file=sys.stderr)

    cards.sort(key=lambda c: c["id"])
    write_json(out_path, cards)
    print(f"\nWrote {len(cards)} AssetCard(s) -> {out_path}")
    if errors:
        print(f"WARNING: {len(errors)} clip(s) failed:", file=sys.stderr)
        for asset_id, msg in errors:
            print(f"  - {asset_id}: {msg}", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Classify a directory of clips/images into AssetCard[] JSON.",
    )
    p.add_argument("--library", required=True,
                   help="Asset library id (subdir under seed_assets/asset_libraries/).")
    p.add_argument("--clips-dir",
                   help="Override input clips dir (default: <library_root>/clips).")
    p.add_argument("--out",
                   help="Override output JSON path (default: <library_root>/asset_cards.json).")
    p.add_argument("--prompt",
                   default="prompts/asset_library/asset_card_v0.md")
    p.add_argument("--id-prefix", default="asset_",
                   help="Prefix for generated asset ids (default: asset_).")
    p.add_argument("--env", default=".env")
    p.add_argument("--base-url")
    p.add_argument("--api-key")
    p.add_argument("--model")
    p.add_argument("--upload-fps", type=float, default=5,
                   help="Sampling fps for video uploads (ignored for images).")
    p.add_argument("--poll-interval", type=float, default=5)
    p.add_argument("--max-wait-seconds", type=float, default=300)
    p.add_argument("--response-timeout", type=int, default=300)
    p.add_argument("--max-concurrent", type=int, default=3,
                   help="ThreadPoolExecutor worker count for clip-level parallelism.")
    p.add_argument("--max-concurrent-http", type=int, default=5,
                   help="Global HTTP semaphore cap (shared with rough/fine scan style).")
    p.add_argument("--dry-run", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
