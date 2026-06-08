#!/usr/bin/env python
"""Delete uploaded files from the Ark account to release file-storage quota.

The fine-scan pipeline uploads ~150 files/run (block clips + peak windows) and
historically never deleted them, so repeated runs exhaust the account quota
(HTTP 403 OperationDenied.FileQuotaExceeded). This one-off (or scheduled) utility
lists and deletes those files concurrently.

Usage:
  python scripts/cleanup_ark_files.py --dry-run     # list + count only
  python scripts/cleanup_ark_files.py               # actually delete
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from llm_client import (  # noqa: E402
    configure_http_semaphore,
    delete_file,
    env_value,
    gated_call,
    list_files,
    load_dotenv,
)


def _credentials(args: argparse.Namespace) -> tuple[str, str]:
    env_values = load_dotenv(args.env)
    base_url = args.base_url or env_value("LLM_BASE_URL", env_values)
    api_key = args.api_key or env_value("LLM_API_KEY", env_values)
    if not base_url or not api_key:
        raise SystemExit("Missing LLM_BASE_URL / LLM_API_KEY (set in .env).")
    return base_url, api_key


def run(args: argparse.Namespace) -> int:
    base_url, api_key = _credentials(args)
    configure_http_semaphore(int(args.max_concurrent))

    deleted, failed, rounds = 0, 0, 0
    while rounds < int(args.max_rounds):
        rounds += 1
        resp = list_files(base_url=base_url, api_key=api_key, limit=int(args.page))
        # An empty account can come back as null/no-data rather than {"data": []}.
        files = (resp or {}).get("data") or []
        if not files:
            break
        ids = [f.get("id") for f in files if f.get("id")]
        print(f"[round {rounds}] listed {len(ids)} files", flush=True)
        if args.dry_run:
            print(f"[dry-run] would delete {len(ids)} files (stopping after first page)")
            return 0

        def _del(file_id: str) -> bool:
            try:
                gated_call(delete_file, base_url=base_url, api_key=api_key, file_id=file_id)
                return True
            except Exception as exc:  # best-effort: skip files that won't delete
                print(f"  [warn] delete failed for {file_id}: {exc}", flush=True)
                return False

        with ThreadPoolExecutor(max_workers=int(args.max_concurrent)) as pool:
            futures = {pool.submit(_del, fid): fid for fid in ids}
            for fut in as_completed(futures):
                if fut.result():
                    deleted += 1
                else:
                    failed += 1
        print(f"[round {rounds}] deleted={deleted} failed={failed}", flush=True)
        # If a page kept returning the same undeletable files, stop.
        if failed and failed >= len(ids):
            print("[stop] a full page failed to delete; aborting to avoid a spin.")
            break

    print(f"\nDONE: deleted={deleted} failed={failed} rounds={rounds}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--env", default=".env")
    p.add_argument("--base-url", default="")
    p.add_argument("--api-key", default="")
    p.add_argument("--max-concurrent", type=int, default=16)
    p.add_argument("--page", type=int, default=0, help="Per-list page size (0 = provider default).")
    p.add_argument("--max-rounds", type=int, default=200, help="Safety cap on list/delete rounds.")
    p.add_argument("--dry-run", action="store_true", help="List + count only; delete nothing.")
    return p


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
