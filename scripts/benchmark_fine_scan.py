#!/usr/bin/env python3
"""Benchmark fine_scan quick/full candidate budgets without LLM calls.

The benchmark runs ``fine_scan.py`` twice in ``--candidates-only`` mode:

- ``full``: current quality-preserving defaults.
- ``quick``: lower API-budget preset for development feedback.

It writes candidate summaries, timing reports, and a guardrail report that
checks quick mode did not drop blocks, hard-cut candidates, or structurally
important blocks below the minimum candidate floor.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from fine_scan import (  # noqa: E402
    build_candidate_benchmark_report,
    build_parser as build_fine_scan_parser,
    render_candidate_benchmark_markdown,
    run_fine_scan,
)
from llm_client import write_json  # noqa: E402
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402


def find_bundled_ffmpeg(repo_root: Path) -> Path | None:
    candidates = sorted(
        (repo_root / "node_modules" / ".pnpm").glob("ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg.exe")
    )
    if candidates:
        return candidates[0]
    unix_candidates = sorted(
        (repo_root / "node_modules" / ".pnpm").glob("ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg")
    )
    return unix_candidates[0] if unix_candidates else None


def build_child_env(*, repo_root: Path, base_env: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ if base_env is None else base_env)
    bundled_ffmpeg = find_bundled_ffmpeg(repo_root)
    if bundled_ffmpeg is None:
        return env
    current_path = env.get("PATH", "")
    env["PATH"] = f"{bundled_ffmpeg.parent}{os.pathsep}{current_path}" if current_path else str(bundled_ffmpeg.parent)
    return env


def ensure_bundled_ffmpeg_on_path(repo_root: Path) -> None:
    os.environ.update(build_child_env(repo_root=repo_root))


def build_parser() -> argparse.ArgumentParser:
    paths = analysis_paths(DEFAULT_VIDEO_ID)
    parser = argparse.ArgumentParser(
        description="Run a no-LLM fine_scan quick/full candidate benchmark with quality guardrails.",
    )
    parser.add_argument("--rough-scan", default=str(paths.rough_scan))
    parser.add_argument(
        "--structure-graph",
        default="",
        help="Optional no-LLM fallback source. Converts structure_graph.json segments into benchmark contentBlocks.",
    )
    parser.add_argument("--video", default=str(paths.raw_video))
    parser.add_argument("--video-id", default=DEFAULT_VIDEO_ID)
    parser.add_argument("--out-dir", default="tmp/fine-scan-benchmark")
    parser.add_argument("--work-dir", default="tmp/fine_scan_benchmark_clips")
    parser.add_argument("--block-ids", default="")
    parser.add_argument(
        "--skip-audio",
        action="store_true",
        default=True,
        help="Keep audio disabled for deterministic no-LLM candidate benchmarking.",
    )
    parser.add_argument(
        "--no-hard-cut",
        action="store_true",
        help="Pass through to fine_scan if you want to benchmark without hard-cut detection.",
    )
    return parser


def validate_inputs(args: argparse.Namespace) -> list[str]:
    rough_scan = Path(args.rough_scan)
    structure_graph = Path(args.structure_graph) if getattr(args, "structure_graph", "") else None
    video = Path(args.video)
    issues: list[str] = []
    if structure_graph is not None and not structure_graph.exists():
        issues.append(f"Structure graph file not found: {structure_graph}")
    if not rough_scan.exists() and structure_graph is None:
        issues.append(
            "\n".join(
                [
                    f"Rough scan file not found: {rough_scan}",
                    "Create it before running the benchmark, for example:",
                    (
                        "python scripts/rough_scan.py "
                        f"--video {video} "
                        f"--video-id {args.video_id} "
                        f"--out {rough_scan}"
                    ),
                    "Then re-run this benchmark to compare quick/full candidate budgets.",
                ]
            )
        )
    if not video.exists():
        issues.append(f"Video file not found: {video}")
    return issues


def build_rough_scan_from_structure_graph(structure_graph: dict[str, Any], *, video_id: str) -> dict[str, Any]:
    segments = structure_graph.get("segments") or []
    content_blocks: list[dict[str, Any]] = []
    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            continue
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or start)
        if end <= start:
            continue
        segment_id = str(segment.get("id") or f"seg_block_{index:03d}")
        role = str(segment.get("role") or "unknown")
        purpose = str(segment.get("purpose") or "")
        caption = str(segment.get("caption") or "")
        transfer_rule = str(segment.get("transferRule") or "")
        content_blocks.append(
            {
                "id": segment_id,
                "timeRange": {"start": start, "end": end},
                "coarseRoleGuess": role,
                "boundaryReason": "derived from structure_graph segment for no-LLM benchmark",
                "observableSummary": " / ".join(part for part in [purpose, caption] if part),
                "fineScanFocusQuestions": [
                    transfer_rule or f"Inspect transferable structure for role: {role}",
                    "Benchmark derived from existing structure_graph; use for candidate/timing comparison, not as a replacement for rough_scan.",
                ],
            }
        )
    if not content_blocks:
        raise ValueError("structure_graph has no valid segments with start/end ranges")
    return {
        "videoId": video_id,
        "contentBlocks": content_blocks,
        "benchmarkSource": "structure_graph_segments",
    }


def materialize_structure_graph_rough_scan(*, structure_graph_path: Path, out_dir: Path, video_id: str) -> Path:
    structure_graph = json.loads(structure_graph_path.read_text(encoding="utf-8"))
    rough_scan = build_rough_scan_from_structure_graph(structure_graph, video_id=video_id)
    rough_scan_path = out_dir / "structure_graph_derived_rough_scan.json"
    rough_scan_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(rough_scan_path, rough_scan)
    return rough_scan_path


def build_benchmark_source_metadata(args: argparse.Namespace, *, effective_rough_scan: str) -> dict[str, Any]:
    if getattr(args, "structure_graph", ""):
        return {
            "sourceType": "structure_graph_derived",
            "structureGraph": str(args.structure_graph),
            "requestedRoughScan": str(args.rough_scan),
            "effectiveRoughScan": str(effective_rough_scan),
            "limitations": [
                "structure_graph-derived contentBlocks are for no-LLM candidate/timing benchmarking only",
                "this does not replace a fresh rough_scan artifact for final fine_scan quality validation",
            ],
        }
    return {
        "sourceType": "rough_scan",
        "requestedRoughScan": str(args.rough_scan),
        "effectiveRoughScan": str(effective_rough_scan),
        "limitations": [],
    }


def _load_scan(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def summarize_timing_report(path: Path, *, top_n: int = 5) -> dict[str, Any]:
    if not path.exists():
        return {"path": str(path), "totalMs": 0.0, "topStages": [], "warning": "timing report not found"}
    report = json.loads(path.read_text(encoding="utf-8"))
    stage_summary = report.get("stageSummary") or {}
    stages: list[dict[str, Any]] = []
    total_ms = 0.0
    for stage, summary in stage_summary.items():
        stage_total = round(float(summary.get("totalMs") or 0.0), 3)
        total_ms = round(total_ms + stage_total, 3)
        stages.append(
            {
                "stage": str(stage),
                "totalMs": stage_total,
                "count": int(summary.get("count") or 0),
                "avgMs": round(float(summary.get("avgMs") or 0.0), 3),
            }
        )
    stages.sort(key=lambda item: item["totalMs"], reverse=True)
    return {
        "path": str(path),
        "totalMs": round(total_ms, 3),
        "topStages": stages[:top_n],
    }


def build_timing_comparison(full_path: Path, quick_path: Path) -> dict[str, Any]:
    full_summary = summarize_timing_report(full_path)
    quick_summary = summarize_timing_report(quick_path)
    full_total = float(full_summary["totalMs"])
    quick_total = float(quick_summary["totalMs"])
    delta_ms = round(full_total - quick_total, 3)
    return {
        "full": full_summary,
        "quick": quick_summary,
        "deltaMs": delta_ms,
        "reductionPct": round((delta_ms / full_total) * 100, 3) if full_total else 0.0,
    }


def _run_candidate_scan(
    *,
    preset: str,
    rough_scan: str,
    video: str,
    video_id: str,
    out_dir: Path,
    work_dir: Path,
    block_ids: str,
    skip_audio: bool,
    no_hard_cut: bool,
) -> dict[str, Any]:
    preset_out = out_dir / preset
    preset_work = work_dir / preset
    argv = [
        "--scan-preset",
        preset,
        "--candidates-only",
        "--timing-report",
        "--rough-scan",
        rough_scan,
        "--video",
        video,
        "--video-id",
        video_id,
        "--out-dir",
        str(preset_out),
        "--work-dir",
        str(preset_work),
    ]
    if block_ids:
        argv.extend(["--block-ids", block_ids])
    if skip_audio:
        argv.append("--skip-audio")
    if no_hard_cut:
        argv.append("--no-hard-cut")

    args = build_fine_scan_parser().parse_args(argv)
    result = run_fine_scan(args)
    if result != 0:
        raise SystemExit(f"fine_scan {preset} candidate benchmark failed with exit code {result}")
    scan_path = preset_out / "fine_structure_scan.json"
    if not scan_path.exists():
        raise SystemExit(f"fine_scan {preset} did not write {scan_path}")
    return _load_scan(scan_path)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    input_issues = validate_inputs(args)
    if input_issues:
        print("Benchmark input validation failed:", file=sys.stderr)
        for issue in input_issues:
            print(issue, file=sys.stderr)
        return 2

    ensure_bundled_ffmpeg_on_path(SCRIPT_DIR.parent)
    out_dir = Path(args.out_dir)
    work_dir = Path(args.work_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    rough_scan_path = str(
        materialize_structure_graph_rough_scan(
            structure_graph_path=Path(args.structure_graph),
            out_dir=out_dir,
            video_id=args.video_id,
        )
        if getattr(args, "structure_graph", "")
        else args.rough_scan
    )

    full_scan = _run_candidate_scan(
        preset="full",
        rough_scan=rough_scan_path,
        video=args.video,
        video_id=args.video_id,
        out_dir=out_dir,
        work_dir=work_dir,
        block_ids=args.block_ids,
        skip_audio=args.skip_audio,
        no_hard_cut=args.no_hard_cut,
    )
    quick_scan = _run_candidate_scan(
        preset="quick",
        rough_scan=rough_scan_path,
        video=args.video,
        video_id=args.video_id,
        out_dir=out_dir,
        work_dir=work_dir,
        block_ids=args.block_ids,
        skip_audio=args.skip_audio,
        no_hard_cut=args.no_hard_cut,
    )

    report = build_candidate_benchmark_report(
        video_id=args.video_id,
        full_scan=full_scan,
        quick_scan=quick_scan,
    )
    report["timingReports"] = {
        "full": str(out_dir / "full" / "fine_scan_timing.json"),
        "quick": str(out_dir / "quick" / "fine_scan_timing.json"),
    }
    report["timingSummary"] = build_timing_comparison(
        out_dir / "full" / "fine_scan_timing.json",
        out_dir / "quick" / "fine_scan_timing.json",
    )
    report["benchmarkSource"] = build_benchmark_source_metadata(args, effective_rough_scan=rough_scan_path)

    json_path = out_dir / "fine_scan_candidate_benchmark.json"
    markdown_path = out_dir / "fine_scan_candidate_benchmark.md"
    write_json(json_path, report)
    markdown_path.write_text(render_candidate_benchmark_markdown(report), encoding="utf-8")

    print(f"Wrote {json_path}")
    print(f"Wrote {markdown_path}")
    if not report["qualityGuardrail"]["passed"]:
        print("Quality guardrail failed. Inspect the benchmark report before using quick mode.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
