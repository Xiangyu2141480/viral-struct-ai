#!/usr/bin/env python
"""One-off Doubao probe to compare peak-window length (1.0s / 1.4s / 2.5s).

Goal: find out the minimum clip length at which Doubao Seed 2.0 Lite can
correctly describe a visual change. The result decides the default
pre_context/post_context for build_peak_window_command.

Not part of the production pipeline. Safe to delete after P0.1.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from doubao_rough_scan import (  # noqa: E402
    build_responses_payload,
    create_response,
    env_value,
    extract_response_text,
    load_dotenv,
    upload_file,
    wait_for_file,
)


PROBE_DIR = Path("C:/tmp/peak_window_probe")
CLIPS = [
    ("1.0s", PROBE_DIR / "peak_test_1.0s.mp4"),
    ("1.4s", PROBE_DIR / "peak_test_1.4s.mp4"),
    ("2.5s", PROBE_DIR / "peak_test_2.5s.mp4"),
]

PROMPT_TEXT = (
    "这是一段约 1-3 秒的短视频片段，算法判定其中包含一个视觉显著变化。\n"
    "请用一句话（≤30 字）描述这段视频里最重要的视觉变化。\n"
    "要求:\n"
    "1. 必须具体描述变化（例：'笔记本从银色变成黄色'），不要写'有动作发生'这种空话。\n"
    "2. 如果完全看不出明显变化，只回答'未观察到明显变化'。\n"
    "3. 只输出这一句描述，不要解释、不要 JSON、不要其他内容。"
)

SYSTEM_PROMPT = (
    "你是一个视频片段视觉变化识别助手。你只描述事实，不解释，不输出 JSON。"
)


def probe_one(label: str, clip_path: Path, *, base_url: str, api_key: str, model: str) -> dict:
    print(f"\n=== {label} clip: {clip_path.name} ({clip_path.stat().st_size / 1024:.0f} KB) ===")

    t0 = time.time()
    print(f"  [{time.time() - t0:5.1f}s] uploading...")
    file_info = upload_file(base_url=base_url, api_key=api_key, video_path=clip_path, fps=None)
    file_id = file_info["id"]
    print(f"  [{time.time() - t0:5.1f}s] file_id={file_id}")

    ready = wait_for_file(
        base_url=base_url,
        api_key=api_key,
        file_id=file_id,
        poll_interval=3,
        max_wait_seconds=180,
    )
    print(f"  [{time.time() - t0:5.1f}s] file ready, status={ready.get('status')}")

    payload = build_responses_payload(
        model=model,
        file_id=file_id,
        prompt_text=PROMPT_TEXT,
        instructions=SYSTEM_PROMPT,
        store=True,
    )
    payload["temperature"] = 0

    response = create_response(
        base_url=base_url,
        api_key=api_key,
        payload=payload,
        timeout=300,
    )
    response_text = extract_response_text(response)
    elapsed = time.time() - t0
    print(f"  [{elapsed:5.1f}s] response: {response_text.strip()}")

    return {
        "label": label,
        "clip": str(clip_path),
        "file_id": file_id,
        "response_text": response_text.strip(),
        "elapsed_seconds": round(elapsed, 1),
        "raw_response": response,
    }


def main() -> int:
    env_values = load_dotenv(".env")
    base_url = env_value("LLM_BASE_URL", env_values)
    api_key = env_value("LLM_API_KEY", env_values)
    model = env_value("LLM_MODEL", env_values)

    missing = [n for n, v in {"LLM_BASE_URL": base_url, "LLM_API_KEY": api_key, "LLM_MODEL": model}.items() if not v]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")

    print(f"Doubao endpoint: {base_url}")
    print(f"Model: {model}")
    print(f"Probe scope: 3 windows around MacBook color shift @ 5.74s")

    results = []
    for label, clip_path in CLIPS:
        if not clip_path.exists():
            print(f"[SKIP] {label}: clip missing at {clip_path}")
            continue
        try:
            results.append(probe_one(label, clip_path, base_url=base_url, api_key=api_key, model=model))
        except Exception as exc:
            print(f"  [ERROR] {label}: {exc}")
            results.append({"label": label, "error": str(exc), "clip": str(clip_path)})

    out_path = PROBE_DIR / "probe_results.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved full results -> {out_path}")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for r in results:
        if "error" in r:
            print(f"  {r['label']:6s} ERROR: {r['error'][:80]}")
        else:
            print(f"  {r['label']:6s} {r['elapsed_seconds']:5.1f}s | {r['response_text']}")
    print("=" * 60)
    print("\nDecision rule: pick shortest window that correctly describes the color change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
