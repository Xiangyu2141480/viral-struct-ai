#!/usr/bin/env python
"""Code-owned visual peak detection for Fine Scan v0.3.

This module is intentionally model-free. It computes per-frame change signals
from a clip, finds prominent peaks, and selects which peaks to forward to the
per-peak semantic model. Timing is bit-exact across runs; the model never sees
or produces timestamps in v0.3.

Public surface:
- compute_visual_score_series_from_clip(clip_path) -> list[{tMs, motionScore, channels}]
- detect_visual_peaks_from_scores(samples, *, min_distance_ms, min_prominence)
- select_peaks_for_block(peaks, *, block_duration_ms, peaks_per_second, max_peaks, ...)

The detector wraps scipy.signal.find_peaks (do not reimplement local-maxima).
"""

from __future__ import annotations

import math
from typing import Any, Iterable


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _sanitize_scores(samples: list[dict[str, Any]]) -> tuple[list[int], list[float]]:
    """Return (times_ms, clean_scores) where NaN is replaced with 0.0."""
    times: list[int] = []
    scores: list[float] = []
    for sample in samples:
        t = int(round(float(sample["tMs"])))
        s = _to_float(sample.get("motionScore"))
        if math.isnan(s):
            s = 0.0
        times.append(t)
        scores.append(s)
    return times, scores


def detect_visual_peaks_from_scores(
    samples: list[dict[str, Any]],
    *,
    min_distance_ms: int = 250,
    min_prominence: float = 0.5,
) -> list[dict[str, Any]]:
    """Find prominent peaks in a per-sample motion score series.

    Wraps scipy.signal.find_peaks. Inputs:
        samples: list of {"tMs": int, "motionScore": float}
        min_distance_ms: minimum spacing between two returned peaks
        min_prominence: minimum scipy prominence (z-score units by convention)

    Returns: list of {"peakId", "tMs", "prominence", "motionScore"}, ordered
    by time, with NaN scores treated as 0.
    """
    if not samples:
        return []

    times, scores = _sanitize_scores(samples)
    if len(times) < 2:
        return []

    step_ms = max(1, times[1] - times[0])
    # ceil so "min_distance_ms=250" with 100ms steps enforces ≥3 samples (≥300ms),
    # never collapses to 2 samples (200ms) via banker's rounding.
    distance_samples = max(1, math.ceil(min_distance_ms / step_ms))

    import numpy as np
    from scipy.signal import find_peaks

    score_array = np.asarray(scores, dtype=np.float64)
    indices, props = find_peaks(
        score_array,
        prominence=float(min_prominence),
        distance=distance_samples,
    )

    prominences = props.get("prominences", np.zeros_like(indices, dtype=np.float64))
    peaks: list[dict[str, Any]] = []
    for order, idx in enumerate(indices.tolist(), start=1):
        peaks.append(
            {
                "peakId": f"peak_{order:03d}",
                "tMs": int(times[idx]),
                "prominence": float(prominences[order - 1]),
                "motionScore": float(score_array[idx]),
            }
        )
    return peaks


def select_peaks_for_block(
    peaks: list[dict[str, Any]],
    *,
    block_duration_ms: int,
    peaks_per_second: float = 0.8,
    max_peaks: int = 12,
    min_block_seconds: float = 1.5,
    boundary_guard_ms: int = 250,
) -> list[dict[str, Any]]:
    """S3'-minimal peak selector.

    Pipeline:
      1. Skip blocks shorter than min_block_seconds (return []).
      2. Drop peaks within boundary_guard_ms of block start/end.
      3. Compute target = clamp(round(block_seconds * peaks_per_second), 1, max_peaks).
      4. Take top-target peaks by prominence (no floor padding).
      5. Sort selected peaks by tMs ascending.

    No relative-prominence filter, no boundary fallback. These are deliberately
    deferred to future iterations.
    """
    block_seconds = float(block_duration_ms) / 1000.0
    if block_seconds < float(min_block_seconds):
        return []
    if not peaks:
        return []

    end_guard = int(block_duration_ms) - int(boundary_guard_ms)
    guarded = [
        peak
        for peak in peaks
        if int(boundary_guard_ms) <= int(peak["tMs"]) <= end_guard
    ]
    if not guarded:
        return []

    target_raw = round(block_seconds * float(peaks_per_second))
    target = max(1, min(int(max_peaks), int(target_raw)))

    by_prominence = sorted(
        guarded,
        key=lambda p: float(p.get("prominence", 0.0)),
        reverse=True,
    )
    selected = by_prominence[:target]
    selected.sort(key=lambda p: int(p["tMs"]))
    return selected


