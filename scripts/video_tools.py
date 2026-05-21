#!/usr/bin/env python
"""Video preparation utilities for Viral Struct AI agents.

This script intentionally does not call any model provider. It prepares media
inputs that downstream AI agents can inspect: low-FPS previews, real-speed
context clips, slow microscope clips, and boundary inspection packs.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any, Sequence


def fmt_time(seconds: float) -> str:
    if seconds < 0:
        raise ValueError("time cannot be negative")
    return f"{seconds:.3f}"


def parse_time(value: str | float | int) -> float:
    if isinstance(value, (float, int)):
        return float(value)

    text = str(value).strip()
    if ":" not in text:
        seconds = float(text)
        if seconds < 0:
            raise argparse.ArgumentTypeError("time cannot be negative")
        return seconds

    parts = text.split(":")
    if len(parts) > 3:
        raise argparse.ArgumentTypeError(f"invalid time value: {value}")

    try:
        numbers = [float(part) for part in parts]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid time value: {value}") from exc

    while len(numbers) < 3:
        numbers.insert(0, 0.0)
    hours, minutes, seconds = numbers
    total = hours * 3600 + minutes * 60 + seconds
    if total < 0:
        raise argparse.ArgumentTypeError("time cannot be negative")
    return total


def clamp_start(seconds: float) -> float:
    return max(0.0, seconds)


def ensure_end_after_start(start: float, end: float) -> None:
    if end <= start:
        raise ValueError(f"end time must be after start time: start={start}, end={end}")


def scale_filter(max_width: int | None) -> str:
    if max_width is None:
        return ""
    if max_width <= 0:
        raise ValueError("max_width must be positive")
    return f"scale=w=min({max_width}\\,iw):h=-2"


def combine_filters(filters: Sequence[str]) -> str:
    return ",".join(filter(None, filters))


def build_preview_command(
    input_path: str | Path,
    output_path: str | Path,
    *,
    fps: float = 5,
    max_width: int | None = 720,
    crf: int = 28,
    audio: str = "keep",
) -> list[str]:
    if fps <= 0:
        raise ValueError("fps must be positive")
    if audio not in {"keep", "drop"}:
        raise ValueError("audio must be 'keep' or 'drop'")

    filters = combine_filters([f"fps={fps:g}", scale_filter(max_width)])
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        filters,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
    ]
    if audio == "keep":
        command += ["-c:a", "aac", "-b:a", "96k"]
    else:
        command += ["-an"]
    command += ["-movflags", "+faststart", str(output_path)]
    return command


def build_clip_command(
    input_path: str | Path,
    output_path: str | Path,
    *,
    start: float,
    end: float,
    mode: str = "accurate",
    crf: int = 18,
) -> list[str]:
    start = clamp_start(float(start))
    end = float(end)
    ensure_end_after_start(start, end)
    duration = end - start

    if mode == "copy":
        return [
            "ffmpeg",
            "-y",
            "-ss",
            fmt_time(start),
            "-t",
            fmt_time(duration),
            "-i",
            str(input_path),
            "-c",
            "copy",
            str(output_path),
        ]
    if mode != "accurate":
        raise ValueError("mode must be 'accurate' or 'copy'")

    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-ss",
        fmt_time(start),
        "-t",
        fmt_time(duration),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(output_path),
    ]


def build_microscope_command(
    input_path: str | Path,
    output_path: str | Path,
    *,
    start: float,
    end: float,
    playback_fps: float = 5,
    max_width: int | None = 720,
    crf: int = 18,
) -> list[str]:
    start = clamp_start(float(start))
    end = float(end)
    ensure_end_after_start(start, end)
    if playback_fps <= 0:
        raise ValueError("playback_fps must be positive")

    duration = end - start
    filters = combine_filters([f"setpts=N/({playback_fps:g}*TB)", scale_filter(max_width)])

    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-ss",
        fmt_time(start),
        "-t",
        fmt_time(duration),
        "-vf",
        filters,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ]


def build_probe_command(input_path: str | Path) -> list[str]:
    return [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(input_path),
    ]


def output_path(out_dir: str | Path, prefix: str, suffix: str) -> str:
    return str(Path(out_dir) / f"{prefix}_{suffix}.mp4")


def build_inspection_pack(
    input_path: str | Path,
    *,
    out_dir: str | Path,
    prefix: str,
    boundary: float,
    context_radius: float = 1.2,
    microscope_radius: float = 0.4,
    playback_fps: float = 5,
    max_width: int | None = 720,
) -> dict[str, Any]:
    boundary = float(boundary)
    context_start = clamp_start(boundary - context_radius)
    context_end = boundary + context_radius
    microscope_start = clamp_start(boundary - microscope_radius)
    microscope_end = boundary + microscope_radius

    real_output = output_path(out_dir, prefix, "real")
    slow_output = output_path(out_dir, prefix, "slow")

    return {
        "input": str(input_path),
        "boundary": round(boundary, 3),
        "realSpeedClip": {
            "output": real_output,
            "sourceTimeRange": {
                "start": round(context_start, 3),
                "end": round(context_end, 3),
            },
            "purpose": "preserve perceived rhythm, semantic flow, and audio cues",
            "command": build_clip_command(
                input_path,
                real_output,
                start=context_start,
                end=context_end,
                mode="accurate",
            ),
        },
        "slowMicroscopeClip": {
            "output": slow_output,
            "sourceTimeRange": {
                "start": round(microscope_start, 3),
                "end": round(microscope_end, 3),
            },
            "purpose": "preserve transition frames while slowing playback for inspection",
            "playbackFps": playback_fps,
            "timeMapping": f"sourceTime = {microscope_start:.3f} + inspectionTime * {playback_fps:g} / sourceFps",
            "command": build_microscope_command(
                input_path,
                slow_output,
                start=microscope_start,
                end=microscope_end,
                playback_fps=playback_fps,
                max_width=max_width,
            ),
        },
    }


def run(command: Sequence[str], *, dry_run: bool = False) -> None:
    if dry_run:
        print(json.dumps({"command": list(command)}, ensure_ascii=False, indent=2))
        return
    subprocess.run(list(command), check=True)


def write_json(path: str | Path, data: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_probe(args: argparse.Namespace) -> None:
    command = build_probe_command(args.input)
    if args.dry_run:
        print(json.dumps({"command": command}, ensure_ascii=False, indent=2))
        return

    result = subprocess.run(command, check=True, capture_output=True, text=True)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(result.stdout, encoding="utf-8")
    else:
        print(result.stdout)


def run_preview(args: argparse.Namespace) -> None:
    command = build_preview_command(
        args.input,
        args.output,
        fps=args.fps,
        max_width=args.max_width,
        crf=args.crf,
        audio=args.audio,
    )
    run(command, dry_run=args.dry_run)


def run_clip(args: argparse.Namespace) -> None:
    command = build_clip_command(
        args.input,
        args.output,
        start=args.start,
        end=args.end,
        mode=args.mode,
        crf=args.crf,
    )
    run(command, dry_run=args.dry_run)


def run_microscope(args: argparse.Namespace) -> None:
    command = build_microscope_command(
        args.input,
        args.output,
        start=args.start,
        end=args.end,
        playback_fps=args.playback_fps,
        max_width=args.max_width,
        crf=args.crf,
    )
    run(command, dry_run=args.dry_run)


def run_inspection_pack(args: argparse.Namespace) -> None:
    pack = build_inspection_pack(
        args.input,
        out_dir=args.out_dir,
        prefix=args.prefix,
        boundary=args.boundary,
        context_radius=args.context_radius,
        microscope_radius=args.microscope_radius,
        playback_fps=args.playback_fps,
        max_width=args.max_width,
    )

    if args.dry_run:
        print(json.dumps(pack, ensure_ascii=False, indent=2))
        return

    Path(args.out_dir).mkdir(parents=True, exist_ok=True)
    run(pack["realSpeedClip"]["command"])
    run(pack["slowMicroscopeClip"]["command"])
    manifest = Path(args.out_dir) / f"{args.prefix}_inspection.json"
    write_json(manifest, pack)
    print(str(manifest))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare video inputs for Viral Struct AI understanding agents.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    probe = subparsers.add_parser("probe", help="Read video metadata with ffprobe.")
    probe.add_argument("input")
    probe.add_argument("--output")
    probe.add_argument("--dry-run", action="store_true")
    probe.set_defaults(func=run_probe)

    preview = subparsers.add_parser("preview", help="Create a compressed low-FPS global preview.")
    preview.add_argument("input")
    preview.add_argument("output")
    preview.add_argument("--fps", type=float, default=5)
    preview.add_argument("--max-width", type=int, default=720)
    preview.add_argument("--crf", type=int, default=28)
    preview.add_argument("--audio", choices=["keep", "drop"], default="keep")
    preview.add_argument("--dry-run", action="store_true")
    preview.set_defaults(func=run_preview)

    clip = subparsers.add_parser("clip", help="Cut a real-speed source clip.")
    clip.add_argument("input")
    clip.add_argument("output")
    clip.add_argument("--start", type=parse_time, required=True)
    clip.add_argument("--end", type=parse_time, required=True)
    clip.add_argument("--mode", choices=["accurate", "copy"], default="accurate")
    clip.add_argument("--crf", type=int, default=18)
    clip.add_argument("--dry-run", action="store_true")
    clip.set_defaults(func=run_clip)

    microscope = subparsers.add_parser(
        "microscope",
        help="Create a slow microscope clip around a precise source range.",
    )
    microscope.add_argument("input")
    microscope.add_argument("output")
    microscope.add_argument("--start", type=parse_time, required=True)
    microscope.add_argument("--end", type=parse_time, required=True)
    microscope.add_argument("--playback-fps", type=float, default=5)
    microscope.add_argument("--max-width", type=int, default=720)
    microscope.add_argument("--crf", type=int, default=18)
    microscope.add_argument("--dry-run", action="store_true")
    microscope.set_defaults(func=run_microscope)

    pack = subparsers.add_parser(
        "inspection-pack",
        help="Create real-speed and slow microscope clips around one boundary.",
    )
    pack.add_argument("input")
    pack.add_argument("--boundary", type=parse_time, required=True)
    pack.add_argument("--out-dir", required=True)
    pack.add_argument("--prefix", default="boundary")
    pack.add_argument("--context-radius", type=float, default=1.2)
    pack.add_argument("--microscope-radius", type=float, default=0.4)
    pack.add_argument("--playback-fps", type=float, default=5)
    pack.add_argument("--max-width", type=int, default=720)
    pack.add_argument("--dry-run", action="store_true")
    pack.set_defaults(func=run_inspection_pack)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
