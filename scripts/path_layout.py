"""Canonical path layout helper for stage1 video analysis artifacts.

This module centralizes the v2 directory layout so adding a new sample
video means changing one symbol (``--video-id``) rather than editing 9
scripts. Every stage1 entry point reads its argparse defaults from
``analysis_paths(DEFAULT_VIDEO_ID)`` — when teammates want to run the
pipeline against ``tvc`` or ``chocolate_mud_pie``, they pass
``--video-id <name>`` plus the few non-layout-derived parameters they
actually want to override.

Layout convention (see docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md
§5.1) for a single ``video_id``::

    seed_assets/
      raw_videos/<video_id>.mp4                                      # source
      processed_videos/<video_id>_preview_5fps_720w.mp4              # rough scan preview
      analysis/<video_id>/
        analysis_manifest.json                                       # cross-artifact index
        stage1_rough/rough_structure_scan.json                       # Stage 1 contract
        stage1_media/media_technical.json                            # ffprobe-derived
        stage1_media/audio_beat_map.json                             # beat_this output
        stage1_media/audio_beat_map.wav                              # source wav for ASR
        stage1_media/speech_transcript.json                          # ASR output
        stage1_5_assembly/content_transition_timeline.json           # Stage 1.5 merged
        fine_scan/                                                   # Stage 2 outputs
        fine_scan/clips/                                             # per-block clip cache
        boundary_micro_scan/                                         # Stage 1.5 boundary outputs
        boundary_micro_scan/boundary_micro_scan.json                 # boundary merged
        _debug/rough_structure_scan_raw_response.json                # LLM raw dump
        _debug/rough_structure_scan_response_text.txt                # text dump
        _debug/uploaded_file_info.json                               # upload trace

The single conversion knob is ``analysis_root`` / ``raw_videos_root``
(default ``seed_assets/``); tests can swap roots without touching the
field accessors.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, NamedTuple


# ---------------------------------------------------------------------------
# Roots — overridable for tests or alternative deployments.
# Keep as module-level constants (not class fields) so callers can patch in
# unit tests without touching every accessor signature.
# ---------------------------------------------------------------------------

ANALYSIS_ROOT = Path("seed_assets/analysis")
RAW_VIDEOS_ROOT = Path("seed_assets/raw_videos")
PROCESSED_VIDEOS_ROOT = Path("seed_assets/processed_videos")


# ---------------------------------------------------------------------------
# Default video id — every script that previously hardcoded "macbook_neo"
# in its argparse defaults now reads from here. Changing this constant
# changes the entire default pipeline target in one place.
# ---------------------------------------------------------------------------

DEFAULT_VIDEO_ID = "macbook_neo"


class VideoPaths(NamedTuple):
    """All canonical path slots for one ``video_id``.

    Fields are POSIX-style ``pathlib.Path`` instances. Use ``str(path)``
    at argparse boundaries (argparse stores defaults as strings); pathlib
    will handle the platform-specific separator at runtime.

    Field order mirrors the v2 layout reading direction: source video
    first, then primary contracts (rough/media/audio/speech), then
    secondary outputs (fine/boundary/timeline), then index (manifest),
    then debug dumps.
    """

    # Source media
    raw_video: Path
    preview_video: Path

    # Stage 1 — primary contract
    rough_scan: Path

    # Stage 1 — media side-channel
    media_technical: Path
    audio_beat_map: Path
    audio_beat_wav: Path
    speech_transcript: Path

    # Stage 2 — fine scan
    fine_scan_dir: Path
    fine_scan_clips_dir: Path

    # Stage 1.5 — boundary micro scan
    boundary_scan_dir: Path
    boundary_scan_merged: Path

    # Stage 1.5 — assembled timeline
    timeline: Path

    # Cross-artifact index
    analysis_root: Path
    manifest: Path

    # Debug dumps (LLM raw responses, upload traces)
    rough_raw_response: Path
    rough_response_text: Path
    uploaded_file_info: Path


def analysis_paths(
    video_id: str,
    *,
    analysis_root: Path | str = ANALYSIS_ROOT,
    raw_videos_root: Path | str = RAW_VIDEOS_ROOT,
    processed_videos_root: Path | str = PROCESSED_VIDEOS_ROOT,
) -> VideoPaths:
    """Resolve all canonical artifact paths for a given ``video_id``.

    The defaults mirror the v2 layout. Tests can override any root.

    Args:
        video_id: Unique identifier (also the analysis subdir name).
        analysis_root: Parent of ``<video_id>/`` artifact tree.
        raw_videos_root: Where source ``<video_id>.mp4`` lives.
        processed_videos_root: Where preview transcodes live.

    Returns:
        VideoPaths NamedTuple with all 16 canonical slots populated.

    Notes:
        - ``preview_video`` assumes the rough_scan default transcode
          profile (5 fps, 720 px wide). If you reprofile, pass
          ``--video`` to ``rough_scan.py`` explicitly.
        - ``raw_video`` assumes ``.mp4``. For ``.mov`` etc., override
          ``--video`` at the call site rather than parameterizing here.
    """
    analysis_root = Path(analysis_root)
    raw_videos_root = Path(raw_videos_root)
    processed_videos_root = Path(processed_videos_root)

    base = analysis_root / video_id
    media = base / "stage1_media"
    debug = base / "_debug"
    fine = base / "fine_scan"
    boundary = base / "boundary_micro_scan"
    assembly = base / "stage1_5_assembly"

    return VideoPaths(
        raw_video=raw_videos_root / f"{video_id}.mp4",
        preview_video=processed_videos_root / f"{video_id}_preview_5fps_720w.mp4",
        rough_scan=base / "stage1_rough" / "rough_structure_scan.json",
        media_technical=media / "media_technical.json",
        audio_beat_map=media / "audio_beat_map.json",
        audio_beat_wav=media / "audio_beat_map.wav",
        speech_transcript=media / "speech_transcript.json",
        fine_scan_dir=fine,
        fine_scan_clips_dir=fine / "clips",
        boundary_scan_dir=boundary,
        boundary_scan_merged=boundary / "boundary_micro_scan.json",
        timeline=assembly / "content_transition_timeline.json",
        analysis_root=base,
        manifest=base / "analysis_manifest.json",
        rough_raw_response=debug / "rough_structure_scan_raw_response.json",
        rough_response_text=debug / "rough_structure_scan_response_text.txt",
        uploaded_file_info=debug / "uploaded_file_info.json",
    )


def apply_video_id_defaults(args: Any, mapping: dict[str, str]) -> None:
    """Fill ``None`` path arguments from ``analysis_paths(args.video_id)``.

    For each ``arg_attr -> VideoPaths field`` pair in ``mapping``, if
    ``getattr(args, arg_attr)`` is ``None``, set it to the string form of the
    corresponding path derived from ``args.video_id``. Mutates ``args``.

    This makes ``--video-id`` actually re-derive the default input/output
    paths. Without it, every path argument defaults to the module-level
    DEFAULT_VIDEO_ID layout, so passing ``--video-id other`` *without* also
    passing every ``--out`` silently reads/writes macbook_neo's directory —
    the footgun that once overwrote macbook_neo's media_technical.json.

    Usage: declare the relevant path args with ``default=None`` in the parser,
    then call this once after ``parse_args``. Explicitly-passed paths (non-None)
    always win.
    """
    paths = analysis_paths(args.video_id)
    for arg_attr, field in mapping.items():
        if getattr(args, arg_attr, None) is None:
            setattr(args, arg_attr, str(getattr(paths, field)))
