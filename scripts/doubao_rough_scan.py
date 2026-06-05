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
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib import error, request

# curl uses the system TLS stack (Schannel on Windows) and reliably handles
# large multipart uploads to the Doubao endpoint, where Python's OpenSSL
# (_ssl) — shared by urllib AND requests — intermittently raises
# "EOF occurred in violation of protocol". Resolved once; None => urllib.
_CURL_PATH = shutil.which("curl")

# scripts/ is on sys.path[0] when this file is run as __main__; sibling
# imports also work when loaded via importlib.spec_from_file_location
# because both doubao_fine_scan / extract_speech register scripts/ before
# importing us. Keep this explicit import close to where DEFAULT_VIDEO_ID
# is consumed so the dependency is obvious.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_DEFAULT_PATHS = analysis_paths(DEFAULT_VIDEO_ID)


DONE_FILE_STATUSES = {"processed", "completed", "success", "ready", "available"}
WAIT_FILE_STATUSES = {"processing", "pending", "queued", "running"}
FAILED_FILE_STATUSES = {"failed", "error", "expired", "cancelled"}


# ---------------------------------------------------------------------------
# HTTP concurrency controls (W1.1): global semaphore + retry/backoff.
# These are foundational for the L1/L2 ThreadPoolExecutor refactor.
# ---------------------------------------------------------------------------

_RETRYABLE_ERROR_PATTERNS = (
    "HTTP 429",
    "HTTP 500",
    "HTTP 502",
    "HTTP 503",
    "HTTP 504",
    "RequestBurstTooFast",
    "ServerOverloaded",
    "timed out",         # urllib.error.URLError("...timed out") on socket timeout
    "timeout",           # alternate phrasing
    "Connection reset",  # transient TCP teardown under load
    "Connection aborted",
    "curl transport error",  # curl subprocess transport failure (retryable)
)

_HTTP_SEMAPHORE: threading.BoundedSemaphore | None = None
_HTTP_CAP: int | None = None  # tracks the cap set at first init so mismatches can be detected
_HTTP_SEMAPHORE_LOCK = threading.Lock()

T = TypeVar("T")


def configure_http_semaphore(max_concurrent: int) -> threading.BoundedSemaphore:
    """Explicit one-shot initialiser for the process-global HTTP semaphore.

    Call this once at CLI entry (after parsing `--max-concurrent-http`) and
    before spawning any worker. Re-calling with the same cap is a no-op
    (idempotent). Re-calling with a *different* cap raises RuntimeError —
    the previous silent-ignore behaviour was a real bug (PR #24 review H1).
    """
    global _HTTP_SEMAPHORE, _HTTP_CAP
    cap = int(max_concurrent)
    with _HTTP_SEMAPHORE_LOCK:
        if _HTTP_SEMAPHORE is None:
            _HTTP_CAP = cap
            _HTTP_SEMAPHORE = threading.BoundedSemaphore(value=cap)
        elif cap != _HTTP_CAP:
            raise RuntimeError(
                f"HTTP semaphore already initialised with cap={_HTTP_CAP}; "
                f"refusing to reconfigure to cap={cap}. "
                "Call configure_http_semaphore exactly once at CLI entry."
            )
        return _HTTP_SEMAPHORE


def get_http_semaphore(max_concurrent: int = 5) -> threading.BoundedSemaphore:
    """Return the process-global HTTP semaphore, lazy-creating on first use.

    Lenient accessor: if the semaphore is already initialised (by an explicit
    ``configure_http_semaphore`` call), this returns it as-is regardless of
    ``max_concurrent`` — so internal fallback paths (e.g. ``gated_call``'s
    default semaphore) never trigger a spurious cap-mismatch raise.

    Strict cap-mismatch enforcement is the job of ``configure_http_semaphore``
    (PR #24 review H1). Prefer that explicit form at CLI entry.
    """
    with _HTTP_SEMAPHORE_LOCK:
        if _HTTP_SEMAPHORE is not None:
            return _HTTP_SEMAPHORE
    # Not yet initialised — defer to configure (which retakes the lock and
    # initialises with the requested cap).
    return configure_http_semaphore(max_concurrent)


