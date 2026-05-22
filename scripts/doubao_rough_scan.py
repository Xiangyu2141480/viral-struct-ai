#!/usr/bin/env python
"""Run Doubao/ModelArk first-pass rough video structure scanning.

The script uploads a prepared preview video through the Files API, waits for
preprocessing, sends it to the Responses API with the rough-structure prompt,
and stores both raw and parsed outputs.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import error, request


DONE_FILE_STATUSES = {"processed", "completed", "success", "ready", "available"}
WAIT_FILE_STATUSES = {"processing", "pending", "queued", "running"}
FAILED_FILE_STATUSES = {"failed", "error", "expired", "cancelled"}


def load_dotenv(path: str | Path) -> dict[str, str]:
    values: dict[str, str] = {}
    env_path = Path(path)
    if not env_path.exists():
        return values

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def env_value(name: str, env_file_values: dict[str, str], default: str = "") -> str:
    return os.environ.get(name) or env_file_values.get(name) or default


def render_prompt(template: str, values: dict[str, Any]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    return rendered


def extract_fenced_block_after_heading(markdown: str, heading: str) -> str | None:
    pattern = re.compile(
        rf"^##\s+{re.escape(heading)}\s*$.*?```(?:text)?\s*(.*?)```",
        flags=re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(markdown)
    if not match:
        return None
    return match.group(1).strip()


def load_prompt_sections(prompt_path: str | Path, variables: dict[str, Any]) -> tuple[str | None, str]:
    markdown = Path(prompt_path).read_text(encoding="utf-8")
    rendered = render_prompt(markdown, variables)
    system_prompt = extract_fenced_block_after_heading(rendered, "System Prompt")
    user_prompt = extract_fenced_block_after_heading(rendered, "User Prompt")
    if user_prompt:
        return system_prompt, user_prompt
    return None, rendered


def build_responses_payload(
    *,
    model: str,
    file_id: str,
    prompt_text: str,
    instructions: str | None = None,
    store: bool = True,
    temperature: float = 0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_video",
                        "file_id": file_id,
                    },
                    {
                        "type": "input_text",
                        "text": prompt_text,
                    },
                ],
            }
        ],
        "store": store,
        "temperature": temperature,
    }
    if instructions:
        payload["instructions"] = instructions
    return payload


def build_multipart_body(
    *,
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
    boundary: str | None = None,
) -> tuple[bytes, str]:
    boundary = boundary or f"----viral-struct-{uuid.uuid4().hex}"
    lines: list[bytes] = []

    for name, value in fields.items():
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        lines.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        lines.append(str(value).encode("utf-8"))
        lines.append(b"\r\n")

    for name, (filename, content, mime_type) in files.items():
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        disposition = f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        lines.append(disposition.encode("utf-8"))
        lines.append(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
        lines.append(content)
        lines.append(b"\r\n")

    lines.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(lines), f"multipart/form-data; boundary={boundary}"


def request_json(
    *,
    method: str,
    url: str,
    api_key: str,
    body: bytes | None = None,
    content_type: str | None = None,
    timeout: int = 120,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}"}
    if content_type:
        headers["Content-Type"] = content_type

    req = request.Request(url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {details}") from exc

    if not payload:
        return {}
    return json.loads(payload)


def api_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def upload_file(
    *,
    base_url: str,
    api_key: str,
    video_path: str | Path,
    fps: float | None,
    timeout: int = 300,
) -> dict[str, Any]:
    path = Path(video_path)
    mime_type = mimetypes.guess_type(path.name)[0] or "video/mp4"
    fields = {"purpose": "user_data"}
    if fps is not None:
        fields["preprocess_configs[video][fps]"] = f"{fps:g}"
    body, content_type = build_multipart_body(
        fields=fields,
        files={
            "file": (path.name, path.read_bytes(), mime_type),
        },
    )
    return request_json(
        method="POST",
        url=api_url(base_url, "/files"),
        api_key=api_key,
        body=body,
        content_type=content_type,
        timeout=timeout,
    )


def retrieve_file(*, base_url: str, api_key: str, file_id: str, timeout: int = 60) -> dict[str, Any]:
    return request_json(
        method="GET",
        url=api_url(base_url, f"/files/{file_id}"),
        api_key=api_key,
        timeout=timeout,
    )


def wait_for_file(
    *,
    base_url: str,
    api_key: str,
    file_id: str,
    poll_interval: float = 5.0,
    max_wait_seconds: float = 300.0,
) -> dict[str, Any]:
    deadline = time.time() + max_wait_seconds
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = retrieve_file(base_url=base_url, api_key=api_key, file_id=file_id)
        status = str(last.get("status", "")).lower()
        if status in DONE_FILE_STATUSES:
            return last
        if status in FAILED_FILE_STATUSES:
            raise RuntimeError(f"file preprocessing failed: {json.dumps(last, ensure_ascii=False)}")
        if status and status not in WAIT_FILE_STATUSES:
            return last
        time.sleep(poll_interval)
    raise TimeoutError(f"file {file_id} was not ready after {max_wait_seconds:g}s; last={last}")


def create_response(
    *,
    base_url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: int = 600,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return request_json(
        method="POST",
        url=api_url(base_url, "/responses"),
        api_key=api_key,
        body=body,
        content_type="application/json",
        timeout=timeout,
    )


def extract_response_text(response: dict[str, Any]) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"]

    texts: list[str] = []
    for item in response.get("output", []) or []:
        if isinstance(item, dict):
            for content in item.get("content", []) or []:
                if isinstance(content, dict) and isinstance(content.get("text"), str):
                    texts.append(content["text"])
    if texts:
        return "".join(texts)

    choices = response.get("choices")
    if choices and isinstance(choices, list):
        content = choices[0].get("message", {}).get("content")
        if isinstance(content, str):
            return content

    return json.dumps(response, ensure_ascii=False)


def extract_json_object(text: str) -> Any:
    stripped = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, flags=re.DOTALL)
    if fence:
        stripped = fence.group(1).strip()

    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start >= 0 and end > start:
            return json.loads(stripped[start : end + 1])
        raise


def _time_range_start(value: dict[str, Any]) -> float:
    time_range = value.get("timeRange") or {}
    if isinstance(time_range, dict) and time_range.get("start") is not None:
        return float(time_range["start"])
    return 0.0


def normalize_content_blocks(content_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, block in enumerate(sorted(content_blocks, key=_time_range_start), start=1):
        item = dict(block)
        item.setdefault("id", f"block_{index:03d}")
        item.setdefault("timeRange", {})
        item.setdefault("coarseRoleGuess", "unknown")
        item.setdefault("boundaryReason", "")
        item.setdefault("observableSummary", "")
        item.setdefault("visualSignals", [])
        item.setdefault("textSignals", [])
        item.setdefault("audioOrRhythmSignals", [])
        item.setdefault("hasInternalTransition", False)
        item.setdefault("confidence", None)
        item.setdefault("fineScanFocusQuestions", [])
        normalized.append(item)
    return normalized


def _boundary_anchor_time(boundary: dict[str, Any]) -> float:
    return float(boundary["roughBoundaryTime"])


def normalize_boundary_candidates(
    boundary_candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not boundary_candidates:
        raise ValueError("Stage 1 rough scan output must include boundaryCandidates.")

    normalized_boundaries: list[dict[str, Any]] = []
    for index, boundary in enumerate(sorted(boundary_candidates, key=_boundary_anchor_time), start=1):
        normalized_boundary = dict(boundary)
        normalized_boundary.setdefault("id", f"boundary_{index:03d}")
        boundary_time = _boundary_anchor_time(normalized_boundary)
        normalized_boundary.setdefault("roughBoundaryTime", boundary_time)
        normalized_boundary.setdefault(
            "inspectionWindow",
            {"start": round(max(0.0, boundary_time - 2.5), 3), "end": round(boundary_time + 2.5, 3)},
        )
        normalized_boundaries.append(normalized_boundary)
    return normalized_boundaries


def normalize_rough_scan(parsed: dict[str, Any]) -> dict[str, Any]:
    """Normalize the Stage 1 content-block contract."""
    normalized = json.loads(json.dumps(parsed, ensure_ascii=False))

    content_blocks = normalized.get("contentBlocks")
    if not isinstance(content_blocks, list):
        raise ValueError("Stage 1 rough scan output must include contentBlocks.")

    normalized["schemaVersion"] = normalized.get("schemaVersion") or "rough_content_blocks_v1"
    content_blocks = normalize_content_blocks(content_blocks)
    boundary_candidates = normalize_boundary_candidates(
        normalized.get("boundaryCandidates", []) or [],
    )

    normalized["contentBlocks"] = content_blocks
    normalized["boundaryCandidates"] = boundary_candidates

    return normalized


def write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: str | Path, value: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")


def redact_config(values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    if result.get("LLM_API_KEY"):
        result["LLM_API_KEY"] = "***"
    return result


def run_scan(args: argparse.Namespace) -> int:
    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    model = args.model or env_value("LLM_MODEL", env_values)

    missing = [name for name, value in {
        "LLM_BASE_URL": base_url,
        "LLM_API_KEY": api_key,
        "LLM_MODEL": model,
    }.items() if not value]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    variables = {
        "videoId": args.video_id,
        "durationSeconds": args.duration,
        "previewFps": args.preview_fps,
        "previewWidth": args.preview_width,
        "previewHeight": args.preview_height,
    }
    instructions, prompt_text = load_prompt_sections(args.prompt, variables)

    if args.dry_run:
        preview = {
            "config": redact_config({
                "LLM_BASE_URL": base_url,
                "LLM_API_KEY": api_key,
                "LLM_MODEL": model,
            }),
            "video": str(args.video),
            "prompt": str(args.prompt),
            "uploadFps": args.upload_fps,
            "instructionsPreview": instructions[:240] if instructions else None,
            "promptPreview": prompt_text[:500],
        }
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    if args.file_id:
        file_id = args.file_id
        file_info = {"id": file_id, "source": "provided"}
    else:
        print(f"Uploading video: {args.video}")
        file_info = upload_file(
            base_url=base_url,
            api_key=api_key,
            video_path=args.video,
            fps=args.upload_fps,
        )
        file_id = file_info["id"]
        print(f"Uploaded file_id: {file_id}")

    print(f"Waiting for file preprocessing: {file_id}")
    ready_file = wait_for_file(
        base_url=base_url,
        api_key=api_key,
        file_id=file_id,
        poll_interval=args.poll_interval,
        max_wait_seconds=args.max_wait_seconds,
    )
    print(f"File status: {ready_file.get('status', 'unknown')}")

    payload = build_responses_payload(
        model=model,
        file_id=file_id,
        prompt_text=prompt_text,
        instructions=instructions,
        store=True,
    )
    print("Calling Responses API for rough structure scan...")
    response = create_response(
        base_url=base_url,
        api_key=api_key,
        payload=payload,
        timeout=args.response_timeout,
    )

    response_text = extract_response_text(response)
    parsed = normalize_rough_scan(extract_json_object(response_text))

    write_json(args.out, parsed)
    write_json(args.raw_out, response)
    write_text(args.text_out, response_text)
    write_json(args.file_info_out, {"uploaded": file_info, "ready": ready_file})

    print(f"Saved parsed scan: {args.out}")
    print(f"Saved raw response: {args.raw_out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Upload a prepared preview video to Doubao/ModelArk and run first-pass rough structure scanning.",
    )
    parser.add_argument(
        "--video",
        default="seed_assets/processed_videos/macbook_neo_preview_5fps_720w.mp4",
        help="Prepared 5 FPS preview video.",
    )
    parser.add_argument(
        "--prompt",
        default="prompts/video_understanding/rough_structure_scan_v0.md",
        help="Prompt markdown file.",
    )
    parser.add_argument("--video-id", default="macbook_neo")
    parser.add_argument("--duration", type=float, default=229.53)
    parser.add_argument("--preview-fps", type=float, default=5)
    parser.add_argument("--preview-width", type=int, default=720)
    parser.add_argument("--preview-height", type=int, default=406)
    parser.add_argument("--upload-fps", type=float, default=5)
    parser.add_argument("--env", default=".env")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key")
    parser.add_argument("--model")
    parser.add_argument("--file-id", help="Reuse an existing uploaded file id instead of uploading.")
    parser.add_argument("--poll-interval", type=float, default=5)
    parser.add_argument("--max-wait-seconds", type=float, default=300)
    parser.add_argument("--response-timeout", type=int, default=600)
    parser.add_argument("--out", default="seed_assets/analysis/macbook_neo/rough_structure_scan.json")
    parser.add_argument("--raw-out", default="seed_assets/analysis/macbook_neo/rough_structure_scan_raw_response.json")
    parser.add_argument("--text-out", default="seed_assets/analysis/macbook_neo/rough_structure_scan_response_text.txt")
    parser.add_argument("--file-info-out", default="seed_assets/analysis/macbook_neo/uploaded_file_info.json")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run_scan(args)


if __name__ == "__main__":
    raise SystemExit(main())
