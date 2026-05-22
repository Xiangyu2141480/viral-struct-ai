#!/usr/bin/env python
"""Run Stage 2 fine analysis for Stage 1 content blocks."""

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

from doubao_rough_scan import (  # noqa: E402
    build_responses_payload,
    create_response,
    env_value,
    extract_json_object,
    extract_response_text,
    load_dotenv,
    load_prompt_sections,
    upload_file,
    wait_for_file,
    write_json,
    write_text,
)
from video_tools import build_clip_command  # noqa: E402


SOURCE_CLIP_MODE = "source_quality_clip"
SOURCE_UPLOAD_SAMPLING = "provider_default_source_video"
SOURCE_CLIP_RESOLUTION = "source"


def block_time_range(block: dict[str, Any]) -> tuple[float, float]:
    time_range = block["timeRange"]
    start = float(time_range["start"])
    end = float(time_range["end"])
    if end <= start:
        raise ValueError(f"content block end must be after start: {block.get('id')}")
    return start, end


def load_beat_map(path: str | Path) -> dict[str, Any] | None:
    beat_map_path = Path(path)
    if not beat_map_path.exists():
        return None
    return json.loads(beat_map_path.read_text(encoding="utf-8"))


def rough_video_duration(blocks: list[dict[str, Any]]) -> float:
    if not blocks:
        raise ValueError("contentBlocks cannot be empty")
    return max(block_time_range(block)[1] for block in blocks)


def _tempo_bpm(beat_map: dict[str, Any]) -> float | None:
    tempo = beat_map.get("tempo")
    if isinstance(tempo, dict) and tempo.get("bpm") is not None:
        return float(tempo["bpm"])
    return None


def _beat_source(beat_map: dict[str, Any]) -> str:
    method = beat_map.get("method")
    if isinstance(method, dict) and method.get("primary"):
        return str(method["primary"])
    return "beat_this"


def build_block_audio_analysis(
    beat_map: dict[str, Any],
    *,
    start: float,
    end: float,
    beat_map_ref: str,
) -> dict[str, Any]:
    beat_markers: list[dict[str, Any]] = []
    for beat in beat_map.get("beats", []) or []:
        abs_time = float(beat["time"])
        if start <= abs_time <= end:
            rel_ms = int(round((abs_time - start) * 1000))
            abs_ms = int(round(abs_time * 1000))
            beat_markers.append(
                {
                    "tMs": rel_ms,
                    "absTimeMs": abs_ms,
                    "beatNumber": beat.get("beatNumber"),
                    "isDownbeat": bool(beat.get("isDownbeat")),
                }
            )

    return {
        "source": _beat_source(beat_map),
        "sourceBeatMapRef": beat_map_ref,
        "timeBasis": "content_block_relative_ms",
        "bpm": _tempo_bpm(beat_map),
        "beatTimestampsMs": [marker["tMs"] for marker in beat_markers],
        "downbeatTimestampsMs": [
            marker["tMs"] for marker in beat_markers if marker["isDownbeat"]
        ],
        "beatMarkers": beat_markers,
    }


def run_ffmpeg(command: list[str], *, dry_run: bool = False) -> None:
    if dry_run:
        print(json.dumps({"ffmpeg": command}, ensure_ascii=False))
        return
    subprocess.run(command, check=True, capture_output=True)


def prepare_block_clip(
    video_path: str | Path,
    block: dict[str, Any],
    work_dir: Path,
    *,
    dry_run: bool = False,
) -> Path:
    block_id = block["id"]
    start, end = block_time_range(block)
    suffix = "source"
    output_path = work_dir / f"{block_id}_{suffix}.mp4"
    if output_path.exists() and not dry_run:
        return output_path
    work_dir.mkdir(parents=True, exist_ok=True)

    command = build_clip_command(
        video_path,
        output_path,
        start=start,
        end=end,
        mode="copy",
    )
    run_ffmpeg(command, dry_run=dry_run)
    return output_path


