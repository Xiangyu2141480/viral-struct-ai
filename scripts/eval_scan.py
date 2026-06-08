#!/usr/bin/env python
"""Eval harness for the rough/fine scan against available ground truth.

Turns "how good is this scan" into numbers. GT-agnostic: it runs whichever of
these are present for a ``--video-id``:

  - <analysis>/ground_truth/action_beats_ground_truth.json  -> beat P/R/F1 + timing MAE
  - <analysis>/ground_truth/section_boundaries.json         -> boundary P/R/F1
  - a scene-cut list (scene_changes_*.txt, pts_time lines)  -> cut recall + per-block coverage

Metric protocol mirrors standard event-detection eval: greedy one-to-one
matching within a time tolerance, then precision/recall/F1 (cf. TransNet V2's
F1-at-tolerance for shot boundaries; mAP@tIoU for temporal action localization).

Honest caveats (printed in the report):
  - scene_changes_*.txt is an ffmpeg heuristic (threshold 0.14), not human cuts.
  - action_beats_ground_truth.json was AI-annotated (a subagent), not human gold.
  - section_boundaries.json is a single annotator (full_analysis.md).
So treat absolute numbers as directional; use them for A/B between scan versions.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402


# --------------------------------------------------------------------------- #
# Core metric: greedy one-to-one matching within a tolerance.
# --------------------------------------------------------------------------- #

def match_events(pred_ms: list[float], gt_ms: list[float], tolerance_ms: float) -> dict[str, Any]:
    """Greedy one-to-one nearest matching of predicted vs ground-truth event
    times within ``tolerance_ms``. Pairs are assigned smallest-error-first, so
    each prediction and each GT event is used at most once.

    Returns matched / predOnly (false positives) / gtOnly (misses) counts plus
    precision, recall, f1, and mean-abs-error (ms) over matched pairs.
    """
    pairs: list[tuple[float, int, int]] = []
    for i, p in enumerate(pred_ms):
        for j, g in enumerate(gt_ms):
            err = abs(p - g)
            if err <= tolerance_ms:
                pairs.append((err, i, j))
    pairs.sort()

    pred_used = [False] * len(pred_ms)
    gt_used = [False] * len(gt_ms)
    matched: list[tuple[int, int, float]] = []
    for err, i, j in pairs:
        if not pred_used[i] and not gt_used[j]:
            pred_used[i] = True
            gt_used[j] = True
            matched.append((i, j, err))

    tp = len(matched)
    precision = tp / len(pred_ms) if pred_ms else 0.0
    recall = tp / len(gt_ms) if gt_ms else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    mae = (sum(e for _, _, e in matched) / tp) if tp else None
    return {
        "predCount": len(pred_ms),
        "gtCount": len(gt_ms),
        "matched": tp,
        "predOnly": len(pred_ms) - tp,   # false positives
        "gtOnly": len(gt_ms) - tp,       # misses
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "maeMs": round(mae, 1) if mae is not None else None,
    }


# --------------------------------------------------------------------------- #
# Loaders (each returns absolute-time event lists in ms).
# --------------------------------------------------------------------------- #

def parse_scene_cuts_ms(path: Path) -> list[float]:
    text = path.read_text(encoding="utf-8")
    return sorted(float(m) * 1000.0 for m in re.findall(r"pts_time:([0-9.]+)", text))


def scan_beat_anchors_ms(fine_doc: dict) -> list[float]:
    out: list[float] = []
    for b in fine_doc.get("contentBlocks", []):
        for beat in b.get("actionBeats", []):
            anchor = beat.get("anchorMs")
            if anchor is not None:
                out.append(float(anchor))
    return sorted(out)


def scan_block_boundaries_ms(rough_doc: dict) -> list[float]:
    """Internal block boundaries (block starts except the first)."""
    starts = [float(b["timeRange"]["start"]) * 1000.0 for b in rough_doc.get("contentBlocks", [])]
    return sorted(starts)[1:]


def gt_beats_ms(gt_doc: dict) -> list[float]:
    out: list[float] = []
    for _bid, block in (gt_doc.get("blocks") or {}).items():
        for beat in block.get("trueActionBeats", []):
            t = beat.get("trueAbsTimeMs")
            if t is not None:
                out.append(float(t))
    return sorted(out)


def gt_section_boundaries_ms(sections_doc: dict) -> list[float]:
    starts = sorted(float(s["start"]) * 1000.0 for s in sections_doc.get("sections", []))
    return starts[1:]  # internal boundaries only


def per_block_cut_coverage(rough_doc: dict, fine_doc: dict, cuts_ms: list[float], tol: float) -> list[dict]:
    """For each block: how many enclosed scene-cuts have a beat within tolerance."""
    beats_by_block = {b.get("blockId"): [float(x["anchorMs"]) for x in b.get("actionBeats", []) if x.get("anchorMs") is not None]
                      for b in fine_doc.get("contentBlocks", [])}
    rows: list[dict] = []
    for b in rough_doc.get("contentBlocks", []):
        tr = b.get("timeRange", {})
        s, e = float(tr.get("start", 0)) * 1000.0, float(tr.get("end", 0)) * 1000.0
        cuts_in = [c for c in cuts_ms if s <= c < e]
        beats = beats_by_block.get(b.get("id"), [])
        m = match_events(beats, cuts_in, tol)
        rows.append({
            "block": b.get("id"),
            "rangeS": [round(s / 1000, 1), round(e / 1000, 1)],
            "cutsInside": len(cuts_in),
            "beats": len(beats),
            "cutsCovered": m["matched"],
            "coverage": round(m["matched"] / len(cuts_in), 3) if cuts_in else None,
        })
    return rows


def role_at_time_s(graph_doc: dict, t_s: float) -> str | None:
    """The structure_graph segment role covering time ``t_s`` (seconds)."""
    for seg in graph_doc.get("segments", []):
        if float(seg.get("start", 0)) <= t_s < float(seg.get("end", 0)):
            return seg.get("role")
    return None


def role_accuracy(graph_doc: dict, sections_doc: dict) -> dict:
    """Fraction of GT sections whose midpoint role matches ``expectedRole``.

    Coarse (vocabulary mapping is approximate — see the GT file's note), so read
    it as a directional A/B signal between scan versions, not absolute truth.
    """
    rows: list[dict] = []
    correct = 0
    for sec in sections_doc.get("sections", []):
        if "expectedRole" not in sec:
            continue
        mid = (float(sec["start"]) + float(sec["end"])) / 2.0
        got = role_at_time_s(graph_doc, mid)
        ok = got == sec["expectedRole"]
        correct += int(ok)
        rows.append({"section": sec.get("label"), "expected": sec["expectedRole"], "got": got, "match": ok})
    total = len(rows)
    return {
        "total": total,
        "correct": correct,
        "accuracy": round(correct / total, 3) if total else None,
        "rows": rows,
    }


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

def _load(path: Path) -> Any:
    with path.open(encoding="utf-8-sig") as f:
        return json.load(f)


def _find_cuts(video_id: str, override: str | None) -> Path | None:
    if override:
        return Path(override)
    hits = glob.glob(f".tmp/video-understanding/{video_id}/scene_changes_*.txt")
    return Path(hits[0]) if hits else None


SWEEP_TOLERANCES_MS = (200.0, 400.0, 800.0)


def run_eval(video_id: str, tolerance_ms: float, cuts_override: str | None,
             fine_override: str | None = None) -> dict:
    paths = analysis_paths(video_id)
    report: dict[str, Any] = {"videoId": video_id, "toleranceMs": tolerance_ms, "metrics": {}}

    rough_doc = _load(paths.rough_scan) if paths.rough_scan.exists() else None
    fine_path = Path(fine_override) if fine_override else (paths.fine_scan_dir / "fine_structure_scan.json")
    fine_doc = _load(fine_path) if fine_path.exists() else None
    graph_path = paths.analysis_root / "structure_graph.json"
    graph_doc = _load(graph_path) if graph_path.exists() else None
    gt_dir = paths.analysis_root / "ground_truth"
    sect_path = gt_dir / "section_boundaries.json"
    sections_doc = _load(sect_path) if sect_path.exists() else None
    cuts_path = _find_cuts(video_id, cuts_override)
    cuts_ms = parse_scene_cuts_ms(cuts_path) if (cuts_path and cuts_path.exists()) else None

    # 1) boundary F1 vs section_boundaries.json
    if rough_doc and sections_doc:
        report["metrics"]["boundaryF1"] = match_events(
            scan_block_boundaries_ms(rough_doc), gt_section_boundaries_ms(sections_doc), tolerance_ms
        )

    # 2) beat P/R/F1 vs human/AI beat GT
    beat_gt_path = gt_dir / "action_beats_ground_truth.json"
    if fine_doc and beat_gt_path.exists():
        report["metrics"]["beatVsGroundTruth"] = match_events(
            scan_beat_anchors_ms(fine_doc), gt_beats_ms(_load(beat_gt_path)), tolerance_ms
        )

    # 3) cut recall + per-block coverage vs scene-cut list
    if fine_doc and rough_doc and cuts_ms is not None:
        report["metrics"]["beatVsCuts"] = match_events(scan_beat_anchors_ms(fine_doc), cuts_ms, tolerance_ms)
        report["metrics"]["perBlockCoverage"] = per_block_cut_coverage(rough_doc, fine_doc, cuts_ms, tolerance_ms)
        report["cutsSource"] = str(cuts_path)

    # 4) role accuracy vs section expectedRole
    if graph_doc and sections_doc and any("expectedRole" in s for s in sections_doc.get("sections", [])):
        report["metrics"]["roleAccuracy"] = role_accuracy(graph_doc, sections_doc)

    # 5) tolerance sweep for the two headline alignment metrics
    sweep: dict[str, dict] = {}
    for tol in SWEEP_TOLERANCES_MS:
        entry: dict[str, float] = {}
        if rough_doc and sections_doc:
            entry["boundaryF1"] = match_events(
                scan_block_boundaries_ms(rough_doc), gt_section_boundaries_ms(sections_doc), tol)["f1"]
        if fine_doc and cuts_ms is not None:
            entry["beatVsCutsF1"] = match_events(scan_beat_anchors_ms(fine_doc), cuts_ms, tol)["f1"]
        if entry:
            sweep[str(int(tol))] = entry
    if sweep:
        report["metrics"]["toleranceSweep"] = sweep
    return report


def _print_report(r: dict) -> None:
    print(f"\n=== eval: {r['videoId']} (tolerance ±{int(r['toleranceMs'])}ms) ===")
    m = r["metrics"]
    if not m:
        print("  no ground truth found for this video.")
        return

    def line(name: str, d: dict) -> None:
        print(f"  {name:<22} P={d['precision']:.2f} R={d['recall']:.2f} F1={d['f1']:.2f} "
              f"(matched {d['matched']}/{d['gtCount']} GT, {d['predOnly']} false-pos"
              + (f", MAE {d['maeMs']:.0f}ms" if d.get('maeMs') is not None else "") + ")")

    if "boundaryF1" in m:
        line("boundary vs sections", m["boundaryF1"])
    if "beatVsGroundTruth" in m:
        line("beat vs human/AI GT", m["beatVsGroundTruth"])
    if "beatVsCuts" in m:
        line("beat vs scene-cuts", m["beatVsCuts"])
    if "roleAccuracy" in m:
        ra = m["roleAccuracy"]
        print(f"  role accuracy (segments)  {ra['accuracy']:.2f} ({ra['correct']}/{ra['total']} sections match expectedRole)")
        for row in ra["rows"]:
            mark = "ok " if row["match"] else "MISS"
            print(f"     [{mark}] {str(row['section'])[:34]:<34} expected={row['expected']:<13} got={row['got']}")
    if "perBlockCoverage" in m:
        print("  per-block cut coverage (matched/cuts within block):")
        for row in m["perBlockCoverage"]:
            cov = f"{row['coverage']:.2f}" if row["coverage"] is not None else "  - "
            print(f"     {row['block']:<11} {row['rangeS'][0]:>6.1f}-{row['rangeS'][1]:<6.1f}s  "
                  f"cuts={row['cutsInside']:<3} beats={row['beats']:<3} covered={row['cutsCovered']:<3} cov={cov}")
    if "toleranceSweep" in m:
        print("  tolerance sweep (F1 at ±ms):")
        for tol, e in m["toleranceSweep"].items():
            parts = [f"{k}={v:.2f}" for k, v in e.items()]
            print(f"     ±{tol}ms: " + "  ".join(parts))
    if r.get("cutsSource"):
        print(f"  cuts source: {r['cutsSource']} (ffmpeg heuristic @0.14 — directional, not human gold)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Score a video scan against available ground truth.")
    p.add_argument("--video-id", default=DEFAULT_VIDEO_ID)
    p.add_argument("--tolerance-ms", type=float, default=400.0,
                   help="Match tolerance for event/boundary alignment (default 400ms).")
    p.add_argument("--cuts", default=None, help="Override path to a scene_changes pts_time file.")
    p.add_argument("--fine-scan", default=None, help="Override path to fine_structure_scan.json (A/B).")
    p.add_argument("--json", action="store_true", help="Emit the raw report as JSON.")
    p.add_argument("--save", action="store_true",
                   help="Write the report to <analysis>/eval_report.json as an A/B baseline.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = run_eval(args.video_id, args.tolerance_ms, args.cuts, args.fine_scan)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_report(report)
    if args.save:
        out = analysis_paths(args.video_id).analysis_root / "eval_report.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nsaved baseline -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
