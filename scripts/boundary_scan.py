#!/usr/bin/env python
"""Run Stage 1.5 boundary microscope shot localization.

Stage 1.5 reads Stage 1 `contentBlocks + boundaryCandidates`, creates a slow
microscope clip for each boundary, normalizes all timing context to the
microscope timeline, asks the VLM to locate micro-shots, then maps results back
to original-video time.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_client import (  # noqa: E402
    create_response,
    env_value,
    extract_json_object,
    extract_response_text,
    load_dotenv,
    load_prompt_sections,
    upload_file,
    wait_for_file,
    write_json,
)
from rough_scan import build_responses_payload  # noqa: E402
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402
from video_tools import build_microscope_command, build_probe_command  # noqa: E402


def round_time(value: float) -> float:
    return round(float(value), 3)


def parse_frame_rate(value: str) -> float:
    text = str(value).strip()
    if not text or text == "0/0":
        raise ValueError("empty frame rate")
    if "/" not in text:
        fps = float(text)
    else:
        numerator_text, denominator_text = text.split("/", 1)
        numerator = float(numerator_text)
        denominator = float(denominator_text)
        if denominator == 0:
            raise ValueError("frame rate denominator cannot be zero")
        fps = numerator / denominator
    if fps <= 0:
        raise ValueError("frame rate must be positive")
    return fps


def source_video_fps(probe_data: dict[str, Any]) -> float:
    for stream in probe_data.get("streams", []) or []:
        if stream.get("codec_type") != "video":
            continue
        for key in ("avg_frame_rate", "r_frame_rate"):
            try:
                return parse_frame_rate(str(stream.get(key, "")))
            except ValueError:
                continue
    raise ValueError("could not determine source video fps from ffprobe data")


def derive_slowdown_factor(probe_data: dict[str, Any], *, upload_fps: float) -> float:
    if upload_fps <= 0:
        raise ValueError("upload_fps must be positive")
    return source_video_fps(probe_data) / upload_fps


def probe_video(path: str | Path) -> dict[str, Any]:
    result = subprocess.run(
        build_probe_command(path),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def build_time_mapping(*, window_start: float, window_end: float, slowdown_factor: float) -> dict[str, Any]:
    if window_end <= window_start:
        raise ValueError("window_end must be greater than window_start")
    if slowdown_factor <= 0:
        raise ValueError("slowdown_factor must be positive")
    return {
        "windowOriginalTimeRange": {
            "start": round_time(window_start),
            "end": round_time(window_end),
        },
        "slowdownFactor": float(slowdown_factor),
        "microscopeDuration": round_time((window_end - window_start) * slowdown_factor),
    }


def original_to_microscope(original_time: float, mapping: dict[str, Any]) -> float:
    window_start = float(mapping["windowOriginalTimeRange"]["start"])
    slowdown_factor = float(mapping["slowdownFactor"])
    return round_time((float(original_time) - window_start) * slowdown_factor)


def microscope_to_original(microscope_time: float, mapping: dict[str, Any]) -> float:
    window_start = float(mapping["windowOriginalTimeRange"]["start"])
    slowdown_factor = float(mapping["slowdownFactor"])
    return round_time(window_start + float(microscope_time) / slowdown_factor)


def microscope_range_to_original(time_range: dict[str, Any], mapping: dict[str, Any]) -> dict[str, float]:
    return {
        "start": microscope_to_original(float(time_range["start"]), mapping),
        "end": microscope_to_original(float(time_range["end"]), mapping),
    }


def _by_id(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("id")): item for item in items if item.get("id")}


def find_boundary(rough_scan: dict[str, Any], boundary_id: str) -> dict[str, Any]:
    boundaries = _by_id(rough_scan.get("boundaryCandidates", []) or [])
    if boundary_id not in boundaries:
        raise KeyError(f"boundary not found: {boundary_id}")
    return boundaries[boundary_id]


def block_summary(block: dict[str, Any]) -> str:
    return str(block.get("observableSummary") or block.get("summary") or "")


def beats_in_window(beat_map: dict[str, Any], mapping: dict[str, Any], *, key: str) -> list[dict[str, Any]]:
    start = float(mapping["windowOriginalTimeRange"]["start"])
    end = float(mapping["windowOriginalTimeRange"]["end"])
    result: list[dict[str, Any]] = []
    for beat in beat_map.get(key, []) or []:
        original_time = float(beat["time"])
        if start <= original_time <= end:
            item = dict(beat)
            item["originalTime"] = round_time(original_time)
            item["microscopeTime"] = original_to_microscope(original_time, mapping)
            result.append(item)
    return result


def nearest_event(events: list[dict[str, Any]], target_time: float) -> dict[str, Any] | None:
    if not events:
        return None
    return min(events, key=lambda event: abs(float(event["microscopeTime"]) - target_time))


def build_normalized_beat_map(
    beat_map: dict[str, Any],
    mapping: dict[str, Any],
    *,
    rough_boundary_microscope_time: float,
) -> dict[str, Any]:
    beats = beats_in_window(beat_map, mapping, key="beats")
    downbeats = beats_in_window(beat_map, mapping, key="downbeats")
    nearest = nearest_event(beats, rough_boundary_microscope_time)
    nearest_downbeat = nearest_event(downbeats, rough_boundary_microscope_time)
    return {
        "source": beat_map.get("method", {}).get("primary") or beat_map.get("source") or "beat_this",
        "beats": beats,
        "downbeats": downbeats,
        "nearestBeatToRoughBoundary": build_nearest_payload(nearest, rough_boundary_microscope_time),
        "nearestDownbeatToRoughBoundary": build_nearest_payload(nearest_downbeat, rough_boundary_microscope_time),
    }


def build_nearest_payload(event: dict[str, Any] | None, target_time: float) -> dict[str, Any] | None:
    if event is None:
        return None
    offset_ms = int(round((float(event["microscopeTime"]) - target_time) * 1000))
    return {
        "microscopeTime": event["microscopeTime"],
        "originalTime": event["originalTime"],
        "offsetMs": offset_ms,
        "isDownbeat": bool(event.get("isDownbeat")),
        "beatNumber": event.get("beatNumber"),
    }


def build_boundary_normalized_input(
    rough_scan: dict[str, Any],
    *,
    boundary_id: str,
    beat_map: dict[str, Any] | None,
    slowdown_factor: float,
    clip_path: str | Path,
) -> dict[str, Any]:
    boundary = find_boundary(rough_scan, boundary_id)
    blocks = _by_id(rough_scan.get("contentBlocks", []) or [])
    from_block = blocks.get(str(boundary.get("fromBlockId")), {})
    to_block = blocks.get(str(boundary.get("toBlockId")), {})
    window = boundary.get("inspectionWindow") or {}
    window_start = float(window["start"])
    window_end = float(window["end"])
    mapping = build_time_mapping(
        window_start=window_start,
        window_end=window_end,
        slowdown_factor=slowdown_factor,
    )
    rough_boundary = original_to_microscope(float(boundary["roughBoundaryTime"]), mapping)
    normalized_input = {
        "boundaryId": boundary_id,
        "microscopeVideo": {
            "path": str(clip_path),
            "duration": mapping["microscopeDuration"],
        },
        "timeMapping": mapping,
        "microscopeTimeline": {
            "duration": mapping["microscopeDuration"],
            "slowdownFactor": slowdown_factor,
            "timeUnit": "seconds",
            "timeOrigin": "microscope_video_start",
        },
        "sourceContext": {
            "fromBlockId": boundary.get("fromBlockId", ""),
            "fromBlockSummary": block_summary(from_block),
            "fromBlockCoarseRole": from_block.get("coarseRoleGuess", "unknown"),
            "toBlockId": boundary.get("toBlockId", ""),
            "toBlockSummary": block_summary(to_block),
            "toBlockCoarseRole": to_block.get("coarseRoleGuess", "unknown"),
            "stage1VisibleCue": boundary.get("visibleBoundaryCue", "unknown"),
            "stage1WhyNeedsMicroscope": boundary.get("whyNeedsMicroscope", "unknown"),
        },
        "normalizedBoundaryPrior": {
            "roughBoundaryTime": rough_boundary,
            "inspectionWindow": {"start": 0.0, "end": mapping["microscopeDuration"]},
        },
        "normalizedBeatMap": build_normalized_beat_map(
            beat_map or {},
            mapping,
            rough_boundary_microscope_time=rough_boundary,
        ),
    }
    return normalized_input


def normalize_time_range_field(value: dict[str, Any], mapping: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(value)
    if isinstance(value.get("microscopeTimeRange"), dict):
        normalized["originalTimeRange"] = microscope_range_to_original(value["microscopeTimeRange"], mapping)
    return normalized


def semantic_pivot_original_time(model_output: dict[str, Any], mapping: dict[str, Any]) -> float | None:
    pivot = model_output.get("semanticPivotMicroscopeTime")
    if pivot is None:
        return None
    return microscope_to_original(float(pivot), mapping)


def build_timeline_patch(
    *,
    boundary_id: str,
    normalized_input: dict[str, Any],
    model_output: dict[str, Any],
    transition_candidate: dict[str, Any],
) -> dict[str, Any]:
    source_context = normalized_input.get("sourceContext", {})
    from_block_id = str(source_context.get("fromBlockId", ""))
    to_block_id = str(source_context.get("toBlockId", ""))
    mapping = normalized_input["timeMapping"]

    if transition_candidate.get("exists") and transition_candidate.get("originalTimeRange"):
        transition_range = transition_candidate["originalTimeRange"]
        transition_start = float(transition_range["start"])
        transition_end = float(transition_range["end"])
        return {
            "patchType": "insert_transition_unit",
            "fromBlockId": from_block_id,
            "toBlockId": to_block_id,
            "fromBlockPatch": {
                "id": from_block_id,
                "timeRangePatch": {"end": round_time(transition_start)},
            },
            "transitionUnit": {
                "id": f"transition_{boundary_id}",
                "unitType": "transition",
                "timeRange": {
                    "start": round_time(transition_start),
                    "end": round_time(transition_end),
                },
                "visualChange": transition_candidate.get("visualChange", ""),
                "techniqueTags": transition_candidate.get("techniqueTags", []),
                "confidence": transition_candidate.get("confidence"),
                "semanticPivotTime": semantic_pivot_original_time(model_output, mapping),
            },
            "toBlockPatch": {
                "id": to_block_id,
                "timeRangePatch": {"start": round_time(transition_end)},
            },
        }

    pivot = semantic_pivot_original_time(model_output, mapping)
    return {
        "patchType": "adjust_content_boundary",
        "fromBlockId": from_block_id,
        "toBlockId": to_block_id,
        "contentBoundaryTime": pivot,
        "fromBlockPatch": {
            "id": from_block_id,
            "timeRangePatch": {"end": pivot},
        },
        "toBlockPatch": {
            "id": to_block_id,
            "timeRangePatch": {"start": pivot},
        },
    }


def normalize_boundary_model_output(
    model_output: dict[str, Any],
    normalized_input: dict[str, Any],
) -> dict[str, Any]:
    mapping = normalized_input["timeMapping"]
    boundary_id = str(model_output.get("boundaryId") or normalized_input["boundaryId"])
    transition_candidate = normalize_time_range_field(
        model_output.get("transitionCandidate", {"exists": False}),
        mapping,
    )
    normalized = {
        "boundaryId": boundary_id,
        "timeMapping": mapping,
        "microShots": [
            normalize_time_range_field(micro_shot, mapping)
            for micro_shot in model_output.get("microShots", []) or []
        ],
        "transitionCandidate": transition_candidate,
        "timelinePatch": build_timeline_patch(
            boundary_id=boundary_id,
            normalized_input=normalized_input,
            model_output=model_output,
            transition_candidate=transition_candidate,
        ),
    }
    return normalized


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def redact_api_config(config: dict[str, str]) -> dict[str, str]:
    redacted = dict(config)
    if redacted.get("api_key"):
        redacted["api_key"] = "***"
    return redacted


def boundary_ids(rough_scan: dict[str, Any], selected: list[str] | None) -> list[str]:
    if selected:
        return selected
    return [str(boundary["id"]) for boundary in rough_scan.get("boundaryCandidates", []) or []]


def boundary_output_dir(root: str | Path, boundary_id: str) -> Path:
    return Path(root) / boundary_id


def build_clip_path(out_dir: str | Path, boundary_id: str) -> Path:
    return boundary_output_dir(out_dir, boundary_id) / "microscope_clip.mp4"


def build_prompt_variables(normalized_input: dict[str, Any]) -> dict[str, str]:
    return {
        "boundaryId": str(normalized_input["boundaryId"]),
        "normalizedInput": json.dumps(normalized_input, ensure_ascii=False, indent=2),
    }


def run_command(command: list[str], *, dry_run: bool = False) -> None:
    if dry_run:
        print(json.dumps({"command": command}, ensure_ascii=False, indent=2))
        return
    subprocess.run(command, check=True)


def process_boundary(
    *,
    boundary_id: str,
    rough_scan: dict[str, Any],
    video_path: str | Path,
    beat_map: dict[str, Any] | None,
    prompt_path: str | Path,
    out_dir: str | Path,
    slowdown_factor: float,
    upload_fps: float,
    max_width: int,
    crf: int,
    dry_run: bool,
    api_config: dict[str, str] | None = None,
) -> dict[str, Any]:
    boundary = find_boundary(rough_scan, boundary_id)
    window = boundary["inspectionWindow"]
    clip_path = build_clip_path(out_dir, boundary_id)
    boundary_dir = clip_path.parent
    boundary_dir.mkdir(parents=True, exist_ok=True)
    command = build_microscope_command(
        video_path,
        clip_path,
        start=float(window["start"]),
        end=float(window["end"]),
        playback_fps=upload_fps,
        max_width=max_width,
        crf=crf,
    )
    normalized_input = build_boundary_normalized_input(
        rough_scan,
        boundary_id=boundary_id,
        beat_map=beat_map,
        slowdown_factor=slowdown_factor,
        clip_path=clip_path,
    )
    write_json(boundary_dir / "microscope_input.json", normalized_input)
    write_json(boundary_dir / "microscope_clip_command.json", {"command": command})

    if dry_run:
        return {
            "boundaryId": boundary_id,
            "status": "dry_run",
            "microscopeInput": str(boundary_dir / "microscope_input.json"),
            "clipCommand": command,
        }

    run_command(command)
    if api_config is None:
        raise ValueError("api_config is required when dry_run is false")

    instructions, prompt_text = load_prompt_sections(prompt_path, build_prompt_variables(normalized_input))
    upload = upload_file(
        base_url=api_config["base_url"],
        api_key=api_config["api_key"],
        video_path=clip_path,
        fps=upload_fps,
    )
    file_id = upload.get("id") or upload.get("file_id")
    if not file_id:
        raise RuntimeError(f"upload response did not include file id: {upload}")
    wait_for_file(base_url=api_config["base_url"], api_key=api_config["api_key"], file_id=file_id)
    response = create_response(
        base_url=api_config["base_url"],
        api_key=api_config["api_key"],
        payload=build_responses_payload(
            model=api_config["model"],
            file_id=file_id,
            prompt_text=prompt_text,
            instructions=instructions,
        ),
    )
    model_output = extract_json_object(extract_response_text(response))
    normalized_output = normalize_boundary_model_output(model_output, normalized_input)
    write_json(boundary_dir / "model_output.json", model_output)
    write_json(boundary_dir / "raw_response.json", response)
    write_json(boundary_dir / "normalized_output.json", normalized_output)
    return normalized_output


def run_boundary_scan(args: argparse.Namespace) -> int:
    rough_scan = load_json(args.rough_scan)
    beat_map = None if args.skip_beats else load_json(args.beat_map) if Path(args.beat_map).exists() else None
    slowdown_factor = (
        float(args.slowdown_factor)
        if args.slowdown_factor is not None
        else derive_slowdown_factor(probe_video(args.video), upload_fps=args.upload_fps)
    )
    env_values = load_dotenv(args.env)
    api_config = {
        "base_url": args.base_url or env_value("LLM_BASE_URL", env_values),
        "api_key": args.api_key or env_value("LLM_API_KEY", env_values),
        "model": args.model or env_value("LLM_MODEL", env_values),
    }
    if args.dry_run:
        print(
            json.dumps(
                {
                    "config": redact_api_config(api_config),
                    "timing": {
                        "uploadFps": args.upload_fps,
                        "slowdownFactor": round_time(slowdown_factor),
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        missing = [name for name, value in api_config.items() if not value]
        if missing:
            raise SystemExit(f"Missing required config: {', '.join(missing)}")

    results = []
    for boundary_id in boundary_ids(rough_scan, args.boundary_id):
        print(f"== {boundary_id} ==")
        result = process_boundary(
            boundary_id=boundary_id,
            rough_scan=rough_scan,
            video_path=args.video,
            beat_map=beat_map,
            prompt_path=args.prompt,
            out_dir=args.out_dir,
            slowdown_factor=slowdown_factor,
            upload_fps=args.upload_fps,
            max_width=args.max_width,
            crf=args.crf,
            dry_run=args.dry_run,
            api_config=api_config,
        )
        results.append(result)

    write_json(Path(args.out_dir) / "boundary_micro_scan.json", {
        "videoId": rough_scan.get("videoId", "unknown"),
        "schemaVersion": "boundary_micro_scan_v1",
        "dryRun": bool(args.dry_run),
        "boundaries": results,
    })
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    _paths = analysis_paths(DEFAULT_VIDEO_ID)
    parser.add_argument("--rough-scan", default=str(_paths.rough_scan))
    parser.add_argument("--video", default=str(_paths.raw_video))
    parser.add_argument("--beat-map", default=str(_paths.audio_beat_map))
    parser.add_argument("--prompt", default="prompts/video_understanding/boundary_micro_scan_v0.md")
    parser.add_argument("--out-dir", default=str(_paths.boundary_scan_dir))
    parser.add_argument("--boundary-id", action="append", help="Scan only this boundary id. Repeatable.")
    parser.add_argument("--slowdown-factor", type=float, default=None)
    parser.add_argument("--upload-fps", type=float, default=5.0)
    parser.add_argument("--max-width", type=int, default=720)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--env", default=".env")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--skip-beats", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    return run_boundary_scan(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
