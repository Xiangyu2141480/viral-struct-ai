#!/usr/bin/env python
"""Run the first-pass rough video structure scan via the configured LLM/VLM provider.

The script uploads a prepared preview video through the Files API, waits for
preprocessing, sends it to the Responses API with the rough-structure prompt,
and stores both raw and parsed outputs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# scripts/ is on sys.path[0] when this file is run as __main__; sibling
# imports also work when loaded via importlib.spec_from_file_location
# because both fine_scan / extract_speech register scripts/ before
# importing us. Keep this explicit import close to where DEFAULT_VIDEO_ID
# is consumed so the dependency is obvious.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm_client import (  # noqa: E402
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
    write_text,
)
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_DEFAULT_PATHS = analysis_paths(DEFAULT_VIDEO_ID)

# Prompt versions: v0 is the original ad-framed prompt; v1 is the genre-neutral
# (de-biased) prompt that no longer pre-asserts an e-commerce/ad genre, so a
# tutorial/course is labeled with instructional coarse roles at the source.
PROMPT_BY_VERSION = {
    "v0": "prompts/video_understanding/rough_structure_scan_v0.md",
    "v1": "prompts/video_understanding/rough_structure_scan_v1.md",
}


def resolve_prompt_path(args: argparse.Namespace) -> str:
    """Resolve the rough-scan prompt path. An explicit ``--prompt`` always wins;
    otherwise ``--prompt-version`` selects between v0 (ad-framed) and v1
    (genre-neutral / de-biased)."""
    if args.prompt:
        return args.prompt
    return PROMPT_BY_VERSION[args.prompt_version]


def build_responses_payload(
    *,
    model: str,
    file_id: str,
    prompt_text: str,
    instructions: str | None = None,
    store: bool = True,
    temperature: float = 0.0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_video",
                        "file_id": file_id,
                    },
                    {
                        "type": "input_text",
                        "text": prompt_text,
                    },
                ],
            }
        ],
        "store": store,
        "temperature": temperature,
    }
    if instructions:
        payload["instructions"] = instructions
    return payload


def _time_range_start(value: dict[str, Any]) -> float:
    time_range = value.get("timeRange") or {}
    if isinstance(time_range, dict) and time_range.get("start") is not None:
        return float(time_range["start"])
    return 0.0


# Fields removed in v0.2 (see docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md).
# We strip them defensively in case the LLM still produces them from old prompts
# cached in any conversational state.
_KILL_CONTENT_BLOCK_FIELDS = (
    "audioOrRhythmSignals",  # 5fps preview has no audio track; LLM hallucinates
    "hasInternalTransition",  # empirically 100% true, zero information entropy
    "confidence",  # empirically 0.85-0.98, never calibrated, zero downstream reads
)


def normalize_content_blocks(content_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, block in enumerate(sorted(content_blocks, key=_time_range_start), start=1):
        item = dict(block)
        item.setdefault("id", f"block_{index:03d}")
        item.setdefault("timeRange", {})
        item.setdefault("coarseRoleGuess", "unknown")
        item.setdefault("boundaryReason", "")
        item.setdefault("observableSummary", "")
        item.setdefault("visualSignals", [])
        item.setdefault("textSignals", [])
        item.setdefault("fineScanFocusQuestions", [])
        for legacy_field in _KILL_CONTENT_BLOCK_FIELDS:
            item.pop(legacy_field, None)
        normalized.append(item)
    return normalized


def _boundary_anchor_time(boundary: dict[str, Any]) -> float:
    return float(boundary["roughBoundaryTime"])


# Fields removed in v0.2 (see docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md).
_KILL_BOUNDARY_FIELDS = (
    "whyNeedsMicroscope",  # boilerplate generator, redundant with visibleBoundaryCue
    "confidence",  # zero downstream reads, no consumption contract
)


def normalize_boundary_candidates(
    boundary_candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not boundary_candidates:
        raise ValueError("Stage 1 rough scan output must include boundaryCandidates.")

    normalized_boundaries: list[dict[str, Any]] = []
    for index, boundary in enumerate(sorted(boundary_candidates, key=_boundary_anchor_time), start=1):
        normalized_boundary = dict(boundary)
        normalized_boundary.setdefault("id", f"boundary_{index:03d}")
        boundary_time = _boundary_anchor_time(normalized_boundary)
        normalized_boundary.setdefault("roughBoundaryTime", boundary_time)
        # v2.5: canonicalBoundaryTime is the single source of truth for boundary
        # time across all stages. At rough stage it equals roughBoundaryTime;
        # Stage 1.5 may override it with the more accurate semanticPivotTime.
        # See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §4.1 (D1).
        normalized_boundary["canonicalBoundaryTime"] = boundary_time
        normalized_boundary.setdefault(
            "inspectionWindow",
            {"start": round(max(0.0, boundary_time - 2.5), 3), "end": round(boundary_time + 2.5, 3)},
        )
        for legacy_field in _KILL_BOUNDARY_FIELDS:
            normalized_boundary.pop(legacy_field, None)
        normalized_boundaries.append(normalized_boundary)
    return normalized_boundaries


def _migrate_global_notes_subject_rename(global_notes: dict[str, Any]) -> None:
    """v3 (Phase 3): rename ``likelyProductFirstSeenAt`` → ``likelySubjectFirstSeenAt``.

    "Subject" generalizes across categories where the focal entity isn't always
    a product (course, local service, person, lifestyle moment). The old key
    is migrated forward and removed; the new key is canonical.
    """
    old_key = "likelyProductFirstSeenAt"
    new_key = "likelySubjectFirstSeenAt"
    if old_key in global_notes:
        legacy_value = global_notes.pop(old_key)
        # Only seed new key if LLM didn't already provide it (prefer new value).
        global_notes.setdefault(new_key, legacy_value)


def normalize_rough_scan(parsed: dict[str, Any]) -> dict[str, Any]:
    """Normalize the Stage 1 content-block contract.

    v0.2 (2026-05-23): strip KILL fields from roughSummary and globalNotes
    if the LLM still produces them. See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md.

    v3 (Phase 3): migrate likelyProductFirstSeenAt → likelySubjectFirstSeenAt
    for cross-category support (course, local_service, lifestyle, etc.).
    """
    normalized = json.loads(json.dumps(parsed, ensure_ascii=False))

    rough_summary = normalized.get("roughSummary")
    if isinstance(rough_summary, dict):
        # globalConversionLogic: LLM invents business logic from 5fps preview
        rough_summary.pop("globalConversionLogic", None)

    global_notes = normalized.get("globalNotes")
    if isinstance(global_notes, dict):
        # likelyHookWindow == contentBlocks[0].timeRange (100% redundant)
        # likelyCtaRegion == contentBlocks[-1].timeRange (100% redundant)
        # importantOpenQuestions ⊂ Σ contentBlocks[*].fineScanFocusQuestions
        for legacy_field in ("likelyHookWindow", "likelyCtaRegion", "importantOpenQuestions"):
            global_notes.pop(legacy_field, None)
        _migrate_global_notes_subject_rename(global_notes)

    content_blocks = normalized.get("contentBlocks")
    if not isinstance(content_blocks, list):
        raise ValueError("Stage 1 rough scan output must include contentBlocks.")

    normalized["schemaVersion"] = normalized.get("schemaVersion") or "rough_content_blocks_v1"
    content_blocks = normalize_content_blocks(content_blocks)
    boundary_candidates = normalize_boundary_candidates(
        normalized.get("boundaryCandidates", []) or [],
    )

    normalized["contentBlocks"] = content_blocks
    normalized["boundaryCandidates"] = boundary_candidates

    return normalized


def redact_config(values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    if result.get("LLM_API_KEY"):
        result["LLM_API_KEY"] = "***"
    return result


def run_scan(args: argparse.Namespace) -> int:
    # Resolve --prompt-version -> concrete path before anything reads args.prompt
    # (mirrors fine_scan.run_fine_scan).
    args.prompt = resolve_prompt_path(args)
    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    model = args.model or env_value("LLM_MODEL", env_values)

    missing = [name for name, value in {
        "LLM_BASE_URL": base_url,
        "LLM_API_KEY": api_key,
        "LLM_MODEL": model,
    }.items() if not value]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    variables = {
        "videoId": args.video_id,
        "durationSeconds": args.duration,
        "previewFps": args.preview_fps,
        "previewWidth": args.preview_width,
        "previewHeight": args.preview_height,
    }
    instructions, prompt_text = load_prompt_sections(args.prompt, variables)

    if args.dry_run:
        preview = {
            "config": redact_config({
                "LLM_BASE_URL": base_url,
                "LLM_API_KEY": api_key,
                "LLM_MODEL": model,
            }),
            "video": str(args.video),
            "prompt": str(args.prompt),
            "uploadFps": args.upload_fps,
            "instructionsPreview": instructions[:240] if instructions else None,
            "promptPreview": prompt_text[:500],
        }
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    if args.file_id:
        file_id = args.file_id
        file_info = {"id": file_id, "source": "provided"}
    else:
        print(f"Uploading video: {args.video}")
        file_info = gated_call(
            upload_file,
            base_url=base_url,
            api_key=api_key,
            video_path=args.video,
            fps=args.upload_fps,
        )
        file_id = file_info["id"]
        print(f"Uploaded file_id: {file_id}")

    print(f"Waiting for file preprocessing: {file_id}")
    ready_file = gated_call(
        wait_for_file,
        base_url=base_url,
        api_key=api_key,
        file_id=file_id,
        poll_interval=args.poll_interval,
        max_wait_seconds=args.max_wait_seconds,
    )
    print(f"File status: {ready_file.get('status', 'unknown')}")

    payload = build_responses_payload(
        model=model,
        file_id=file_id,
        prompt_text=prompt_text,
        instructions=instructions,
        store=True,
    )
    print("Calling Responses API for rough structure scan...")
    response = gated_call(
        create_response,
        base_url=base_url,
        api_key=api_key,
        payload=payload,
        timeout=args.response_timeout,
    )

    response_text = extract_response_text(response)
    parsed = normalize_rough_scan(extract_json_object(response_text))

    write_json(args.out, parsed)
    write_json(args.raw_out, response)
    write_text(args.text_out, response_text)
    write_json(args.file_info_out, {"uploaded": file_info, "ready": ready_file})

    print(f"Saved parsed scan: {args.out}")
    print(f"Saved raw response: {args.raw_out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Upload a prepared preview video to the configured LLM/VLM provider and run first-pass rough structure scanning.",
    )
    parser.add_argument(
        "--video",
        default=str(_DEFAULT_PATHS.preview_video),
        help="Prepared 5 FPS preview video.",
    )
    parser.add_argument(
        "--prompt",
        default=None,
        help="Prompt markdown file (explicit override; otherwise --prompt-version selects).",
    )
    parser.add_argument(
        "--prompt-version",
        choices=["v0", "v1"],
        default="v1",
        help="Rough-scan prompt version: v1 (genre-neutral / de-biased, DEFAULT) "
             "or v0 (legacy ad-framed). v1 promoted after A/B showed it fixes "
             "tutorial role-labeling (feature_or_claim×8 -> tutorial_step) with "
             "zero change to ad-video classification. Ignored if --prompt is given.",
    )
    parser.add_argument("--video-id", default=DEFAULT_VIDEO_ID)
    parser.add_argument("--duration", type=float, default=229.53)
    parser.add_argument("--preview-fps", type=float, default=5)
    parser.add_argument("--preview-width", type=int, default=720)
    parser.add_argument("--preview-height", type=int, default=406)
    parser.add_argument("--upload-fps", type=float, default=5)
    parser.add_argument("--env", default=".env")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key")
    parser.add_argument("--model")
    parser.add_argument("--file-id", help="Reuse an existing uploaded file id instead of uploading.")
    parser.add_argument("--poll-interval", type=float, default=5)
    parser.add_argument("--max-wait-seconds", type=float, default=300)
    parser.add_argument("--response-timeout", type=int, default=600)
    # v0.2 directory layout: stage1_rough/ for primary contract, _debug/ for dumps.
    # See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §5.1.
    parser.add_argument("--out", default=str(_DEFAULT_PATHS.rough_scan))
    parser.add_argument("--raw-out", default=str(_DEFAULT_PATHS.rough_raw_response))
    parser.add_argument("--text-out", default=str(_DEFAULT_PATHS.rough_response_text))
    parser.add_argument("--file-info-out", default=str(_DEFAULT_PATHS.uploaded_file_info))
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run_scan(args)


if __name__ == "__main__":
    raise SystemExit(main())
