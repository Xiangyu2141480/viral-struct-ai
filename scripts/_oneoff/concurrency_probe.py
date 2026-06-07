#!/usr/bin/env python
"""Probe the LLM Responses API concurrency limit.

Strategy: upload one clip ONCE, then fire N parallel /responses calls all
referencing the same file_id. Measure success / 429 / latency at each
concurrency level. Identifies the safe in-flight cap for the pipeline
refactor.
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_client import (  # noqa: E402
    create_response,
    env_value,
    extract_response_text,
    load_dotenv,
    upload_file,
    wait_for_file,
)

CLIP = Path("C:/tmp/peak_window_probe/peak_test_1.4s.mp4")
PROMPT_TEXT = "用一句话描述这段视频。"

# Concurrency levels to probe. Going beyond 50 risks hard-banning the key.
LEVELS = [5, 10, 20, 30, 50]


def fire_one(file_id: str, *, base_url: str, api_key: str, model: str, req_idx: int) -> dict:
    payload = {
        "model": model,
        "input": [{"role": "user", "content": [
            {"type": "input_video", "file_id": file_id},
            {"type": "input_text", "text": PROMPT_TEXT},
        ]}],
        "store": True,
        "temperature": 0,
    }
    t0 = time.time()
    try:
        resp = create_response(base_url=base_url, api_key=api_key, payload=payload, timeout=120)
        text = extract_response_text(resp).strip()
        return {
            "req_idx": req_idx,
            "status": "ok",
            "latency_s": round(time.time() - t0, 2),
            "response_text": text[:50],
        }
    except Exception as e:
        err = str(e)
        # Classify error
        kind = "other"
        if "HTTP 429" in err or "RequestBurstTooFast" in err or "ServerOverloaded" in err:
            kind = "429_rate_limit"
        elif "HTTP 5" in err:
            kind = "5xx_server"
        elif "timed out" in err.lower() or "timeout" in err.lower():
            kind = "timeout"
        elif "HTTP 4" in err:
            kind = "4xx_client"
        return {
            "req_idx": req_idx,
            "status": "fail",
            "kind": kind,
            "latency_s": round(time.time() - t0, 2),
            "error": err[:200],
        }


def probe_level(level: int, file_id: str, *, base_url: str, api_key: str, model: str) -> dict:
    print(f"\n=== Concurrency level: {level} ===")
    t_batch_start = time.time()
    with ThreadPoolExecutor(max_workers=level) as pool:
        futures = [
            pool.submit(fire_one, file_id, base_url=base_url, api_key=api_key, model=model, req_idx=i)
            for i in range(level)
        ]
        results = [f.result() for f in as_completed(futures)]
    batch_wall = time.time() - t_batch_start

    oks = [r for r in results if r["status"] == "ok"]
    fails = [r for r in results if r["status"] == "fail"]
    err_kinds: dict[str, int] = {}
    for r in fails:
        err_kinds[r.get("kind", "other")] = err_kinds.get(r.get("kind", "other"), 0) + 1

    latencies_ok = sorted([r["latency_s"] for r in oks])
    summary = {
        "level": level,
        "batch_wall_s": round(batch_wall, 2),
        "success_count": len(oks),
        "fail_count": len(fails),
        "error_kinds": err_kinds,
        "throughput_rps": round(len(oks) / batch_wall, 2) if batch_wall > 0 else 0,
        "latency_ok": {
            "min": latencies_ok[0] if latencies_ok else None,
            "p50": statistics.median(latencies_ok) if latencies_ok else None,
            "p95": latencies_ok[int(len(latencies_ok) * 0.95)] if len(latencies_ok) > 1 else (latencies_ok[0] if latencies_ok else None),
            "max": latencies_ok[-1] if latencies_ok else None,
        },
    }

    print(f"  batch wall: {batch_wall:.2f}s")
    print(f"  success: {len(oks)}/{level}, fail: {len(fails)}")
    if err_kinds:
        print(f"  errors: {err_kinds}")
    if latencies_ok:
        print(f"  latency (ok): min={latencies_ok[0]:.1f}s p50={summary['latency_ok']['p50']:.1f}s "
              f"p95={summary['latency_ok']['p95']:.1f}s max={latencies_ok[-1]:.1f}s")
    print(f"  throughput: {summary['throughput_rps']:.2f} req/s")
    return summary


def main() -> int:
    env_values = load_dotenv(".env")
    base_url = env_value("LLM_BASE_URL", env_values)
    api_key = env_value("LLM_API_KEY", env_values)
    model = env_value("LLM_MODEL", env_values)
    if not all([base_url, api_key, model]):
        raise SystemExit("Missing config")
    if not CLIP.exists():
        raise SystemExit(f"Test clip not found: {CLIP}")

    print(f"Endpoint: {base_url}\nModel: {model}\nClip: {CLIP.stat().st_size/1024:.0f}KB")

    # Step 0: upload once, reuse file_id across all probes
    print("\n--- One-shot upload to get reusable file_id ---")
    t = time.time()
    file_info = upload_file(base_url=base_url, api_key=api_key, video_path=CLIP, fps=None)
    wait_for_file(base_url=base_url, api_key=api_key, file_id=file_info["id"],
                  poll_interval=1, max_wait_seconds=60)
    print(f"  uploaded in {time.time()-t:.2f}s, file_id={file_info['id']}")

    all_summaries = []
    for level in LEVELS:
        summary = probe_level(level, file_info["id"], base_url=base_url, api_key=api_key, model=model)
        all_summaries.append(summary)
        # Cool-down between levels to let rate-limit window roll over
        if level != LEVELS[-1]:
            print(f"  [cooldown 8s]")
            time.sleep(8)

    out_path = CLIP.parent / "concurrency_probe_results.json"
    out_path.write_text(json.dumps(all_summaries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved -> {out_path}")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"{'level':>5} {'success':>8} {'fail':>5} {'wall_s':>7} {'p50_lat':>8} {'p95_lat':>8} {'throughput':>11}")
    for s in all_summaries:
        l = s["latency_ok"]
        print(f"{s['level']:>5} {s['success_count']:>8} {s['fail_count']:>5} "
              f"{s['batch_wall_s']:>7.2f} "
              f"{(l['p50'] or 0):>8.1f} {(l['p95'] or 0):>8.1f} "
              f"{s['throughput_rps']:>9.2f}/s")
        if s["error_kinds"]:
            print(f"      errors: {s['error_kinds']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
