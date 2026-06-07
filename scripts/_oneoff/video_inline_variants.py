#!/usr/bin/env python
"""Try multiple type-name variants for inline video in the LLM Responses API."""

from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_client import (  # noqa: E402
    create_response,
    env_value,
    extract_response_text,
    load_dotenv,
)

CLIP = Path("C:/tmp/peak_window_probe/peak_test_1.4s.mp4")
PROMPT_TEXT = "用一句话描述这段视频的关键视觉变化。"


def try_variant(name: str, content_block: dict, *, base_url: str, api_key: str, model: str) -> dict:
    payload = {
        "model": model,
        "input": [{"role": "user", "content": [content_block, {"type": "input_text", "text": PROMPT_TEXT}]}],
        "store": True,
        "temperature": 0,
    }
    print(f"\n=== Variant: {name} ===")
    print(f"  content type: {content_block.get('type')}")
    t0 = time.time()
    try:
        resp = create_response(base_url=base_url, api_key=api_key, payload=payload, timeout=120)
        text = extract_response_text(resp).strip()
        print(f"  [{time.time()-t0:5.2f}s] SUCCESS")
        print(f"  → {text[:80]}")
        return {"variant": name, "status": "ok", "wall_clock_s": round(time.time()-t0, 2), "response_text": text}
    except Exception as e:
        err = str(e)[:400]
        print(f"  [{time.time()-t0:5.2f}s] FAIL: {err[:150]}")
        return {"variant": name, "status": "fail", "error": err}


def main() -> int:
    env_values = load_dotenv(".env")
    base_url = env_value("LLM_BASE_URL", env_values)
    api_key = env_value("LLM_API_KEY", env_values)
    model = env_value("LLM_MODEL", env_values)

    b64 = base64.b64encode(CLIP.read_bytes()).decode("ascii")
    data_url = f"data:video/mp4;base64,{b64}"
    print(f"Endpoint: {base_url}\nModel: {model}\nClip: {CLIP.stat().st_size/1024:.0f} KB")

    variants = [
        ("input_video_url (data URL)", {"type": "input_video_url", "video_url": {"url": data_url}}),
        ("input_video_url (string url)", {"type": "input_video_url", "url": data_url}),
        ("input_video with data field", {"type": "input_video", "data": data_url}),
        ("input_video with url field", {"type": "input_video", "url": data_url}),
        ("input_video_b64", {"type": "input_video_b64", "data": b64}),
        ("video as content type", {"type": "video", "video": {"url": data_url}}),
    ]

    results = [try_variant(name, blk, base_url=base_url, api_key=api_key, model=model)
               for name, blk in variants]

    out_path = CLIP.parent / "video_inline_variants_results.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved -> {out_path}")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for r in results:
        status = r["status"]
        marker = "OK   " if status == "ok" else "FAIL "
        print(f"  {marker} {r['variant']}")
        if status == "fail":
            err = r["error"]
            # Extract just the "message" field from the JSON error if possible
            if '"message":"' in err:
                msg = err.split('"message":"', 1)[1].split('"', 1)[0]
                print(f"         → {msg[:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