def build_block_prompt_variables(
    block: dict[str, Any],
    *,
    video_id: str,
    video_duration: float,
) -> dict[str, Any]:
    """Render block context for the fine_structure_scan v0.3 prompt.

    v0.3 is semantic-only: no audio beat array, no millisecond timing fields
    needed by the model. Code-owned timing comes from visual_peak_detector
    + peak_micro_scan, merged at aggregate time.
    """
    start, end = block_time_range(block)
    if video_duration <= 0:
        raise ValueError("video_duration must be positive")
    return {
        "videoId": video_id,
        "blockId": block["id"],
        "sourceStart": start,
        "sourceEnd": end,
        "blockDuration": round(end - start, 3),
        "sourceVideoDuration": round(video_duration, 3),
        "normalizedStart": round(start / video_duration, 4),
        "normalizedEnd": round(end / video_duration, 4),
        "clipMode": SOURCE_CLIP_MODE,
        "uploadSampling": SOURCE_UPLOAD_SAMPLING,
        "clipResolution": SOURCE_CLIP_RESOLUTION,
        "coarseRoleGuess": block.get("coarseRoleGuess", "unknown"),
        "boundaryReason": block.get("boundaryReason", ""),
        "observableSummary": block.get("observableSummary", ""),
        "fineScanFocusQuestions": json.dumps(
            block.get("fineScanFocusQuestions", []), ensure_ascii=False
        ),
    }


def aggregate_peak_semantics(
    *,
    visual_peaks: list[dict[str, Any]],
    semantic_results: list[dict[str, Any]],
    audio_beats_ms: list[int],
    tolerance_ms: int = 120,
) -> list[dict[str, Any]]:
    """Join code-owned visual peaks with model-owned semantic results.

    Produces the final actionBeats list with timing entirely owned by the code
    layer. The model contributes only semantics (semanticAction, actionType,
    beforeState, afterState, relativePositionBucket, confidence).

    Rules:
      - Drop semantic results where isMeaningfulAction is False.
      - Match by peakId; semantic results referencing unknown peakIds are
        ignored (model hallucination guard).
      - Final timing (anchorMs, timeRangeMs, nearestAudioBeatMs, deltaMs,
        isBeatAligned) is computed by code, not by the model.
      - beatId is assigned sequentially in time order (beat_001, beat_002, ...).

    Each visual_peak must have: peakId, tMs, windowMs={start,end}, prominence,
    motionScore. Optional: channels, anchorSource (defaults to "visual_peak").
    """
    peaks_by_id: dict[str, dict[str, Any]] = {
        str(peak["peakId"]): peak for peak in visual_peaks
    }

    kept: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for result in semantic_results:
        peak_id = str(result.get("peakId", ""))
        if not result.get("isMeaningfulAction", False):
            continue
        if peak_id not in peaks_by_id:
            continue
        kept.append((peaks_by_id[peak_id], result))

    kept.sort(key=lambda pair: int(pair[0]["tMs"]))

    beats: list[dict[str, Any]] = []
    for order, (peak, result) in enumerate(kept, start=1):
        anchor_ms = int(peak["tMs"])
        alignment = align_anchor_to_audio_beat(
            anchor_ms=anchor_ms,
            audio_beats_ms=audio_beats_ms,
            tolerance_ms=tolerance_ms,
        )
        beat: dict[str, Any] = {
            "beatId": f"beat_{order:03d}",
            "semanticAction": result["semanticAction"],
            "actionType": result["actionType"],
            "beforeState": result["beforeState"],
            "afterState": result["afterState"],
            "relativePositionBucket": result["relativePositionBucket"],
            "anchorMs": anchor_ms,
            "timeRangeMs": dict(peak["windowMs"]),
            "anchorSource": peak.get("anchorSource", "visual_peak"),
            "nearestAudioBeatMs": alignment["nearestAudioBeatMs"],
            "deltaMs": alignment["deltaMs"],
            "isBeatAligned": alignment["isBeatAligned"],
            "alignmentToleranceMs": alignment["alignmentToleranceMs"],
            "anchorConfidence": float(result.get("confidence", 0.0)),
            "visualPeak": {
                "peakId": peak["peakId"],
                "prominence": float(peak.get("prominence", 0.0)),
                "motionScore": float(peak.get("motionScore", 0.0)),
                "channels": list(peak.get("channels", [])),
            },
        }
        beats.append(beat)
    return beats


