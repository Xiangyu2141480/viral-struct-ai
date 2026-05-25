#!/usr/bin/env python
"""A/B compare fine scan pipelines against human-annotated ground truth.

Loads ground-truth action-beat timings (produced by the gt-annotation
sub-agent) and compares one or two candidate pipelines (OLD v0.2 and / or
NEW v0.3) against it. Reports per-beat errors and per-block / aggregate
stats; emits JSON for CI and markdown for humans.
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_ground_truth(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _extract_v02_block_beats(payload: dict[str, Any]) -> list[dict[str, Any]]:
    start = int(payload.get("sourceTimeRangeMs", {}).get("start", 0))
    shots = payload.get("shotStructure", {}).get("shots", []) or []
    beats: list[dict[str, Any]] = []
    for shot in shots:
        for beat in shot.get("actionBeats", []) or []:
            t_rel = int(beat["tMs"])
            beats.append(
                {
                    "beatId": str(beat.get("beatId", "")),
                    "absMs": start + t_rel,
                    "tMsBlockRel": t_rel,
                    "beatType": beat.get("beatType"),
                    "deltaDescription": beat.get("deltaDescription"),
                }
            )
    return beats


def load_v02_actionbeats(block_dir: str | Path) -> dict[str, list[dict[str, Any]]]:
    block_dir_path = Path(block_dir)
    out: dict[str, list[dict[str, Any]]] = {}
    for json_path in sorted(block_dir_path.glob("block_*_fine_scan.json")):
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        block_id = str(payload.get("blockId") or json_path.stem.replace("_fine_scan", ""))
        out[block_id] = _extract_v02_block_beats(payload)
    return out


def _extract_v03_block_beats(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Read NEW v0.3 actionBeats (flat list, anchorMs is absolute)."""
    beats_in = payload.get("actionBeats", []) or []
    out: list[dict[str, Any]] = []
    for beat in beats_in:
        anchor = beat.get("anchorMs")
        if anchor is None:
            continue
        out.append(
            {
                "beatId": str(beat.get("beatId", "")),
                "absMs": int(anchor),
                "semanticAction": beat.get("semanticAction"),
                "actionType": beat.get("actionType"),
            }
        )
    return out


def load_v03_actionbeats(block_dir: str | Path) -> dict[str, list[dict[str, Any]]]:
    block_dir_path = Path(block_dir)
    out: dict[str, list[dict[str, Any]]] = {}
    for json_path in sorted(block_dir_path.glob("block_*_fine_scan.json")):
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        block_id = str(payload.get("blockId") or json_path.stem.replace("_fine_scan", ""))
        out[block_id] = _extract_v03_block_beats(payload)
    return out


# ---------------------------------------------------------------------------
# Matching + stats
# ---------------------------------------------------------------------------


