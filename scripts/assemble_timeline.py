#!/usr/bin/env python
"""Assemble Stage 1 content blocks and Stage 1.5 boundary patches into one timeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def round_time(value: float) -> float:
    return round(float(value), 3)


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def require_time_range(unit: dict[str, Any]) -> dict[str, float]:
    time_range = unit.get("timeRange")
    if not isinstance(time_range, dict):
        raise ValueError(f"missing timeRange: {unit.get('id')}")
    start = round_time(time_range["start"])
    end = round_time(time_range["end"])
    if end <= start:
        raise ValueError(f"timeRange end must be after start: {unit.get('id')}")
    return {"start": start, "end": end}


def build_content_unit(block: dict[str, Any]) -> dict[str, Any]:
    unit = {
        "id": str(block["id"]),
        "unitType": "content_block",
        "timeRange": require_time_range(block),
        "sourceBlockId": str(block["id"]),
    }
    # v0.2: dropped audioOrRhythmSignals and confidence — both removed from
    # Rough Scan schema per docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md.
    for key in (
        "coarseRoleGuess",
        "boundaryReason",
        "observableSummary",
        "visualSignals",
        "textSignals",
        "fineScanFocusQuestions",
    ):
        if key in block:
            unit[key] = block[key]
    return unit


def boundary_results(boundary_scan: dict[str, Any]) -> list[dict[str, Any]]:
    boundaries = boundary_scan.get("boundaries")
    if not isinstance(boundaries, list):
        raise ValueError("Boundary scan requires boundaries list.")
    return boundaries


def stage_one_boundary_ids(rough_scan: dict[str, Any]) -> set[str]:
    return {
        str(boundary["id"])
        for boundary in rough_scan.get("boundaryCandidates", []) or []
        if boundary.get("id")
    }


def apply_time_range_patch(
    content_units: dict[str, dict[str, Any]],
    patch: dict[str, Any] | None,
) -> None:
    if not patch:
        return
    block_id = str(patch.get("id", ""))
    if block_id not in content_units:
        raise ValueError(f"timeline patch references unknown block: {block_id}")
    time_patch = patch.get("timeRangePatch") or {}
    time_range = dict(content_units[block_id]["timeRange"])
    if "start" in time_patch and time_patch["start"] is not None:
        time_range["start"] = round_time(time_patch["start"])
    if "end" in time_patch and time_patch["end"] is not None:
        time_range["end"] = round_time(time_patch["end"])
    if time_range["end"] <= time_range["start"]:
        raise ValueError(f"timeline patch creates invalid block range: {block_id}")
    content_units[block_id]["timeRange"] = time_range


def normalize_transition_unit(
    transition: dict[str, Any],
    *,
    boundary_id: str,
    from_block_id: str,
    to_block_id: str,
) -> dict[str, Any]:
    transition_unit = dict(transition)
    # v2.5: unify id to the boundary's canonical id. A transition unit IS the
    # Stage 1.5 manifestation of a Stage 1 boundary — they share identity.
    # This eliminates the historical 3-way ID drift
    # (boundary_001 / rough_trans_001 / transition_boundary_001).
    # See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §4.3.
    transition_unit["id"] = boundary_id
    transition_unit["unitType"] = "transition"
    transition_unit["boundaryId"] = boundary_id
    transition_unit["fromBlockId"] = from_block_id
    transition_unit["toBlockId"] = to_block_id
    transition_unit["timeRange"] = require_time_range(transition_unit)
    # v2.5: canonicalBoundaryTime is the single source of truth for boundary
    # time. Stage 1.5 has the more accurate semanticPivotTime, so prefer it
    # when present; fall back to the midpoint of timeRange otherwise.
    pivot = transition_unit.get("semanticPivotTime")
    if pivot is not None:
        transition_unit["canonicalBoundaryTime"] = round(float(pivot), 3)
    else:
        time_range = transition_unit["timeRange"]
        midpoint = (float(time_range["start"]) + float(time_range["end"])) / 2.0
        transition_unit["canonicalBoundaryTime"] = round(midpoint, 3)
    return transition_unit


def collect_patches(
    rough_scan: dict[str, Any],
    boundary_scan: dict[str, Any],
    content_units: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], set[str]]:
    transitions: list[dict[str, Any]] = []
    patched_boundary_ids: set[str] = set()

    for result in boundary_results(boundary_scan):
        boundary_id = str(result.get("boundaryId", ""))
        patch = result.get("timelinePatch")
        if not boundary_id or not isinstance(patch, dict):
            continue

        patch_type = patch.get("patchType")
        if patch_type not in {"insert_transition_unit", "adjust_content_boundary"}:
            raise ValueError(f"unknown timeline patch type: {patch_type}")

        apply_time_range_patch(content_units, patch.get("fromBlockPatch"))
        apply_time_range_patch(content_units, patch.get("toBlockPatch"))
        patched_boundary_ids.add(boundary_id)

        if patch_type == "insert_transition_unit":
            transition = patch.get("transitionUnit")
            if not isinstance(transition, dict):
                raise ValueError(f"insert_transition_unit missing transitionUnit: {boundary_id}")
            transitions.append(
                normalize_transition_unit(
                    transition,
                    boundary_id=boundary_id,
                    from_block_id=str(patch.get("fromBlockId", "")),
                    to_block_id=str(patch.get("toBlockId", "")),
                )
            )

    unknown_boundaries = patched_boundary_ids - stage_one_boundary_ids(rough_scan)
    if unknown_boundaries:
        raise ValueError(f"boundary patch references unknown Stage 1 boundary: {sorted(unknown_boundaries)}")
    return transitions, patched_boundary_ids


def validate_timeline_units(units: list[dict[str, Any]]) -> None:
    previous_end: float | None = None
    previous_id = ""
    for unit in units:
        time_range = require_time_range(unit)
        if previous_end is not None and time_range["start"] < previous_end:
            raise ValueError(
                f"timeline overlap: {previous_id} ends at {previous_end}, "
                f"{unit['id']} starts at {time_range['start']}"
            )
        previous_end = time_range["end"]
        previous_id = str(unit["id"])


def assemble_timeline(rough_scan: dict[str, Any], boundary_scan: dict[str, Any]) -> dict[str, Any]:
    blocks = rough_scan.get("contentBlocks")
    if not isinstance(blocks, list):
        raise ValueError("Stage 1 rough scan requires contentBlocks list.")

    content_units = {str(block["id"]): build_content_unit(block) for block in blocks}
    transitions, patched_boundary_ids = collect_patches(rough_scan, boundary_scan, content_units)
    timeline_units = list(content_units.values()) + transitions
    timeline_units.sort(key=lambda unit: (float(unit["timeRange"]["start"]), float(unit["timeRange"]["end"])))
    validate_timeline_units(timeline_units)

    stage_one_boundaries = stage_one_boundary_ids(rough_scan)
    return {
        "schemaVersion": "content_transition_timeline_v1",
        "videoId": rough_scan.get("videoId", "video"),
        "timelineUnits": timeline_units,
        "assemblyStats": {
            "contentBlockCount": len(content_units),
            "stageOneBoundaryCount": len(stage_one_boundaries),
            "patchedBoundaryCount": len(patched_boundary_ids),
            "transitionUnitCount": len(transitions),
            "unscannedBoundaryCount": len(stage_one_boundaries - patched_boundary_ids),
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Assemble Stage 1 content blocks and Stage 1.5 boundary patches into one timeline."
    )
    parser.add_argument("--rough-scan", default="seed_assets/analysis/macbook_neo/stage1_rough/rough_structure_scan.json")
    parser.add_argument(
        "--boundary-scan",
        default="seed_assets/analysis/macbook_neo/boundary_micro_scan/boundary_micro_scan.json",
    )
    parser.add_argument("--out", default="seed_assets/analysis/macbook_neo/stage1_5_assembly/content_transition_timeline.json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    assembled = assemble_timeline(load_json(args.rough_scan), load_json(args.boundary_scan))
    write_json(args.out, assembled)
    print(f"wrote {args.out}")
    print(
        "timeline_units={units} content_blocks={blocks} transitions={transitions} patched_boundaries={patched}".format(
            units=len(assembled["timelineUnits"]),
            blocks=assembled["assemblyStats"]["contentBlockCount"],
            transitions=assembled["assemblyStats"]["transitionUnitCount"],
            patched=assembled["assemblyStats"]["patchedBoundaryCount"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