def _robust_zscore_per_column(arr: Any) -> Any:
    """Median + MAD z-score per column. Outlier-resistant vs mean+std."""
    import numpy as np

    median = np.median(arr, axis=0)
    mad = np.median(np.abs(arr - median), axis=0)
    # Columns with MAD=0 (all-equal or all-zero) → z-score = 0 for every row.
    mad_safe = np.where(mad < 1e-9, 1.0, mad)
    z = (arr - median) / (1.4826 * mad_safe)
    # Zero out columns where MAD was effectively 0 (signal is flat).
    z[:, mad < 1e-9] = 0.0
    return z


def compute_visual_score_series_from_clip(
    clip_path: str,
    *,
    target_fps: float = 10.0,
    small_size: tuple[int, int] = (320, 180),
) -> list[dict[str, Any]]:
    """Extract per-frame visual change scores from a clip.

    Pipeline:
      1. PyAV decodes the clip; samples by wall-clock time at target_fps
         (handles variable-frame-rate sources correctly).
      2. Each frame is downscaled with INTER_AREA to small_size.
      3. Three channels computed against the previous sample:
           hist_delta : 1 - cv2.compareHist(HSV-hue histograms, HISTCMP_CORREL)
           frame_diff : cv2.absdiff(grayscale).mean()
           flow_mag   : cv2.DISOpticalFlow PRESET_FAST → magnitude().mean()
      4. Robust z-norm per channel (median + MAD), then max-pool to a single
         combined motionScore per sample (ready for scipy.signal.find_peaks).

    First sample has zero in every channel (no previous frame to diff).
    """
    import av
    import cv2
    import numpy as np

    container = av.open(str(clip_path))
    try:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"

        sample_period_s = 1.0 / float(target_fps)
        next_sample_time = 0.0

        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)

        samples: list[dict[str, Any]] = []
        prev_gray = None
        prev_hist = None

        for frame in container.decode(stream):
            if frame.time is None:
                continue
            if frame.time + 1e-6 < next_sample_time:
                continue
            next_sample_time = frame.time + sample_period_s

            bgr = frame.to_ndarray(format="bgr24")
            small_bgr = cv2.resize(bgr, small_size, interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2GRAY)
            hue = cv2.split(cv2.cvtColor(small_bgr, cv2.COLOR_BGR2HSV))[0]
            hist = cv2.calcHist([hue], [0], None, [32], [0, 180])
            cv2.normalize(hist, hist)

            t_ms = int(round(frame.time * 1000))

            if prev_gray is None:
                hd = 0.0
                fd = 0.0
                fm = 0.0
            else:
                # DIS optical flow needs identical input dimensions; assert before calc.
                assert gray.shape == prev_gray.shape, (
                    f"shape mismatch: {gray.shape} vs {prev_gray.shape}"
                )
                hd = 1.0 - float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))
                fd = float(cv2.absdiff(gray, prev_gray).mean())
                flow = dis.calc(prev_gray, gray, None)
                fm = float(cv2.magnitude(flow[..., 0], flow[..., 1]).mean())

            samples.append(
                {
                    "tMs": t_ms,
                    "channels": {
                        "hist_delta": float(hd),
                        "frame_diff": float(fd),
                        "flow_mag": float(fm),
                    },
                }
            )
            prev_gray = gray
            prev_hist = hist
    finally:
        container.close()

    if not samples:
        return []

    # Robust z-norm per channel, then max-pool.
    raw = np.array(
        [
            [s["channels"]["hist_delta"], s["channels"]["frame_diff"], s["channels"]["flow_mag"]]
            for s in samples
        ],
        dtype=np.float64,
    )
    z = _robust_zscore_per_column(raw)
    combined = z.max(axis=1)

    for i, sample in enumerate(samples):
        sample["motionScore"] = float(combined[i])

    # First sample has no diff signal; force motionScore to 0 to avoid spurious
    # peaks at clip start (consistent with channels=0).
    samples[0]["motionScore"] = 0.0
    return samples
