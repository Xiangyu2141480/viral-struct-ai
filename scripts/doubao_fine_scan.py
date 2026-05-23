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
from video_tools import build_clip_command, build_peak_window_command  # noqa: E402
from visual_peak_detector import (  # noqa: E402
    compute_visual_score_series_from_clip,
    detect_regime_boundaries_from_scores,
    detect_visual_peaks_from_scores,
    merge_peak_and_regime_candidates,
    select_peaks_for_block,
)


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


def audio_beats_ms_in_block_abs(
    beat_map: dict[str, Any],
    *,
    block_start_s: float,
    block_end_s: float,
) -> list[int]:
    """Return audio beat times (absolute ms) falling inside [block_start_s, block_end_s]."""
    out: list[int] = []
    for beat in beat_map.get("beats", []) or []:
        t = float(beat["time"])
        if block_start_s <= t <= block_end_s:
            out.append(int(round(t * 1000)))
    return out


def relative_position_bucket(
    t_block_rel_ms: int,
    *,
    block_duration_ms: int,
) -> str:
    """Map a block-relative time (ms) to one of five position buckets."""
    if block_duration_ms <= 0:
        return "mid"
    ratio = float(t_block_rel_ms) / float(block_duration_ms)
    if ratio < 0.2:
        return "early"
    if ratio < 0.4:
        return "mid_early"
    if ratio < 0.6:
        return "mid"
    if ratio < 0.8:
        return "mid_late"
    return "late"


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
    failures: list[dict[str, Any]] = []

    for block in blocks:
        block_outcome, block_failure = process_block_with_peak_micro(
            block,
            args=args,
            video_id=video_id,
            video_duration=video_duration,
            beat_map=beat_map,
            base_url=base_url,
            api_key=api_key,
            model=model,
            out_dir=out_dir,
            work_dir=work_dir,
        )
        if block_outcome is not None:
            results.append(block_outcome)
        if block_failure is not None:
            failures.append(block_failure)

    if results:
        combined_path = out_dir / "fine_structure_scan.json"
        write_json(
            combined_path,
            {
                "videoId": video_id,
                "scanMode": "fine_content_blocks_semantic_v0_3",
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


def process_block_with_peak_micro(
    block: dict[str, Any],
    *,
    args: argparse.Namespace,
    video_id: str,
    video_duration: float,
    beat_map: dict[str, Any] | None,
    base_url: str,
    api_key: str,
    model: str,
    out_dir: Path,
    work_dir: Path,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Run one content block through the v0.3 peak-micro pipeline.

    Returns (block_output, block_failure). At most one is non-None.
    """
    block_id = block["id"]
    start, end = block_time_range(block)
    block_start_ms = int(round(start * 1000))
    block_end_ms = int(round(end * 1000))
    block_duration_ms = block_end_ms - block_start_ms

    print(f"\n-- {block_id} ({start}s ~ {end}s, coarseRole={block.get('coarseRoleGuess')}) --")

    if args.dry_run:
        dry_path = work_dir / f"{block_id}_dry.mp4"
        command = build_clip_command(args.video, dry_path, start=start, end=end, mode="copy")
        print(json.dumps({"block": block_id, "blockClipCommand": command}, ensure_ascii=False, indent=2))
        return None, None

    # Step 1: cut block clip
    clip_path = prepare_block_clip(args.video, block, work_dir)
    print(f"   clip -> {clip_path}")

    # Step 2: visual peak detection (code-only, no API)
    try:
        samples = compute_visual_score_series_from_clip(
            str(clip_path), target_fps=args.peak_sample_fps,
        )
    except Exception as exc:
        msg = f"peak score extraction failed: {exc}"
        print(f"   [ERROR] {msg}")
        return None, {"blockId": block_id, "stage": "peak_score", "error": str(exc)}

    all_peaks = detect_visual_peaks_from_scores(
        samples,
        min_distance_ms=args.peak_min_distance_ms,
        min_prominence=args.peak_min_prominence,
    )
    selected_peaks = select_peaks_for_block(
        all_peaks,
        block_duration_ms=block_duration_ms,
        peaks_per_second=args.peaks_per_second,
        max_peaks=args.max_peaks,
        min_block_seconds=args.min_block_seconds,
        boundary_guard_ms=args.peak_boundary_guard_ms,
    )

    # T13/T14: also detect regime boundaries (motion_start / motion_end) and
    # merge them with peaks as complementary candidates for events the
    # peak detector structurally cannot catch (settling, sustained motion ends).
    regimes = detect_regime_boundaries_from_scores(
        samples,
        penalty=args.regime_penalty,
    )
    # Filter regimes to honor the same boundary guard as peaks.
    regimes_guarded = [
        r for r in regimes
        if args.peak_boundary_guard_ms <= int(r["tMs"]) <= block_duration_ms - args.peak_boundary_guard_ms
    ]
    candidates = merge_peak_and_regime_candidates(
        selected_peaks, regimes_guarded,
        dedup_window_ms=args.regime_dedup_window_ms,
    )
    # Cap total candidates to bound Doubao call count per block.
    if len(candidates) > args.max_total_candidates:
        capped = sorted(candidates, key=lambda c: float(c["prominence"]), reverse=True)[:args.max_total_candidates]
        capped.sort(key=lambda c: int(c["tMs"]))
        candidates = capped
    print(
        f"   peaks: {len(all_peaks)} det / {len(selected_peaks)} sel | "
        f"regimes: {len(regimes)} det / {len(regimes_guarded)} guarded | "
        f"candidates: {len(candidates)}"
    )

    # Step 3: audio beats (absolute ms; only used by code-side alignment)
    audio_beats_ms = (
        audio_beats_ms_in_block_abs(beat_map, block_start_s=start, block_end_s=end)
        if beat_map else []
    )

    # Step 4: per-peak window + peak_micro_scan
    peak_window_dir = work_dir / block_id
    peak_window_dir.mkdir(parents=True, exist_ok=True)

    visual_peaks_with_windows: list[dict[str, Any]] = []
    semantic_results: list[dict[str, Any]] = []
    peak_failures: list[dict[str, Any]] = []

    for candidate in candidates:
        # Unified candidates carry sourceId (peak_NNN or boundary_NNN) + eventType + anchorSource.
        candidate_id = str(candidate.get("sourceId") or "")
        candidate_block_rel_ms = int(candidate["tMs"])
        candidate_abs_s = start + (candidate_block_rel_ms / 1000.0)
        window_clip = peak_window_dir / f"{candidate_id}.mp4"
        window_start_s = max(start, candidate_abs_s - args.peak_pre_context)
        window_end_s = min(end, candidate_abs_s + args.peak_post_context)

        if not window_clip.exists():
            run_ffmpeg(
                build_peak_window_command(
                    args.video,
                    window_clip,
                    block_start=start,
                    block_end=end,
                    peak_time=candidate_abs_s,
                    pre_context=args.peak_pre_context,
                    post_context=args.peak_post_context,
                )
            )

        position_bucket = relative_position_bucket(
            candidate_block_rel_ms, block_duration_ms=block_duration_ms,
        )

        anchor_source = str(candidate.get("anchorSource", "visual_peak"))
        event_type = str(candidate.get("eventType", "peak"))
        channels = (
            ["hist_delta", "frame_diff", "flow_mag", "area_delta"]
            if anchor_source == "visual_peak" else []
        )

        visual_peaks_with_windows.append({
            "peakId": candidate_id,  # unified: works for both peak and regime
            "tMs": int(round(candidate_abs_s * 1000)),  # absolute for alignment
            "prominence": float(candidate.get("prominence", 0.0)),
            "motionScore": float(candidate.get("motionScore", 0.0)),
            "channels": channels,
            "windowMs": {
                "start": int(round(window_start_s * 1000)),
                "end": int(round(window_end_s * 1000)),
            },
            "anchorSource": anchor_source,
            "eventType": event_type,
        })

        try:
            peak_vars = {
                "peakId": candidate_id,
                "relativePositionBucket": position_bucket,
                "coarseRoleGuess": block.get("coarseRoleGuess", "unknown"),
            }
            peak_instructions, peak_text = load_prompt_sections(args.peak_micro_prompt, peak_vars)

            print(f"   [{candidate_id}] ({event_type}) uploading window...")
            pf = upload_file(base_url=base_url, api_key=api_key, video_path=window_clip, fps=None)
            wait_for_file(
                base_url=base_url, api_key=api_key, file_id=pf["id"],
                poll_interval=args.poll_interval, max_wait_seconds=args.max_wait_seconds,
            )
            resp = create_response(
                base_url=base_url, api_key=api_key,
                payload=build_responses_payload(
                    model=model, file_id=pf["id"],
                    prompt_text=peak_text, instructions=peak_instructions, store=True,
                ),
                timeout=args.response_timeout,
            )
            parsed = extract_json_object(extract_response_text(resp))
            if isinstance(parsed, dict):
                parsed.setdefault("peakId", candidate_id)
                semantic_results.append(parsed)
                print(f"      → {parsed.get('semanticAction', '?')[:40]}")
            else:
                raise ValueError("peak_micro response is not a JSON object")
        except Exception as exc:
            print(f"   [WARN] {candidate_id} peak_micro failed: {exc}")
            peak_failures.append({"peakId": candidate_id, "error": str(exc)})

    # Step 5: block-level fine_structure_scan v0.3
    block_variables = build_block_prompt_variables(
        block, video_id=video_id, video_duration=video_duration,
    )
    block_instructions, block_prompt_text = load_prompt_sections(args.prompt, block_variables)

    print(f"   uploading block clip for fine_structure_scan...")
    try:
        block_file_info = upload_file(
            base_url=base_url, api_key=api_key, video_path=clip_path, fps=None,
        )
        wait_for_file(
            base_url=base_url, api_key=api_key, file_id=block_file_info["id"],
            poll_interval=args.poll_interval, max_wait_seconds=args.max_wait_seconds,
        )
        block_response = create_response(
            base_url=base_url, api_key=api_key,
            payload=build_responses_payload(
                model=model, file_id=block_file_info["id"],
                prompt_text=block_prompt_text, instructions=block_instructions, store=True,
            ),
            timeout=args.response_timeout,
        )
        block_response_text = extract_response_text(block_response)
        block_metadata = extract_json_object(block_response_text)
        if not isinstance(block_metadata, dict):
            raise ValueError("fine_structure_scan response is not a JSON object")
    except Exception as exc:
        msg = f"block-level fine_structure_scan failed: {exc}"
        print(f"   [ERROR] {msg}")
        write_text(
            out_dir / f"{block_id}_fine_scan_response_text.txt",
            block_response_text if 'block_response_text' in locals() else "",
        )
        return None, {"blockId": block_id, "stage": "fine_structure_scan", "error": str(exc)}

    # Step 6: aggregate code-owned timing with model semantics
    action_beats = aggregate_peak_semantics(
        visual_peaks=visual_peaks_with_windows,
        semantic_results=semantic_results,
        audio_beats_ms=audio_beats_ms,
        tolerance_ms=args.alignment_tolerance_ms,
    )

    # Step 7: assemble v0.3 block output
    block_output = {
        **block_metadata,
        "schemaVersion": "fine_content_block_semantic_v0_3",
        "blockId": block_id,
        "videoId": video_id,
        "sourceTimeRangeMs": {"start": block_start_ms, "end": block_end_ms},
        "samplingInfo": {
            "clipMode": SOURCE_CLIP_MODE,
            "uploadSampling": SOURCE_UPLOAD_SAMPLING,
            "clipResolution": SOURCE_CLIP_RESOLUTION,
        },
        "actionBeats": action_beats,
        "peakDetectionStats": {
            "candidatePeakCount": len(all_peaks),
            "selectedPeakCount": len(selected_peaks),
            "regimeBoundaryCount": len(regimes),
            "regimeBoundaryGuardedCount": len(regimes_guarded),
            "totalCandidateCount": len(candidates),
            "rejectedByMeaningfulness": len(candidates) - len(action_beats) - len(peak_failures),
            "failedPeakCount": len(peak_failures),
            "config": {
                "peaksPerSecond": args.peaks_per_second,
                "maxPeaks": args.max_peaks,
                "minProminenceZ": args.peak_min_prominence,
                "minDistanceMs": args.peak_min_distance_ms,
                "boundaryGuardMs": args.peak_boundary_guard_ms,
                "prePostContextS": [args.peak_pre_context, args.peak_post_context],
                "sampleFps": args.peak_sample_fps,
                "regimePenalty": args.regime_penalty,
                "regimeDedupWindowMs": args.regime_dedup_window_ms,
                "maxTotalCandidates": args.max_total_candidates,
            },
            "peakFailures": peak_failures,
        },
        "audioBeatsUsedAbsMs": audio_beats_ms,
        "alignmentToleranceMs": args.alignment_tolerance_ms,
    }

    block_out_path = out_dir / f"{block_id}_fine_scan.json"
    write_json(block_out_path, block_output)
    print(f"   saved -> {block_out_path}")
    return block_output, None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stage 2 fine content-block analysis using Doubao/ModelArk.")
    parser.add_argument("--rough-scan", default="seed_assets/analysis/macbook_neo/rough_structure_scan.json")
    parser.add_argument("--video", default="seed_assets/raw_videos/macbook_neo.mp4")
    parser.add_argument("--beat-map", default="seed_assets/analysis/macbook_neo/audio_beat_map.json")
    parser.add_argument("--video-id", default="")
    parser.add_argument("--prompt", default="prompts/video_understanding/fine_structure_scan_v0.md")
    parser.add_argument(
        "--peak-micro-prompt",
        default="prompts/video_understanding/peak_micro_scan_v0.md",
        help="Per-peak semantic-only prompt (v0.3 pipeline).",
    )
    parser.add_argument("--out-dir", default="seed_assets/analysis/macbook_neo/fine_scan")
    parser.add_argument("--work-dir", default="seed_assets/analysis/macbook_neo/fine_scan/clips")
    parser.add_argument("--block-ids", default="", help="Comma-separated content block IDs to process.")
    parser.add_argument("--skip-audio", action="store_true")
    # Peak detection / selection (S3'-minimal)
    parser.add_argument("--peak-sample-fps", type=float, default=10.0)
    parser.add_argument("--peak-min-distance-ms", type=int, default=250)
    parser.add_argument("--peak-min-prominence", type=float, default=0.5)
    parser.add_argument("--peaks-per-second", type=float, default=1.0)
    parser.add_argument("--max-peaks", type=int, default=12)
    parser.add_argument("--min-block-seconds", type=float, default=1.5)
    parser.add_argument("--peak-boundary-guard-ms", type=int, default=250)
    parser.add_argument("--peak-pre-context", type=float, default=0.6)
    parser.add_argument("--peak-post-context", type=float, default=0.8)
    parser.add_argument("--alignment-tolerance-ms", type=int, default=120)
    # Regime boundary detection (ruptures PELT) — catches motion-end / settling events
    parser.add_argument("--regime-penalty", type=float, default=1.0)
    parser.add_argument("--regime-dedup-window-ms", type=int, default=200)
    parser.add_argument("--max-total-candidates", type=int, default=16)
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
