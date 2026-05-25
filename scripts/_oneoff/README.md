# `_oneoff/` — one-off probes (living diagnostics)

Probe scripts kept as runnable historical artifacts. **Not part of the
production pipeline**. Each one was written to answer a specific decision
question, and the answer it produced is captured in an ADR or commit
message. Re-run them when you need to re-verify that the question's
answer hasn't changed (e.g. Volcengine endpoint behaviour shifts).

Each script is self-contained — no imports from the rest of `scripts/`.
Safe to delete a probe once its decision is permanently closed; safe to
keep all of them as historical record.

## Inventory

| Script | Question it answered | Answer / link |
|---|---|---|
| `doubao_window_probe.py` | What is the minimum peak-window length Doubao Seed 2.0 lite can usefully describe? | P0.1 — 1.4 s is the sweet spot, validated by manual scoring; settled in `prepare_block_clip` window math. |
| `video_url_probe.py` | Does the Volcengine ARK chat endpoint accept inline base64 video_url instead of `file_id`? | No — all 6 variants returned 400. Settled in Fine Scan v0.3 architecture (Files API path retained). |
| `video_inline_variants.py` | Companion to the URL probe — tested 6 inline content-type variants. | Same finding as above. |
| `concurrency_probe.py` | What is a safe in-flight cap when calling `/responses` concurrently? | Sweet spot ≈ 6 at 25-concurrent; settled in W1.1 (`get_http_semaphore` default + `--max-concurrent-http` CLI flag). |

## Conventions

- Filename: no `_one_off_` prefix needed inside `_oneoff/` (subdir already
  signals intent). Just describe what the probe does.
- Each probe **must** have a module docstring stating the question it
  answered and the decision it settled.
- Probes **must not** be imported by production scripts. They are runnable
  scripts only.
- When a probe's question is permanently closed and you don't expect to
  re-verify, delete the file. Otherwise keep it.