def _reset_http_semaphore_for_testing() -> None:
    """Clear the global semaphore so the next configure_* call starts fresh.

    Intended only for test isolation. Not part of the public API.
    """
    global _HTTP_SEMAPHORE, _HTTP_CAP
    with _HTTP_SEMAPHORE_LOCK:
        _HTTP_SEMAPHORE = None
        _HTTP_CAP = None


def _is_retryable_error(message: str) -> bool:
    return any(pattern in message for pattern in _RETRYABLE_ERROR_PATTERNS)


def gated_call(
    fn: Callable[..., T],
    *args: Any,
    max_attempts: int = 5,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
    semaphore: threading.BoundedSemaphore | None = None,
    **kwargs: Any,
) -> T:
    """Run an HTTP-bound `fn` through a semaphore with retry+backoff.

    - Acquires the semaphore once per attempt (released across backoff sleeps,
      so a retrying caller does not hold a slot during exponential wait).
    - Retries only on 429 / 5xx / RequestBurstTooFast / ServerOverloaded.
    - Client errors (4xx other than 429) raise immediately.
    - Backoff schedule: base_delay * 2**attempt + jitter, capped at max_delay.
    - ``semaphore``: optional override. If None, falls back to the
      process-global semaphore (lazy-init at default cap=5). Tests inject
      their own semaphore for isolation.
    """
    sem = semaphore if semaphore is not None else get_http_semaphore()
    last_exc: BaseException | None = None
    for attempt in range(int(max_attempts)):
        with sem:
            try:
                return fn(*args, **kwargs)
            except (RuntimeError, OSError) as exc:
                # RuntimeError: our wrapped HTTPError messages from request_json.
                # OSError: covers urllib.error.URLError (subclass of OSError),
                #          socket.timeout / TimeoutError, ConnectionError, etc.
                # Filter by message pattern — only retry transient classes.
                msg = str(exc)
                if not _is_retryable_error(msg):
                    raise
                last_exc = exc
        # Released semaphore; sleep with backoff if more attempts remain.
        if attempt < int(max_attempts) - 1:
            delay = min(float(max_delay), float(base_delay) * (2 ** attempt))
            delay += random.uniform(0, min(1.0, delay))  # jitter
            time.sleep(delay)
    # Not `assert` — strip under -O would break the `raise last_exc` below.
    if last_exc is None:
        raise RuntimeError(
            "gated_call exhausted attempts without capturing an exception"
        )
    raise last_exc


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
    temperature: float = 0.0,
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

    # Prefer curl (system TLS / Schannel): Python's OpenSSL (_ssl) — used by
    # BOTH urllib and requests — intermittently fails large multipart uploads
    # to this endpoint with "EOF occurred in violation of protocol". curl is
    # reliable. Transport/timeout failures are surfaced as RuntimeError with
    # "curl transport error" / "timed out" text so gated_call's existing
    # retry classifier handles them unchanged. urllib is the stdlib fallback
    # when curl is absent.
    if _CURL_PATH:
        cmd = [_CURL_PATH, "-sS", "-X", method, url, "--max-time", str(int(timeout))]
        for header_name, header_value in headers.items():
            cmd += ["-H", f"{header_name}: {header_value}"]
        if body is not None:
            cmd += ["--data-binary", "@-"]  # read raw body (multipart/json) from stdin
        cmd += ["-w", "\n%{http_code}"]  # append status code as the final line
        try:
            result = subprocess.run(
                cmd, input=body, capture_output=True, timeout=int(timeout) + 15
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"curl request timed out after {timeout}s") from exc
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                f"curl transport error (exit {result.returncode}): {err}"
            )
        raw = result.stdout.decode("utf-8", errors="replace")
        sep = raw.rfind("\n")
        payload, code_str = (raw[:sep], raw[sep + 1:].strip()) if sep != -1 else (raw, "")
        http_code = int(code_str) if code_str.isdigit() else 0
        if http_code >= 400:
            raise RuntimeError(f"HTTP {http_code}: {payload}")
        return json.loads(payload) if payload.strip() else {}

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


# Fields removed in v0.2 (see docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md).
# We strip them defensively in case the LLM still produces them from old prompts
# cached in any conversational state.
_KILL_CONTENT_BLOCK_FIELDS = (
    "audioOrRhythmSignals",  # 5fps preview has no audio track; LLM hallucinates
    "hasInternalTransition",  # empirically 100% true, zero information entropy
    "confidence",  # empirically 0.85-0.98, never calibrated, zero downstream reads
)


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
        item.setdefault("fineScanFocusQuestions", [])
        for legacy_field in _KILL_CONTENT_BLOCK_FIELDS:
            item.pop(legacy_field, None)
        normalized.append(item)
    return normalized


