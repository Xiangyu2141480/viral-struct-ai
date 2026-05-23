#!/usr/bin/env python
"""One-off probe: does Doubao Responses API accept inline video_url (base64)?

If yes, we can drop the Files API upload + wait_for_file polling, killing
2 of 3 HTTP round trips per peak call (~14-25 min saved per video).

Compares:
  Path A (current):  upload_file → wait_for_file → create_response{file_id}
  Path B (inline):   create_response{video_url: data:video/mp4;base64,...}

Outputs wall-clock times for both paths + response texts for semantic
equivalence check.
"""

from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from doubao_rough_scan import (  # noqa: E402
    api_url,
    create_response,
    env_value,
    extract_response_text,
    load_dotenv,
    request_json,
    upload_file,
    wait_for_file,
)


CLIP = Path("C:/tmp/peak_window_probe/peak_test_1.4s.mp4")

PROMPT_TEXT = (
    "这是一段约 1.4 秒的短视频片段。请用一句话（≤30 字）描述这段视频里"
    "最重要的视觉变化。如果完全看不出明显变化，只回答'未观察到明显变化'。"
    "只输出这一句描述，不要其他内容。"
)


def path_a_file_id(*, base_url: str, api_key: str, model: str) -> dict:
    """Original path: upload + wait + response{file_id}."""
    t0 = time.time()
    print("\n=== Path A: Files API (current) ===")

    t_upload_start = time.time()
    file_info = upload_file(base_url=base_url, api_key=api_key, video_path=CLIP, fps=None)
    t_upload = time.time() - t_upload_start
    file_id = file_info["id"]
    print(f"  [{time.time()-t0:5.2f}s] upload done ({t_upload:.2f}s), file_id={file_id}")

    t_wait_start = time.time()
    ready = wait_for_file(
        base_url=base_url, api_key=api_key, file_id=file_id,
        poll_interval=2.0, max_wait_seconds=60,
    )
    t_wait = time.time() - t_wait_start
    print(f"  [{time.time()-t0:5.2f}s] wait done ({t_wait:.2f}s), status={ready.get('status')}")

    t_resp_start = time.time()
    payload = {
        "model": model,
        "input": [
            {"role": "user", "content": [
                {"type": "input_video", "file_id": file_id},
                {"type": "input_text", "text": PROMPT_TEXT},
            ]},
        ],
        "store": True,
        "temperature": 0,
    }
    response = create_response(base_url=base_url, api_key=api_key, payload=payload, timeout=300)
    t_resp = time.time() - t_resp_start
    response_text = extract_response_text(response).strip()
    total = time.time() - t0
    print(f"  [{total:5.2f}s] response done ({t_resp:.2f}s)")
    print(f"  → {response_text}")

    return {
        "path": "A_file_id",
        "wall_clock_s": round(total, 2),
        "upload_s": round(t_upload, 2),
        "wait_s": round(t_wait, 2),
        "response_s": round(t_resp, 2),
        "response_text": response_text,
        "usage": response.get("usage"),
        "file_id": file_id,
    }


def path_b_inline_base64(*, base_url: str, api_key: str, model: str) -> dict:
    """New path: inline base64 video_url, NO upload, NO wait."""
    t0 = time.time()
    print("\n=== Path B: inline video_url base64 (proposed) ===")

    t_encode_start = time.time()
    clip_bytes = CLIP.read_bytes()
    b64 = base64.b64encode(clip_bytes).decode("ascii")
    data_url = f"data:video/mp4;base64,{b64}"
    t_encode = time.time() - t_encode_start
    print(f"  [{time.time()-t0:5.2f}s] base64 encode done ({t_encode:.2f}s), "
          f"clip={len(clip_bytes)/1024:.0f}KB, data_url={len(data_url)/1024:.0f}KB")

    t_resp_start = time.time()
    payload = {
        "model": model,
        "input": [
            {"role": "user", "content": [
                {"type": "video_url", "video_url": {"url": data_url}},
                {"type": "input_text", "text": PROMPT_TEXT},
            ]},
        ],
        "store": True,
        "temperature": 0,
    }
    try:
        response = create_response(base_url=base_url, api_key=api_key, payload=payload, timeout=300)
    except Exception as e:
        t_resp = time.time() - t_resp_start
        err = str(e)
        print(f"  [ERROR after {t_resp:.2f}s] {err[:300]}")
        return {
            "path": "B_inline_base64",
            "wall_clock_s": round(time.time() - t0, 2),
            "encode_s": round(t_encode, 2),
            "response_s": round(t_resp, 2),
            "error": err,
        }
    t_resp = time.time() - t_resp_start
    response_text = extract_response_text(response).strip()
    total = time.time() - t0
    print(f"  [{total:5.2f}s] response done ({t_resp:.2f}s)")
    print(f"  → {response_text}")

    return {
        "path": "B_inline_base64",
        "wall_clock_s": round(total, 2),
        "encode_s": round(t_encode, 2),
        "response_s": round(t_resp, 2),
        "response_text": response_text,
        "usage": response.get("usage"),
    }


def main() -> int:
    env_values = load_dotenv(".env")
    base_url = env_value("LLM_BASE_URL", env_values)
    api_key = env_value("LLM_API_KEY", env_values)
    model = env_value("LLM_MODEL", env_values)

    missing = [n for n, v in {"LLM_BASE_URL": base_url, "LLM_API_KEY": api_key, "LLM_MODEL": model}.items() if not v]
    if missing:
        raise SystemExit(f"Missing required config: {', '.join(missing)}")
    if not CLIP.exists():
        raise SystemExit(f"Test clip not found: {CLIP}")

    print(f"Endpoint: {base_url}")
    print(f"Model: {model}")
    print(f"Clip: {CLIP} ({CLIP.stat().st_size/1024:.0f} KB)")

    results = []
    results.append(path_a_file_id(base_url=base_url, api_key=api_key, model=model))
    results.append(path_b_inline_base64(base_url=base_url, api_key=api_key, model=model))

    out_path = CLIP.parent / "video_url_probe_results.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved results -> {out_path}")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for r in results:
        if "error" in r:
            print(f"  {r['path']:20s} ERROR: {r['error'][:80]}")
        else:
            print(f"  {r['path']:20s} {r['wall_clock_s']:5.2f}s total | response: {r.get('response_text', '?')[:60]}")
    print()
    if all("error" not in r for r in results):
        a, b = results
        savings = a["wall_clock_s"] - b["wall_clock_s"]
        pct = (savings / a["wall_clock_s"]) * 100 if a["wall_clock_s"] else 0
        print(f"Path B savings: {savings:.2f}s ({pct:.0f}%) per call vs current Path A")
        print(f"Semantic equivalent: {'YES' if a['response_text'] == b['response_text'] else 'DIFFERENT (compare manually)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