def align_anchor_to_audio_beat(
    *,
    anchor_ms: int,
    audio_beats_ms: list[int],
    tolerance_ms: int = 120,
) -> dict[str, Any]:
    """Find the nearest audio beat for a code-owned visual anchor.

    Returns a dict with nearestAudioBeatMs / deltaMs / isBeatAligned /
    alignmentToleranceMs. deltaMs = anchor - nearest (positive = anchor is later
    than the beat). When audio_beats_ms is empty, all alignment fields are None
    and isBeatAligned is False.
    """
    if not audio_beats_ms:
        return {
            "nearestAudioBeatMs": None,
            "deltaMs": None,
            "isBeatAligned": False,
            "alignmentToleranceMs": int(tolerance_ms),
        }

    nearest = min(audio_beats_ms, key=lambda value: abs(int(anchor_ms) - int(value)))
    delta = int(anchor_ms) - int(nearest)
    return {
        "nearestAudioBeatMs": int(nearest),
        "deltaMs": delta,
        "isBeatAligned": abs(delta) <= int(tolerance_ms),
        "alignmentToleranceMs": int(tolerance_ms),
    }


def selected_blocks(blocks: list[dict[str, Any]], block_ids: str) -> list[dict[str, Any]]:
    if not block_ids:
        return blocks
    wanted = {item.strip() for item in block_ids.split(",") if item.strip()}
    return [block for block in blocks if block["id"] in wanted]