def _boundary_anchor_time(boundary: dict[str, Any]) -> float:
    return float(boundary["roughBoundaryTime"])


# Fields removed in v0.2 (see docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md).
_KILL_BOUNDARY_FIELDS = (
    "whyNeedsMicroscope",  # boilerplate generator, redundant with visibleBoundaryCue
    "confidence",  # zero downstream reads, no consumption contract
)


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
        # v2.5: canonicalBoundaryTime is the single source of truth for boundary
        # time across all stages. At rough stage it equals roughBoundaryTime;
        # Stage 1.5 may override it with the more accurate semanticPivotTime.
        # See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §4.1 (D1).
        normalized_boundary["canonicalBoundaryTime"] = boundary_time
        normalized_boundary.setdefault(
            "inspectionWindow",
            {"start": round(max(0.0, boundary_time - 2.5), 3), "end": round(boundary_time + 2.5, 3)},
        )
        for legacy_field in _KILL_BOUNDARY_FIELDS:
            normalized_boundary.pop(legacy_field, None)
        normalized_boundaries.append(normalized_boundary)
    return normalized_boundaries


def _migrate_global_notes_subject_rename(global_notes: dict[str, Any]) -> None:
    """v3 (Phase 3): rename ``likelyProductFirstSeenAt`` → ``likelySubjectFirstSeenAt``.

    "Subject" generalizes across categories where the focal entity isn't always
    a product (course, local service, person, lifestyle moment). The old key
    is migrated forward and removed; the new key is canonical.
    """
    old_key = "likelyProductFirstSeenAt"
    new_key = "likelySubjectFirstSeenAt"
    if old_key in global_notes:
        legacy_value = global_notes.pop(old_key)
        # Only seed new key if LLM didn't already provide it (prefer new value).
        global_notes.setdefault(new_key, legacy_value)


def normalize_rough_scan(parsed: dict[str, Any]) -> dict[str, Any]:
    """Normalize the Stage 1 content-block contract.

    v0.2 (2026-05-23): strip KILL fields from roughSummary and globalNotes
    if the LLM still produces them. See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md.

    v3 (Phase 3): migrate likelyProductFirstSeenAt → likelySubjectFirstSeenAt
    for cross-category support (course, local_service, lifestyle, etc.).
    """
    normalized = json.loads(json.dumps(parsed, ensure_ascii=False))

    rough_summary = normalized.get("roughSummary")
    if isinstance(rough_summary, dict):
        # globalConversionLogic: LLM invents business logic from 5fps preview
        rough_summary.pop("globalConversionLogic", None)

    global_notes = normalized.get("globalNotes")
    if isinstance(global_notes, dict):
        # likelyHookWindow == contentBlocks[0].timeRange (100% redundant)
        # likelyCtaRegion == contentBlocks[-1].timeRange (100% redundant)
        # importantOpenQuestions ⊂ Σ contentBlocks[*].fineScanFocusQuestions
        for legacy_field in ("likelyHookWindow", "likelyCtaRegion", "importantOpenQuestions"):
            global_notes.pop(legacy_field, None)
        _migrate_global_notes_subject_rename(global_notes)

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
        default=str(_DEFAULT_PATHS.preview_video),
        help="Prepared 5 FPS preview video.",
    )
    parser.add_argument(
        "--prompt",
        default="prompts/video_understanding/rough_structure_scan_v0.md",
        help="Prompt markdown file.",
    )
    parser.add_argument("--video-id", default=DEFAULT_VIDEO_ID)
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
    # v0.2 directory layout: stage1_rough/ for primary contract, _debug/ for dumps.
    # See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §5.1.
    parser.add_argument("--out", default=str(_DEFAULT_PATHS.rough_scan))
    parser.add_argument("--raw-out", default=str(_DEFAULT_PATHS.rough_raw_response))
    parser.add_argument("--text-out", default=str(_DEFAULT_PATHS.rough_response_text))
    parser.add_argument("--file-info-out", default=str(_DEFAULT_PATHS.uploaded_file_info))
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run_scan(args)


if __name__ == "__main__":
    raise SystemExit(main())
