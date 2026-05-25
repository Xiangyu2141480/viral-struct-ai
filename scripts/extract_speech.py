#!/usr/bin/env python
"""Extract speech transcript via Volcengine Doubao ASR (flash / recognize API).

Synchronous "录音文件极速版" endpoint with base64-inlined audio data —
avoids the need to upload to any object storage. Suitable for audio
≤ 100 MB (recommended ≤ 20 MB per Volcengine docs).

Produces ``stage1_media/speech_transcript.json`` conforming to
``speech_transcript_v1`` schema. Gracefully handles the "no speech"
case (BGM-only videos like ad TVCs) — emits ``hasSpeech: false`` and
empty segments, letting downstream consumers route to a visual-only
migration path.

Env vars (.env):
  - ASR_ACCESS_TOKEN: the Volcengine "X-Api-Key" value (new console)
  - ASR_BASE_URL: optional override, defaults to openspeech.bytedance.com

See docs/DECISIONS for the ASR provider selection rationale (Phase 1).
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib import error, request


SCHEMA_VERSION = "speech_transcript_v1"
DEFAULT_BASE_URL = "https://openspeech.bytedance.com"
DEFAULT_ENDPOINT_PATH = "/api/v3/auc/bigmodel/recognize/flash"
DEFAULT_RESOURCE_ID = "volc.bigasr.auc_turbo"
DEFAULT_MODEL = "bigmodel"
DEFAULT_USER_ID = "viral-struct-ai"
PRODUCED_BY = "volcengine-doubao-asr-flash"

# Volcengine response codes (subset).
CODE_SUCCESS = "20000000"

# Language detection: CJK chars / Latin alphabetic chars heuristic. Volcengine
# does not surface a detected-language field, so we infer from the transcript.
_CJK_RATIO_THRESHOLD = 0.15  # >= 15% CJK chars => mostly Chinese


def _is_punctuation_only(text: str) -> bool:
    """True if the text contains no alphanumeric (including CJK) characters.

    Used to filter Volcengine word-list entries that are standalone
    punctuation (e.g. ``":"`` in ``"colors:"``) — they consume a timestamp
    slot but carry no semantic content. Python's ``str.isalnum()`` returns
    True for CJK characters, so this works for both Chinese and English
    transcripts without special-casing.
    """
    return not any(c.isalnum() for c in text)


def detect_language(text: str) -> str:
    """Heuristic language tag for a transcript.

    Returns one of: 'zh' | 'en' | 'mixed' | 'unknown'.
    Cheap CJK-vs-Latin ratio — sufficient for routing decisions
    ("does this video have Chinese narration?").
    """
    if not text:
        return "unknown"
    cjk_count = sum(1 for c in text if "一" <= c <= "鿿")
    latin_count = sum(1 for c in text if c.isascii() and c.isalpha())
    if cjk_count == 0 and latin_count == 0:
        return "unknown"
    if cjk_count == 0:
        return "en"
    if latin_count == 0:
        return "zh"
    # Both present — classify by majority, threshold-aware.
    cjk_ratio = cjk_count / (cjk_count + latin_count)
    if cjk_ratio >= _CJK_RATIO_THRESHOLD and cjk_ratio <= (1.0 - _CJK_RATIO_THRESHOLD):
        return "mixed"
    return "zh" if cjk_ratio > 0.5 else "en"

# Reuse the simple dotenv loader from the rough-scan script (no new deps).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from doubao_rough_scan import load_dotenv, env_value  # noqa: E402
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_DEFAULT_PATHS = analysis_paths(DEFAULT_VIDEO_ID)


def ffprobe_audio_metadata(audio_path: Path) -> dict[str, Any]:
    """Probe an audio file with ffprobe and return Volcengine-shaped metadata.

    Raises FileNotFoundError if the file is missing; RuntimeError if ffprobe
    is missing or fails; ValueError if no audio stream is present.
    """
    if not audio_path.exists():
        raise FileNotFoundError(f"audio not found: {audio_path}")
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", str(audio_path),
            ],
            check=True, capture_output=True, text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe not found on PATH — install ffmpeg.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffprobe failed: {exc.stderr.strip()}") from exc

    probe = json.loads(result.stdout)
    audio_stream = None
    for stream in probe.get("streams") or []:
        if isinstance(stream, dict) and stream.get("codec_type") == "audio":
            audio_stream = stream
            break
    if not audio_stream:
        raise ValueError(f"no audio stream in {audio_path}")

    # Map file extension to Volcengine-accepted format enum.
    ext = audio_path.suffix.lower().lstrip(".")
    format_map = {"wav": "wav", "mp3": "mp3", "ogg": "ogg", "raw": "raw"}
    audio_format = format_map.get(ext, "raw")

    duration_str = audio_stream.get("duration") or (probe.get("format") or {}).get("duration") or "0"
    try:
        duration_s = float(duration_str)
    except (TypeError, ValueError):
        duration_s = 0.0

    return {
        "format": audio_format,
        "rate": int(audio_stream.get("sample_rate") or 16000),
        "bits": int(audio_stream.get("bits_per_sample") or 16),
        "channels": int(audio_stream.get("channels") or 1),
        "duration_s": duration_s,
    }


def encode_audio_base64(audio_path: Path) -> str:
    """Read audio file and return its base64-encoded ASCII string."""
    raw = audio_path.read_bytes()
    return base64.b64encode(raw).decode("ascii")


def build_request_body(
    *,
    audio_b64: str,
    audio_meta: dict[str, Any],
    user_id: str = DEFAULT_USER_ID,
    model_name: str = DEFAULT_MODEL,
    enable_punc: bool = True,
    enable_itn: bool = True,
    show_utterances: bool = True,
) -> dict[str, Any]:
    """Build the Volcengine flash-ASR request body.

    Pure function — no I/O. Defaults are tuned for Chinese e-commerce
    short videos:
      - enable_itn=True   → "一千两百" → "1200" (price/quantity readable)
      - enable_punc=True  → adds punctuation (readable transcript)
      - show_utterances=True (MANDATORY for timestamps; without it we
        only get a single concatenated string)
      - enable_speaker_info=False (single-speaker assumption)
      - enable_ddc=False (don't auto-rewrite disfluencies; preserve raw)
    """
    return {
        "user": {"uid": user_id},
        "audio": {
            "data": audio_b64,
            "format": audio_meta["format"],
            "codec": "raw",
            "rate": int(audio_meta["rate"]),
            "bits": int(audio_meta["bits"]),
            "channel": int(audio_meta["channels"]),
        },
        "request": {
            "model_name": model_name,
            "enable_itn": enable_itn,
            "enable_punc": enable_punc,
            "enable_ddc": False,
            "enable_speaker_info": False,
            "enable_channel_split": False,
            "show_utterances": show_utterances,
            "vad_segment": False,
            "sensitive_words_filter": "",
        },
    }


def call_flash_api(
    *,
    endpoint: str,
    api_key: str,
    resource_id: str,
    payload: dict[str, Any],
    timeout: int = 600,
    request_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Synchronous POST to Volcengine flash-ASR endpoint.

    Returns ``(json_body, response_headers)``. ``request_id`` is auto-generated
    when not supplied. Raises ``RuntimeError`` with the response details on
    HTTP failure (so retries / logging can inspect).
    """
    rid = request_id or str(uuid.uuid4())
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": rid,
            "X-Api-Sequence": "-1",
        },
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            headers = {k: v for k, v in resp.headers.items()}
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {details}") from exc

    parsed = json.loads(text) if text else {}
    return parsed, headers


