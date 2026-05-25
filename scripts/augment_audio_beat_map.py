#!/usr/bin/env python
"""Derive v2 audio_beat_map fields from existing v1 output.

This script is a pure post-processor — it does NOT invoke beat_this. Instead
it reads an existing ``audio_beat_map.json`` (v1, no schemaVersion) and adds:

- ``schemaVersion: "audio_beat_map_v2"``
- ``firstDownbeatAt: number | null`` — useful for hook window judgement
- ``tempo.stability: number`` in [0, 1] — derived from std/mean of inter-downbeat intervals

See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §3 (Agent A) for motivation.
The full v2 wrapper (beat_this CLI integration) is deferred to Phase 2.5+;
this script bridges the gap by deriving what we can from the existing data.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_DEFAULT_PATHS = analysis_paths(DEFAULT_VIDEO_ID)

SCHEMA_VERSION = "audio_beat_map_v2"


def first_downbeat_time(beats: list[dict[str, Any]]) -> float | None:
    """Return the time of the first beat with isDownbeat=true, else None."""
    for beat in beats:
        if not isinstance(beat, dict):
            continue
        if beat.get("isDownbeat") is True:
            time = beat.get("time")
            if time is not None:
                return float(time)
    return None


def downbeat_times(beats: list[dict[str, Any]]) -> list[float]:
    """Return all times where isDownbeat=true, in order."""
    return [
        float(beat["time"])
        for beat in beats
        if isinstance(beat, dict)
        and beat.get("isDownbeat") is True
        and beat.get("time") is not None
    ]


def inter_downbeat_intervals(times: list[float]) -> list[float]:
    """Compute adjacent differences (IBI) from a list of times."""
    return [times[i + 1] - times[i] for i in range(len(times) - 1)]


def tempo_stability(beats: list[dict[str, Any]]) -> float:
    """Compute tempo stability in [0, 1].

    Defined as ``1 / (1 + std/mean)`` of the inter-downbeat intervals.
    A value near 1 means tightly metronomic (BPM doesn't drift); a value
    near 0 means highly variable (free-time speech, no rhythmic backing).

    Returns 0.0 when there are fewer than 3 downbeats (insufficient data).
    """
    times = downbeat_times(beats)
    intervals = inter_downbeat_intervals(times)
    if len(intervals) < 2:
        return 0.0
    mean = statistics.fmean(intervals)
    if mean <= 0 or not math.isfinite(mean):
        return 0.0
    std = statistics.pstdev(intervals)
    coefficient_of_variation = std / mean
    stability = 1.0 / (1.0 + coefficient_of_variation)
    return round(stability, 4)


def augment_beat_map(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a v2-augmented copy of the v1 audio_beat_map payload.

    Pure function — no I/O. Preserves all existing fields; adds three new ones
    if they aren't already present. Idempotent: re-running on a v2 payload
    yields the same result.
    """
    augmented = json.loads(json.dumps(payload, ensure_ascii=False))
    beats = augmented.get("beats")
    if not isinstance(beats, list):
        raise ValueError("audio_beat_map payload must include a 'beats' list")

    augmented["schemaVersion"] = SCHEMA_VERSION
    augmented["firstDownbeatAt"] = first_downbeat_time(beats)

    tempo = augmented.get("tempo")
    if not isinstance(tempo, dict):
        tempo = {}
        augmented["tempo"] = tempo
    tempo["stability"] = tempo_stability(beats)

    return augmented


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Augment v1 audio_beat_map.json with v2 derived fields."
    )
    parser.add_argument(
        "--in",
        dest="input_path",
        default=str(_DEFAULT_PATHS.audio_beat_map),
        help="Input v1 audio_beat_map.json path.",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output v2 path (defaults to overwriting input in-place).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    src = Path(args.input_path)
    dst = Path(args.out) if args.out else src

    payload = read_json(src)
    augmented = augment_beat_map(payload)
    write_json(dst, augmented)

    print(f"wrote {dst}")
    print(
        f"  schemaVersion={augmented['schemaVersion']}"
        f" firstDownbeatAt={augmented['firstDownbeatAt']}"
        f" tempo.bpm={augmented.get('tempo', {}).get('bpm')}"
        f" tempo.stability={augmented.get('tempo', {}).get('stability')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