def find_nearest_beat(*, target_abs_ms: int, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not candidates:
        return None
    return min(candidates, key=lambda c: abs(int(c["absMs"]) - int(target_abs_ms)))


def compute_per_block_errors(
    truth_beats: list[dict[str, Any]],
    candidate_beats: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for truth in truth_beats:
        target = int(truth["trueAbsTimeMs"])
        nearest = find_nearest_beat(target_abs_ms=target, candidates=candidate_beats)
        if nearest is None:
            rows.append(
                {
                    "truthBeatId": truth.get("beatId"),
                    "trueAbsTimeMs": target,
                    "semanticAction": truth.get("semanticAction"),
                    "nearestBeatId": None,
                    "nearestAbsMs": None,
                    "deltaMs": None,
                    "absErrorMs": None,
                }
            )
            continue
        delta = int(nearest["absMs"]) - target  # positive = candidate later than truth
        rows.append(
            {
                "truthBeatId": truth.get("beatId"),
                "trueAbsTimeMs": target,
                "semanticAction": truth.get("semanticAction"),
                "nearestBeatId": nearest.get("beatId"),
                "nearestAbsMs": int(nearest["absMs"]),
                "deltaMs": delta,
                "absErrorMs": abs(delta),
            }
        )
    return rows


def compute_block_stats(rows: list[dict[str, Any]], *, tolerance_ms: int = 250) -> dict[str, Any]:
    matched = [r for r in rows if r["absErrorMs"] is not None]
    abs_errors = [int(r["absErrorMs"]) for r in matched]
    within = [r for r in matched if int(r["absErrorMs"]) <= int(tolerance_ms)]

    return {
        "totalTruthBeats": len(rows),
        "matchedTruthBeats": len(matched),
        "meanAbsErrorMs": int(round(statistics.fmean(abs_errors))) if abs_errors else None,
        "medianAbsErrorMs": int(round(statistics.median(abs_errors))) if abs_errors else None,
        "maxAbsErrorMs": max(abs_errors) if abs_errors else None,
        "withinToleranceCount": len(within),
        "withinToleranceFraction": len(within) / len(matched) if matched else 0.0,
        "toleranceMs": int(tolerance_ms),
    }


def compute_aggregate_stats(per_block: dict[str, dict[str, Any]], *, tolerance_ms: int = 250) -> dict[str, Any]:
    all_abs: list[int] = []
    total_truth = 0
    total_matched = 0
    total_within = 0
    for block_stats in per_block.values():
        rows = block_stats.get("rows", [])
        for row in rows:
            total_truth += 1
            if row["absErrorMs"] is not None:
                total_matched += 1
                err = int(row["absErrorMs"])
                all_abs.append(err)
                if err <= int(tolerance_ms):
                    total_within += 1
    return {
        "totalTruthBeats": total_truth,
        "matchedTruthBeats": total_matched,
        "meanAbsErrorMs": int(round(statistics.fmean(all_abs))) if all_abs else None,
        "medianAbsErrorMs": int(round(statistics.median(all_abs))) if all_abs else None,
        "maxAbsErrorMs": max(all_abs) if all_abs else None,
        "withinToleranceCount": total_within,
        "withinToleranceFraction": (total_within / total_matched) if total_matched else 0.0,
        "toleranceMs": int(tolerance_ms),
    }


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def render_markdown_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# Fine Scan A/B Compare Report — {report.get('videoId', 'unknown')}")
    lines.append("")
    lines.append(f"Ground truth: `{report.get('groundTruthPath', '')}`")
    lines.append(f"Tolerance: ±{report.get('toleranceMs', 250)}ms")
    lines.append("")

    pipelines = report.get("pipelines", {})
    for name, data in pipelines.items():
        lines.append(f"## Pipeline: {name}")
        lines.append("")
        agg = data.get("aggregate", {})
        lines.append(
            f"**Aggregate:** "
            f"truth_beats={agg.get('totalTruthBeats', 0)}, "
            f"matched={agg.get('matchedTruthBeats', 0)}, "
            f"mean_abs={agg.get('meanAbsErrorMs')}ms, "
            f"median_abs={agg.get('medianAbsErrorMs')}ms, "
            f"max_abs={agg.get('maxAbsErrorMs')}ms, "
            f"within_tol={agg.get('withinToleranceCount', 0)}/{agg.get('matchedTruthBeats', 0)} "
            f"({agg.get('withinToleranceFraction', 0):.0%})"
        )
        lines.append("")

        per_block = data.get("perBlock", {})
        if per_block:
            lines.append("| Block | Truth | Matched | Mean abs | Median abs | Max abs | Within ±tol |")
            lines.append("|---|---|---|---|---|---|---|")
            for block_id in sorted(per_block.keys()):
                stats = per_block[block_id]
                lines.append(
                    f"| {block_id} | {stats.get('totalTruthBeats')} | {stats.get('matchedTruthBeats')} "
                    f"| {stats.get('meanAbsErrorMs')}ms | {stats.get('medianAbsErrorMs')}ms "
                    f"| {stats.get('maxAbsErrorMs')}ms "
                    f"| {stats.get('withinToleranceCount')}/{stats.get('matchedTruthBeats')} "
                    f"({stats.get('withinToleranceFraction', 0):.0%}) |"
                )
            lines.append("")

            for block_id in sorted(per_block.keys()):
                rows = per_block[block_id].get("rows", [])
                if not rows:
                    continue
                lines.append(f"### {name} / {block_id}")
                lines.append("")
                lines.append("| Truth beat | True abs (ms) | Nearest | Nearest abs (ms) | Delta (ms) | Abs error (ms) |")
                lines.append("|---|---|---|---|---|---|")
                for row in rows:
                    lines.append(
                        f"| {row['truthBeatId']} | {row['trueAbsTimeMs']} "
                        f"| {row.get('nearestBeatId') or '—'} "
                        f"| {row.get('nearestAbsMs') if row.get('nearestAbsMs') is not None else '—'} "
                        f"| {row.get('deltaMs') if row.get('deltaMs') is not None else '—'} "
                        f"| {row.get('absErrorMs') if row.get('absErrorMs') is not None else '—'} |"
                    )
                lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def compare_pipelines(
    *,
    ground_truth: dict[str, Any],
    old_beats_by_block: dict[str, list[dict[str, Any]]] | None,
    new_beats_by_block: dict[str, list[dict[str, Any]]] | None,
    tolerance_ms: int = 250,
) -> dict[str, Any]:
    video_id = ground_truth.get("videoId", "unknown")
    gt_blocks = ground_truth.get("blocks", {})

    pipelines: dict[str, dict[str, Any]] = {}
    for name, candidate_map in (("OLD_v0.2", old_beats_by_block), ("NEW_v0.3", new_beats_by_block)):
        if candidate_map is None:
            continue
        per_block: dict[str, dict[str, Any]] = {}
        for block_id, gt_block in gt_blocks.items():
            truth_beats = gt_block.get("trueActionBeats", []) or []
            candidates = candidate_map.get(block_id, [])
            rows = compute_per_block_errors(truth_beats, candidates)
            block_stats = compute_block_stats(rows, tolerance_ms=tolerance_ms)
            block_stats["rows"] = rows
            per_block[block_id] = block_stats
        aggregate = compute_aggregate_stats(per_block, tolerance_ms=tolerance_ms)
        pipelines[name] = {"perBlock": per_block, "aggregate": aggregate}

    return {
        "videoId": video_id,
        "toleranceMs": int(tolerance_ms),
        "pipelines": pipelines,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="A/B compare Fine Scan pipelines vs human ground truth."
    )
    parser.add_argument("--ground-truth", required=True)
    parser.add_argument("--old-dir", default=None, help="Directory with OLD v0.2 block_*_fine_scan.json files")
    parser.add_argument("--new-dir", default=None, help="Directory with NEW v0.3 block_*_fine_scan.json files")
    parser.add_argument("--tolerance-ms", type=int, default=250)
    parser.add_argument("--out-json", default=None)
    parser.add_argument("--out-md", default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.old_dir and not args.new_dir:
        raise SystemExit("Provide at least one of --old-dir / --new-dir")

    ground_truth = load_ground_truth(args.ground_truth)
    old_map = load_v02_actionbeats(args.old_dir) if args.old_dir else None
    new_map = load_v03_actionbeats(args.new_dir) if args.new_dir else None

    report = compare_pipelines(
        ground_truth=ground_truth,
        old_beats_by_block=old_map,
        new_beats_by_block=new_map,
        tolerance_ms=args.tolerance_ms,
    )
    report["groundTruthPath"] = str(args.ground_truth)

    if args.out_json:
        out_json = Path(args.out_json)
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.out_json}")

    if args.out_md:
        out_md = Path(args.out_md)
        out_md.parent.mkdir(parents=True, exist_ok=True)
        out_md.write_text(render_markdown_report(report), encoding="utf-8")
        print(f"wrote {args.out_md}")

    # Print compact summary to stdout
    for name, data in report["pipelines"].items():
        agg = data["aggregate"]
        print(
            f"{name}: mean_abs={agg.get('meanAbsErrorMs')}ms "
            f"median_abs={agg.get('medianAbsErrorMs')}ms "
            f"max_abs={agg.get('maxAbsErrorMs')}ms "
            f"within±{report['toleranceMs']}ms={agg.get('withinToleranceCount')}/{agg.get('matchedTruthBeats')} "
            f"({agg.get('withinToleranceFraction', 0):.0%})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