def normalize_response(
    *,
    raw: dict[str, Any],
    response_headers: dict[str, str] | None,
    video_id: str,
    audio_source_path: str,
    audio_meta: dict[str, Any],
    resource_id: str = DEFAULT_RESOURCE_ID,
    model_name: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Map a Volcengine ASR response into our ``speech_transcript_v1`` schema.

    Pure function — no I/O. Defensively handles:
      - missing ``result`` key (e.g. error envelope) → hasSpeech=false
      - empty ``utterances`` list (BGM-only video) → hasSpeech=false
      - missing ``words`` per utterance → no ``words`` key in segment
    """
    result = (raw.get("result") or {}) if isinstance(raw, dict) else {}
    utterances = result.get("utterances") if isinstance(result, dict) else None
    if not isinstance(utterances, list):
        utterances = []
    full_text = (result.get("text") if isinstance(result, dict) else "") or ""
    full_text = str(full_text).strip()

    segments: list[dict[str, Any]] = []
    for idx, utt in enumerate(utterances, start=1):
        if not isinstance(utt, dict):
            continue
        seg: dict[str, Any] = {
            "id": f"seg_{idx:03d}",
            "startMs": int(utt.get("start_time") or 0),
            "endMs": int(utt.get("end_time") or 0),
            "text": str(utt.get("text") or "").strip(),
        }
        words = utt.get("words")
        if isinstance(words, list) and words:
            cleaned_words: list[dict[str, Any]] = []
            for w in words:
                if not isinstance(w, dict):
                    continue
                # Volcengine emits two kinds of word-list noise we must drop:
                #   1. Whitespace separators between English tokens with
                #      text=" " and start/end = -1 (no info value).
                #   2. Standalone punctuation words like ":" / "," / "。"
                #      that consume timestamp space but carry no semantic
                #      content (observed in macbook_neo seg_012's "colors:").
                text = str(w.get("text") or "").strip()
                start = int(w.get("start_time") or 0)
                end = int(w.get("end_time") or 0)
                if not text or start < 0 or end < 0:
                    continue
                if _is_punctuation_only(text):
                    continue
                cleaned_words.append({"text": text, "startMs": start, "endMs": end})
            if cleaned_words:
                seg["words"] = cleaned_words
        segments.append(seg)

    total_audio_ms = int(round(float(audio_meta.get("duration_s") or 0.0) * 1000))
    total_speech_ms = sum(max(0, s["endMs"] - s["startMs"]) for s in segments)
    has_speech = bool(segments) and bool(full_text)
    speech_ratio = (total_speech_ms / total_audio_ms) if total_audio_ms > 0 else 0.0

    request_id = None
    if response_headers:
        # Volcengine echoes the request id back for tracing.
        request_id = response_headers.get("X-Api-Request-Id") or response_headers.get("x-api-request-id")

    return {
        "schemaVersion": SCHEMA_VERSION,
        "producedBy": PRODUCED_BY,
        "videoId": video_id,
        "audioSourcePath": audio_source_path,
        "model": model_name,
        "modelResourceId": resource_id,
        # Volcengine doesn't surface a detected-language field; infer from
        # transcript via CJK/Latin ratio heuristic. Useful for routing
        # decisions ("does the video have Chinese narration?").
        "language": detect_language(full_text),
        "hasSpeech": has_speech,
        "totalAudioMs": total_audio_ms,
        "totalSpeechMs": total_speech_ms,
        "speechRatio": round(speech_ratio, 4),
        "fullText": full_text,
        "segments": segments,
        "providerRequestId": request_id,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract speech transcript via Volcengine Doubao ASR (flash)."
    )
    parser.add_argument(
        "--audio",
        default=str(_DEFAULT_PATHS.audio_beat_wav),
        help="Input audio file (wav/mp3/ogg).",
    )
    parser.add_argument(
        "--video-id",
        default=DEFAULT_VIDEO_ID,
        help="Video id stamped into the transcript.",
    )
    parser.add_argument(
        "--out",
        default=str(_DEFAULT_PATHS.speech_transcript),
        help="Output transcript JSON path.",
    )
    parser.add_argument(
        "--raw-out",
        default=None,
        help="Optional path to dump the raw Volcengine response (debug).",
    )
    parser.add_argument("--env", default=".env")
    parser.add_argument(
        "--base-url",
        default=None,
        help=f"Override ASR base URL (default reads ASR_BASE_URL or {DEFAULT_BASE_URL}).",
    )
    parser.add_argument("--endpoint-path", default=DEFAULT_ENDPOINT_PATH)
    parser.add_argument("--resource-id", default=DEFAULT_RESOURCE_ID)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--user-id", default=DEFAULT_USER_ID)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Probe audio + build request, but skip the API call.",
    )
    return parser


def resolve_api_key(env_values: dict[str, str]) -> str:
    """Look up the Volcengine ASR API key under either env var name.

    Supports both ``ASR_ACCESS_TOKEN`` (current .env naming) and
    ``ASR_API_KEY`` (semantically clearer for the new-console x-api-key).
    """
    for name in ("ASR_ACCESS_TOKEN", "ASR_API_KEY"):
        value = env_value(name, env_values)
        if value:
            return value
    raise SystemExit("ASR_ACCESS_TOKEN (or ASR_API_KEY) not set in .env")


def run(args: argparse.Namespace) -> int:
    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("ASR_BASE_URL", env_values, DEFAULT_BASE_URL)
    endpoint = base_url.rstrip("/") + args.endpoint_path

    audio_path = Path(args.audio)
    print(f"Probing audio: {audio_path}")
    audio_meta = ffprobe_audio_metadata(audio_path)
    print(
        f"  format={audio_meta['format']} rate={audio_meta['rate']}Hz "
        f"channels={audio_meta['channels']} bits={audio_meta['bits']} "
        f"duration={audio_meta['duration_s']:.2f}s"
    )

    print("Encoding audio (base64)...")
    audio_b64 = encode_audio_base64(audio_path)
    raw_bytes = (len(audio_b64) * 3) // 4
    print(f"  raw={raw_bytes:,} bytes  base64={len(audio_b64):,} bytes")

    payload = build_request_body(
        audio_b64=audio_b64,
        audio_meta=audio_meta,
        user_id=args.user_id,
        model_name=args.model,
    )

    if args.dry_run:
        # Strip the bulky base64 from the previewed payload.
        preview = json.loads(json.dumps(payload))
        preview["audio"]["data"] = f"<{len(audio_b64)} base64 chars elided>"
        print("DRY RUN — payload preview:")
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    api_key = resolve_api_key(env_values)
    print(f"Calling Volcengine flash ASR: {endpoint}")
    raw_response, response_headers = call_flash_api(
        endpoint=endpoint,
        api_key=api_key,
        resource_id=args.resource_id,
        payload=payload,
        timeout=args.timeout,
    )

    code = str(raw_response.get("code") or "")
    if code and code != CODE_SUCCESS:
        # Don't raise on partial / processing — but loudly warn so the user sees it.
        message = raw_response.get("message") or ""
        print(f"[WARN] Volcengine returned non-success code: {code} {message}")

    if args.raw_out:
        write_json(Path(args.raw_out), raw_response)
        print(f"Saved raw response -> {args.raw_out}")

    transcript = normalize_response(
        raw=raw_response,
        response_headers=response_headers,
        video_id=args.video_id,
        audio_source_path=str(audio_path).replace("\\", "/"),
        audio_meta=audio_meta,
        resource_id=args.resource_id,
        model_name=args.model,
    )

    write_json(Path(args.out), transcript)
    print(f"Saved transcript -> {args.out}")
    print(
        f"  hasSpeech={transcript['hasSpeech']} "
        f"segments={len(transcript['segments'])} "
        f"totalSpeechMs={transcript['totalSpeechMs']} "
        f"ratio={transcript['speechRatio']}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
