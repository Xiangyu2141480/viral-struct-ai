#!/usr/bin/env python
"""Extract technical media metadata from a video via ffprobe.

Produces ``stage1_media/media_technical.json`` per the v2 directory layout.

This rescues `aspectRatio / fps / durationMs / videoCodec / audioCodec` from
ffprobe — fields that were previously either missing from Rough Scan output
or hallucinated by the LLM. See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §3.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_DEFAULT_PATHS = analysis_paths(DEFAULT_VIDEO_ID)

SCHEMA_VERSION = "media_technical_v1"

# Known aspect ratios used by short-video platforms. Matched by reduced
# (width, height) ratio. Anything outside this set returns "unknown".
KNOWN_ASPECT_RATIOS: dict[tuple[int, int], str] = {
    (9, 16): "9:16",   # Douyin / Reels / Shorts vertical
    (16, 9): "16:9",   # YouTube horizontal / TVC
    (1, 1): "1:1",     # Instagram square
    (4, 5): "4:5",     # Xiaohongshu portrait
    (2, 3): "2:3",     # Xiaohongshu / Pinterest portrait
    (3, 4): "3:4",     # 4:3 inverted (rare but legal)
    # iPhone full-screen capture (Notch / Dynamic Island devices) — the reduced
    # integer ratios cluster near 9:19.5. Listed individually because
    # reduce_ratio returns an exact gcd tuple; future option: tolerance-based
    # classification (~0.5%) to collapse near-equivalent ratios into one tag.
    (195, 422): "9:19.5",   # iPhone 12/13/14 (1170×2532)
    (131, 284): "9:19.5",   # iPhone 14 Pro / 15 / 16 (1179×2556)
    (215, 466): "9:19.5",   # iPhone 14/15/16 Pro Max (1290×2796)
}


def reduce_ratio(width: int, height: int) -> tuple[int, int]:
    """Return (w, h) reduced by gcd. Used for aspect ratio matching."""
    if width <= 0 or height <= 0:
        return (0, 0)
    g = math.gcd(width, height)
    return (width // g, height // g)


def classify_aspect_ratio(width: int, height: int) -> str:
    """Classify pixel dimensions into a known aspect ratio enum or 'unknown'."""
    reduced = reduce_ratio(width, height)
    return KNOWN_ASPECT_RATIOS.get(reduced, "unknown")


def parse_frame_rate(value: str | None) -> float:
    """Parse ffprobe ``r_frame_rate`` like ``"30000/1001"`` into a float.

    Returns 0.0 if the input is invalid or zero-denominator.
    """
    if not value or "/" not in value:
        try:
            return float(value) if value else 0.0
        except (TypeError, ValueError):
            return 0.0
    num_str, _, den_str = value.partition("/")
    try:
        num = float(num_str)
        den = float(den_str)
    except ValueError:
        return 0.0
    if den == 0:
        return 0.0
    return num / den


def select_stream(streams: list[dict[str, Any]], codec_type: str) -> dict[str, Any] | None:
    """Return the first stream matching the given codec_type, or None."""
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == codec_type:
            return stream
    return None


def build_media_technical(probe: dict[str, Any], *, video_id: str) -> dict[str, Any]:
    """Build the media_technical_v1 dict from a parsed ffprobe response.

    Pure function — no I/O. Raises ValueError on missing video stream.
    """
    streams = probe.get("streams") or []
    video = select_stream(streams, "video")
    if not video:
        raise ValueError("ffprobe response contains no video stream")
    audio = select_stream(streams, "audio")

    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    fps = parse_frame_rate(video.get("r_frame_rate") or video.get("avg_frame_rate"))

    # Duration: prefer the video stream's duration; fall back to format duration.
    duration_s = None
    raw_video_duration = video.get("duration")
    if raw_video_duration is not None:
        try:
            duration_s = float(raw_video_duration)
        except (TypeError, ValueError):
            duration_s = None
    if duration_s is None:
        fmt = probe.get("format") or {}
        try:
            duration_s = float(fmt.get("duration") or 0.0)
        except (TypeError, ValueError):
            duration_s = 0.0

    return {
        "schemaVersion": SCHEMA_VERSION,
        "producedBy": "ffprobe",
        "videoId": video_id,
        "durationMs": int(round(duration_s * 1000.0)),
        "aspectRatio": classify_aspect_ratio(width, height),
        "fps": round(fps, 3),
        "width": width,
        "height": height,
        "videoCodec": str(video.get("codec_name") or "unknown"),
        "audioCodec": str(audio.get("codec_name")) if audio else None,
    }


def run_ffprobe(video_path: Path) -> dict[str, Any]:
    """Invoke ffprobe and return the parsed JSON response.

    Raises RuntimeError if ffprobe is missing or fails.
    """
    if not video_path.exists():
        raise FileNotFoundError(f"video not found: {video_path}")
    command = [
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffprobe not found on PATH — install ffmpeg or pass an alternative tool."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"ffprobe failed (exit {exc.returncode}): {exc.stderr.strip()}"
        ) from exc
    return json.loads(result.stdout)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract technical media metadata via ffprobe (v2 stage1_media)."
    )
    parser.add_argument(
        "--video",
        default=str(_DEFAULT_PATHS.raw_video),
        help="Source video path.",
    )
    parser.add_argument(
        "--video-id",
        default=DEFAULT_VIDEO_ID,
        help="Video id stamped into the output.",
    )
    parser.add_argument(
        "--out",
        default=str(_DEFAULT_PATHS.media_technical),
        help="Output JSON path.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    video_path = Path(args.video)
    probe = run_ffprobe(video_path)
    payload = build_media_technical(probe, video_id=args.video_id)
    write_json(Path(args.out), payload)
    print(f"wrote {args.out}")
    print(
        f"  aspect={payload['aspectRatio']} fps={payload['fps']}"
        f" duration={payload['durationMs']}ms"
        f" codec={payload['videoCodec']}/{payload['audioCodec']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
