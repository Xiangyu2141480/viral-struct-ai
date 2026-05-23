# Deletion Log — Code Cleanup Pass

Pure-subtraction cleanup audit triggered by user request. No additions, no
refactors, no compat shims — only `delete` and `merge duplicates`.

Audit phase produced 8 candidate IDs (D1-D8) plus 1 user-decision item (Q1
probe scripts — user chose to keep). User approved D1-D8.

## Commit summary

| Batch | Commit | Files changed | LOC delta |
|---|---|---|---|
| 1 (D1–D6) | `38781a7` | 7 (incl. log) | +60 / −7 |
| 2 (D7) | `1b9c765` | 2 | 0 / −81 |
| 3 (D8) | `4298990` | 1 | +2 / −4 |

Net production deletions: **~92 lines of dead code removed**, **0 functionality lost**, **all 103 unit tests pass at every batch boundary**.

## Batch 1 — Unused imports (D1-D6)

Tools: `vulture --min-confidence 60`, `pyflakes`. All 6 confirmed via cross-reference grep that the imported names are not referenced anywhere in the importing module.

| ID | File | Removed | Confidence |
|---|---|---|---|
| D1 | `scripts/visual_peak_detector.py` | `Iterable` from `from typing import Any, Iterable` | vulture 90% + pyflakes |
| D2 | `scripts/doubao_fine_scan.py` | `write_text` from `from doubao_rough_scan import (...)` | pyflakes |
| D3 | `scripts/doubao_boundary_scan.py` | `import os` | pyflakes |
| D4 | `tests/test_doubao_boundary_scan.py` | `import json` | pyflakes |
| D5 | `tests/test_doubao_rough_scan.py` | `import json` | pyflakes |
| D6 | `scripts/_one_off_video_url_probe.py` | `api_url`, `request_json` from import list | pyflakes |

**Verification:** all unit tests pass.
**Commit:** see below

## Batch 2 — Dead OLD-pipeline audio helper family (D7)

`build_block_audio_analysis()` was the v0.2 mechanism for injecting audio
beat data into the model prompt. The v0.3 refactor (T4) moved audio handling
to `audio_beats_ms_in_block_abs()` (different function, same file) used by
code-side `align_anchor_to_audio_beat()`. The old function is now unreachable
from production; only one test still references it.

| ID | File | Removed |
|---|---|---|
| D7a | `scripts/doubao_fine_scan.py` | function `_tempo_bpm` (lines ~96-101) |
| D7b | `scripts/doubao_fine_scan.py` | function `_beat_source` (lines ~103-107) |
| D7c | `scripts/doubao_fine_scan.py` | function `build_block_audio_analysis` (lines ~110-142) |
| D7d | `tests/test_doubao_fine_scan.py` | test `test_build_block_audio_analysis_uses_beat_this_relative_times` |

**Verification:** all unit tests pass.
**Commit:** see below

## Batch 3 — Unreachable `dry_run` parameter on prepare_block_clip (D8)

`prepare_block_clip` accepts `dry_run: bool = False` but the only production
caller (`process_block_with_peak_micro`) is short-circuited at the higher
level: if `args.dry_run` is true, the function returns early before ever
calling `prepare_block_clip`. As a consequence the `and not dry_run` guard
and the `run_ffmpeg(..., dry_run=dry_run)` forwarding inside
`prepare_block_clip` are unreachable in this codebase. `run_ffmpeg` retains
its own `dry_run` kwarg because it is a general utility used elsewhere
(`scripts/video_tools.py`).

| ID | File | Removed |
|---|---|---|
| D8 | `scripts/doubao_fine_scan.py` | `dry_run` parameter on `prepare_block_clip`, the `and not dry_run` clause, and the `dry_run=dry_run` argument forwarded to `run_ffmpeg` inside that function |

**Verification:** all unit tests pass.
**Commit:** see below
