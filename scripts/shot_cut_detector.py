#!/usr/bin/env python
"""Hard shot-cut detection via ffmpeg scene detection.

Wraps ``ffmpeg -vf select='gt(scene,T)',showinfo`` and parses the printed
``pts_time`` values into cut timestamps. This is the signal the fine scan was
missing: it keyed candidates on motion/histogram peaks, but a hard cut between
visually *similar* shots produces little motion, and a cut during sustained
motion is a discrete scene spike that max-pooling buries. ffmpeg's frame-to-frame
``scene`` score catches both.

For the learned upgrade see TransNet V2 (Soucek & Lokoc, arXiv 2008.04838); this
ffmpeg wrapper is the cheap, dependency-free first tier.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

_PTS_RE = re.compile(r"pts_time:([0-9.]+)")


def parse_showinfo_pts(stderr_text: str) -> list[float]:
    """Extract sorted pts_time values (seconds) from ffmpeg showinfo stderr."""
    return sorted(float(m) for m in _PTS_RE.findall(stderr_text or ""))


def build_scene_detect_command(
    video_path: str | Path, threshold: float, ffmpeg_bin: str = "ffmpeg"
) -> list[str]:
    if not (0.0 < threshold < 1.0):
        raise ValueError(f"scene threshold must be in (0,1): {threshold}")
    return [
        ffmpeg_bin,
        "-hide_banner",
        "-i",
        str(video_path),
        "-filter:v",
        f"select='gt(scene,{threshold})',showinfo",
        "-an",
        "-f",
        "null",
        "-",
    ]


def detect_cuts(
    video_path: str | Path,
    *,
    threshold: float = 0.3,
    ffmpeg_bin: str = "ffmpeg",
    timeout: int = 180,
) -> list[float]:
    """Return sorted hard-cut timestamps (seconds), relative to ``video_path``.

    Robust to ffmpeg's nonzero exit on the null muxer: showinfo writes to stderr
    regardless, so we parse stderr defensively rather than checking the code.
    """
    cmd = build_scene_detect_command(video_path, threshold, ffmpeg_bin)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return parse_showinfo_pts(result.stderr)
