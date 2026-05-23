#!/usr/bin/env python
"""Build the top-level ``analysis_manifest.json`` for a video's stage1 artifacts.

This is the cross-artifact index introduced in the v2 directory layout.
See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §5.1.

The manifest enumerates the known stage1 artifacts that should accompany
a Fine Scan run, recording each one's path, schemaVersion (if discoverable),
and existence. Consumers can use this single index to bootstrap reads
instead of hunting through the filesystem.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

SCHEMA_VERSION = "analysis_manifest_v1"


class ArtifactSpec(NamedTuple):
    """Declarative spec for one stage1 artifact.

    ``relative_path`` is relative to the analysis root (e.g. ``macbook_neo/``).

    Uses NamedTuple instead of @dataclass(frozen=True) for compatibility with
    importlib.util.spec_from_file_location loading used by our tests
    (dataclass requires the module to be registered in sys.modules).
    """

    key: str
    relative_path: str
    description: str


# Canonical artifact roster — keep aligned with v2 directory layout.
ARTIFACTS: tuple[ArtifactSpec, ...] = (
    ArtifactSpec(
        key="rough",
        relative_path="stage1_rough/rough_structure_scan.json",
        description="Doubao 5fps rough content-block segmentation.",
    ),
    ArtifactSpec(
        key="media",
        relative_path="stage1_media/media_technical.json",
        description="ffprobe-derived technical metadata (aspect, fps, codec).",
    ),
    ArtifactSpec(
        key="audio",
        relative_path="stage1_media/audio_beat_map.json",
        description="beat_this audio beat map + BPM.",
    ),
    ArtifactSpec(
        key="speech",
        relative_path="stage1_media/speech_transcript.json",
        description="Volcengine Doubao ASR transcript (hasSpeech=false for BGM-only videos).",
    ),
    ArtifactSpec(
        key="timeline",
        relative_path="stage1_5_assembly/content_transition_timeline.json",
        description="Stage 1.5 assembled timeline (content blocks + transitions).",
    ),
)


def read_schema_version(json_path: Path) -> str | None:
    """Best-effort schemaVersion extractor. Returns None if file missing or unreadable."""
    if not json_path.exists():
        return None
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(payload, dict):
        version = payload.get("schemaVersion")
        if isinstance(version, str):
            return version
    return None


def file_mtime_iso(json_path: Path) -> str | None:
    """Return file mtime in ISO 8601 UTC, or None if missing."""
    if not json_path.exists():
        return None
    ts = json_path.stat().st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def build_artifact_entry(spec: ArtifactSpec, analysis_root: Path) -> dict[str, Any]:
    """Build one artifact entry for the manifest."""
    full_path = analysis_root / spec.relative_path
    return {
        "path": spec.relative_path,
        "description": spec.description,
        "exists": full_path.exists(),
        "schemaVersion": read_schema_version(full_path),
        "lastModified": file_mtime_iso(full_path),
    }


def build_manifest(
    *,
    video_id: str,
    analysis_root: Path,
    video_category: str = "unknown",
) -> dict[str, Any]:
    """Build the full analysis_manifest_v1 payload.

    Pure function — only reads files via ``build_artifact_entry``;
    does not write.
    """
    artifacts = {
        spec.key: build_artifact_entry(spec, analysis_root) for spec in ARTIFACTS
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": video_id,
        "videoCategory": video_category,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "artifacts": artifacts,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build the v2 analysis_manifest.json indexing all stage1 artifacts."
    )
    parser.add_argument(
        "--analysis-root",
        default="seed_assets/analysis/macbook_neo",
        help="Directory containing stage1_rough/, stage1_media/, stage1_5_assembly/.",
    )
    parser.add_argument(
        "--video-id",
        default="macbook_neo",
        help="Video id stamped into the manifest.",
    )
    parser.add_argument(
        "--video-category",
        default="unknown",
        help="Category tag (e.g. 3c / beauty / food / unknown).",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output path (defaults to <analysis-root>/analysis_manifest.json).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    analysis_root = Path(args.analysis_root)
    out_path = Path(args.out) if args.out else analysis_root / "analysis_manifest.json"

    manifest = build_manifest(
        video_id=args.video_id,
        analysis_root=analysis_root,
        video_category=args.video_category,
    )
    write_json(out_path, manifest)
    print(f"wrote {out_path}")
    for key, entry in manifest["artifacts"].items():
        status = "ok" if entry["exists"] else "missing"
        ver = entry["schemaVersion"] or "—"
        print(f"  {key:<10} {status:<8} {ver:<35} {entry['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
