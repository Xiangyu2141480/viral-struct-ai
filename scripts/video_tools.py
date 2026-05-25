#!/usr/bin/env python
"""Video preparation utilities for Viral Struct AI agents.

This script intentionally does not call any model provider. It prepares media
inputs that downstream AI agents can inspect: low-FPS previews, real-speed
context clips, slow microscope clips, and boundary inspection packs.
"""

from __future__ import annotations

import argparse
import json
import statistics
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


def build_peak_window_command(
    input_path: str | Path,
    output_path: str | Path,
    *,
    block_start: float,
    block_end: float,
    peak_time: float,
    pre_context: float = 0.6,
    post_context: float = 0.8,
) -> list[str]:
    block_start_f = float(block_start)
    block_end_f = float(block_end)
    peak_time_f = float(peak_time)
    ensure_end_after_start(block_start_f, block_end_f)
    if peak_time_f < block_start_f or peak_time_f > block_end_f:
        raise ValueError(
            f"peak_time {peak_time_f} must lie within block [{block_start_f}, {block_end_f}]"
        )
    if pre_context < 0 or post_context < 0:
        raise ValueError("pre_context and post_context must be non-negative")

    start = max(block_start_f, peak_time_f - float(pre_context))
    end = min(block_end_f, peak_time_f + float(post_context))
    return build_clip_command(input_path, output_path, start=start, end=end, mode="copy")


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
        "-ss",
        fmt_time(start),
        "-t",
        fmt_time(duration),
        "-i",
        str(input_path),
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


def build_extract_audio_command(
    input_path: str | Path,
    output_path: str | Path,
    *,
    sample_rate: int = 44100,
    channels: int = 1,
) -> list[str]:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if channels <= 0:
        raise ValueError("channels must be positive")

    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]


def build_beat_this_command(
    audio_path: str | Path,
    beats_output_path: str | Path,
    *,
    beat_this_bin: str = "beat_this",
    gpu: int | None = -1,
    model: str | None = None,
    dbn: bool = False,
) -> list[str]:
    command = [beat_this_bin, str(audio_path), "-o", str(beats_output_path)]
    if gpu is not None:
        command += ["--gpu", str(gpu)]
    if model:
        command += ["--model", model]
    if dbn:
        command += ["--dbn"]
    return command


def parse_beat_number(value: str) -> int:
    text = value.strip().lower()
    if text in {"downbeat", "down"}:
        return 1
    if text in {"beat", ""}:
        return 0
    return int(float(text))


def parse_beat_this_file(path: str | Path) -> list[dict[str, Any]]:
    beats: list[dict[str, Any]] = []
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.replace(",", "\t").split()
        if not parts:
            continue
        time = float(parts[0])
        beat_number = parse_beat_number(parts[1]) if len(parts) > 1 else 0
        beats.append(
            {
                "time": round(time, 3),
                "beatNumber": beat_number,
                "isDownbeat": beat_number == 1,
            }
        )
    return beats


def estimate_tempo_bpm(beats: list[dict[str, Any]]) -> float | None:
    if len(beats) < 2:
        return None
    intervals = [
        beats[i + 1]["time"] - beats[i]["time"]
        for i in range(len(beats) - 1)
        if beats[i + 1]["time"] > beats[i]["time"]
    ]
    if not intervals:
        return None
    return round(60.0 / statistics.median(intervals), 2)


def build_audio_beat_map(
    *,
    video_id: str,
    audio_source: str | Path,
    beats: list[dict[str, Any]],
    method: str = "beat_this",
) -> dict[str, Any]:
    downbeats = [beat for beat in beats if beat.get("isDownbeat")]
    return {
        "videoId": video_id,
        "audioSource": str(audio_source),
        "method": {
            "primary": method,
            "outputFormat": "beat_this .beats TSV; beatNumber=1 means downbeat",
        },
        "tempo": {
            "bpm": estimate_tempo_bpm(beats),
            "confidence": None,
        },
        "beats": beats,
        "downbeats": downbeats,
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


def run_extract_audio(args: argparse.Namespace) -> None:
    command = build_extract_audio_command(
        args.input,
        args.output,
        sample_rate=args.sample_rate,
        channels=args.channels,
    )
    run(command, dry_run=args.dry_run)


def run_beat_map(args: argparse.Namespace) -> None:
    output = Path(args.output)
    audio_output = Path(args.audio_output) if args.audio_output else output.with_suffix(".wav")
    beats_output = Path(args.beats_output) if args.beats_output else output.with_suffix(".beats")

    extract_command = build_extract_audio_command(
        args.input,
        audio_output,
        sample_rate=args.sample_rate,
        channels=args.channels,
    )
    beat_command = build_beat_this_command(
        audio_output,
        beats_output,
        beat_this_bin=args.beat_this_bin,
        gpu=args.gpu,
        model=args.model,
        dbn=args.dbn,
    )

    if args.dry_run:
        print(
            json.dumps(
                {
                    "extractAudioCommand": extract_command,
                    "beatThisCommand": beat_command,
                    "output": str(output),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    audio_output.parent.mkdir(parents=True, exist_ok=True)
    beats_output.parent.mkdir(parents=True, exist_ok=True)
    run(extract_command)
    run(beat_command)
    beat_map = build_audio_beat_map(
        video_id=args.video_id,
        audio_source=audio_output,
        beats=parse_beat_this_file(beats_output),
        method="beat_this",
    )
    write_json(output, beat_map)
    print(str(output))


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

    extract_audio = subparsers.add_parser("extract-audio", help="Extract mono WAV audio for beat tracking.")
    extract_audio.add_argument("input")
    extract_audio.add_argument("output")
    extract_audio.add_argument("--sample-rate", type=int, default=44100)
    extract_audio.add_argument("--channels", type=int, default=1)
    extract_audio.add_argument("--dry-run", action="store_true")
    extract_audio.set_defaults(func=run_extract_audio)

    beat_map = subparsers.add_parser("beat-map", help="Run Beat-This and write AudioBeatMap JSON.")
    beat_map.add_argument("input")
    beat_map.add_argument("output")
    beat_map.add_argument("--video-id", default="unknown")
    beat_map.add_argument("--audio-output")
    beat_map.add_argument("--beats-output")
    beat_map.add_argument("--sample-rate", type=int, default=44100)
    beat_map.add_argument("--channels", type=int, default=1)
    beat_map.add_argument("--beat-this-bin", default="beat_this")
    beat_map.add_argument("--gpu", type=int, default=-1)
    beat_map.add_argument("--model")
    beat_map.add_argument("--dbn", action="store_true")
    beat_map.add_argument("--dry-run", action="store_true")
    beat_map.set_defaults(func=run_beat_map)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