def run_fine_scan(args: argparse.Namespace) -> int:
    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    model = args.model or env_value("LLM_MODEL", env_values)
    missing = [
        name
        for name, value in {"LLM_BASE_URL": base_url, "LLM_API_KEY": api_key, "LLM_MODEL": model}.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    rough_scan_path = Path(args.rough_scan)
    if not rough_scan_path.exists():
        raise SystemExit(f"Rough scan file not found: {rough_scan_path}")

    video_path = Path(args.video)
    if not video_path.exists():
        raise SystemExit(f"Source video file not found: {video_path}")

    rough_scan = json.loads(rough_scan_path.read_text(encoding="utf-8"))
    video_id = args.video_id or rough_scan.get("videoId", "video")
    all_blocks = rough_scan.get("contentBlocks")
    if not isinstance(all_blocks, list):
        raise SystemExit("Fine scan requires Stage 1 contentBlocks.")
    video_duration = rough_video_duration(all_blocks)
    blocks = selected_blocks(all_blocks, args.block_ids)
    if not blocks:
        print("No content blocks to process.")
        return 0

    out_dir = Path(args.out_dir)
    work_dir = Path(args.work_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    beat_map = None if args.skip_audio else load_beat_map(args.beat_map)
    if not args.skip_audio and beat_map is None:
        print(f"Beat-This beat map not found: {args.beat_map}")

    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for block in blocks:
        block_id = block["id"]
        start, end = block_time_range(block)
        print(f"\n-- {block_id} ({start}s ~ {end}s, coarseRole={block.get('coarseRoleGuess')}) --")

        print("   strategy=source_quality cut=stream_copy resolution=source sampling=provider_default")

        if args.dry_run:
            dry_path = work_dir / f"{block_id}_dry.mp4"
            command = build_clip_command(
                args.video,
                dry_path,
                start=start,
                end=end,
                mode="copy",
            )
            print(json.dumps({"block": block_id, "ffmpegCommand": command}, ensure_ascii=False, indent=2))
            continue

        clip_path = prepare_block_clip(args.video, block, work_dir)
        print(f"   clip -> {clip_path}")

        audio_result = (
            build_block_audio_analysis(beat_map, start=start, end=end, beat_map_ref=args.beat_map)
            if beat_map
            else None
        )
        if audio_result:
            print(
                f"   bpm={audio_result['bpm']} beats={len(audio_result['beatTimestampsMs'])}"
                f" downbeats={len(audio_result['downbeatTimestampsMs'])}"
            )

        variables = build_block_prompt_variables(
            block,
            video_id=video_id,
            video_duration=video_duration,
        )
        instructions, prompt_text = load_prompt_sections(args.prompt, variables)

        print("   uploading clip...")
        file_info = upload_file(base_url=base_url, api_key=api_key, video_path=clip_path, fps=None)
        file_id = file_info["id"]
        print(f"   file_id={file_id}")

        ready_file = wait_for_file(
            base_url=base_url,
            api_key=api_key,
            file_id=file_id,
            poll_interval=args.poll_interval,
            max_wait_seconds=args.max_wait_seconds,
        )
        print(f"   status={ready_file.get('status', 'unknown')}")

        response = create_response(
            base_url=base_url,
            api_key=api_key,
            payload=build_responses_payload(
                model=model,
                file_id=file_id,
                prompt_text=prompt_text,
                instructions=instructions,
                store=True,
            ),
            timeout=args.response_timeout,
        )
        response_text = extract_response_text(response)

        try:
            parsed = extract_json_object(response_text)
        except Exception as exc:
            error_message = str(exc)
            print(f"   [ERROR] JSON parse failed for {block_id}: {error_message}")
            failures.append({"blockId": block_id, "error": error_message})
            write_text(out_dir / f"{block_id}_fine_scan_response_text.txt", response_text)
            continue

        if audio_result and isinstance(parsed, dict) and "audioAnalysis" not in parsed:
            parsed["audioAnalysis"] = audio_result

        block_out = out_dir / f"{block_id}_fine_scan.json"
        write_json(block_out, parsed)
        print(f"   saved -> {block_out}")
        results.append(parsed)

    if results:
        combined_path = out_dir / "fine_structure_scan.json"
        write_json(
            combined_path,
            {
                "videoId": video_id,
                "scanMode": "fine_content_blocks",
                "roughScanRef": str(args.rough_scan),
                "blockCount": len(results),
                "contentBlocks": results,
            },
        )
        print(f"\nSaved combined scan -> {combined_path}")

    if failures:
        failure_path = out_dir / "fine_scan_failures.json"
        write_json(
            failure_path,
            {
                "videoId": video_id,
                "failedBlockCount": len(failures),
                "failures": failures,
            },
        )
        print(f"\nFine scan failed for {len(failures)} content block(s); details -> {failure_path}")
        return 1

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stage 2 fine content-block analysis using Doubao/ModelArk.")
    parser.add_argument("--rough-scan", default="seed_assets/analysis/macbook_neo/rough_structure_scan.json")
    parser.add_argument("--video", default="seed_assets/raw_videos/macbook_neo.mp4")
    parser.add_argument("--beat-map", default="seed_assets/analysis/macbook_neo/audio_beat_map.json")
    parser.add_argument("--video-id", default="")
    parser.add_argument("--prompt", default="prompts/video_understanding/fine_structure_scan_v0.md")
    parser.add_argument("--out-dir", default="seed_assets/analysis/macbook_neo/fine_scan")
    parser.add_argument("--work-dir", default="seed_assets/analysis/macbook_neo/fine_scan/clips")
    parser.add_argument("--block-ids", default="", help="Comma-separated content block IDs to process.")
    parser.add_argument("--skip-audio", action="store_true")
    parser.add_argument("--env", default=".env")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--poll-interval", type=float, default=5)
    parser.add_argument("--max-wait-seconds", type=float, default=300)
    parser.add_argument("--response-timeout", type=int, default=600)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    return run_fine_scan(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
