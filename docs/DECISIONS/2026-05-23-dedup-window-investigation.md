# Dedup window investigation — `regime_dedup_window_ms` stays at 200ms

**Date:** 2026-05-23  
**Owner:** 严平川 (Fine Scan)  
**Branch:** `codex/fine-scan-peak-micro`  
**Status:** ✅ Decided — no code change.

## Original motivation

After Week 1 concurrency landed (30 min → 12 min wall clock), the natural
next question was: can we reduce API call count to shorten wall clock
further? The first candidate was raising `regime_dedup_window_ms` from
the current default of 200ms to ~1000ms, on the intuition that "merging
adjacent peaks" would mean "fewer Doubao calls".

User position before investigation (binding constraints):
1. Viral marketing video is deliberately information-dense — **NO
   prominence filtering** is allowed. Every detected moment is presumed
   meaningful until proven otherwise.
2. Only `regime_dedup_window_ms` is on the table. Other knobs that would
   filter peaks (e.g. lowering `max_peaks`) are out of scope.
3. The acceptable upper bound for hit-rate regression was "no GT events
   lost". Any specific text_pop / state_change event currently captured
   must remain captured.

## Investigation

Two sub-agents ran in parallel against existing cached data (no API
calls):

- **Agent A — quantitative sweep.** Re-ran `visual_peak_detector` on the
  11 cached block clips, simulated merge+select at thresholds
  100/200/400/600/800/1000/1500/2000ms, cross-referenced selected
  candidates against 116 GT beats at ±250ms tolerance.
- **Agent B — qualitative case study.** For thresholds 500/1000/1500ms
  on block_001/005/008, enumerated which specific peak/regime pairs
  would merge, pulled their `semanticAction` strings from existing
  v0.3 output, and classified merges as same-event (safe dedup) vs
  different-event (information loss).

Scripts: `C:/tmp/dedup_sweep.py`, `C:/tmp/dedup_sweep_v2.py` (out-of-tree).

## Findings

### 1. **dedup_window_ms does not change API call count.**

This is the central surprise. Production selector caps at
`max_peaks=12` per block, and almost every block has 19–60 merged
candidates regardless of dedup setting. The cap is the binding
constraint; dedup only changes which 12 candidates rank into the
top-12 by prominence.

| threshold | merged_total | selected_total | API_calls/video |
|----------:|-------------:|---------------:|----------------:|
| 100 ms    |     473      |    **130**     | 130             |
| 200 ms    |     ~450     |    **130**     | 130             |
| 600 ms    |     ~390     |    **130**     | 130             |
| 1000 ms   |     ~380     |    **130**     | 130             |
| 2000 ms   |     ~377     |    **130**     | 130             |

**For the question as posed (reduce API calls), no value of
`dedup_window_ms` in [100, 2000] ms helps.**

### 2. Raising the threshold *eliminates the regime channel.*

The composition of the selected 130 changes dramatically:

| threshold | peaks selected | regimes selected |
|----------:|---------------:|-----------------:|
|   100 ms  |     105        |     **25**       |
|   200 ms  |     119        |      11          |
|   400 ms  |     127        |       3          |
|  ≥600 ms  |   **130**      |     **0**        |

At ≥600ms, `detect_regime_boundaries_from_scores` (the entire ruptures
PELT pass we added in T13) becomes dead weight — every survivor of
selection is a `visual_peak`. The regime channel was added in T13
specifically to catch motion-end / settling events that peak detection
structurally misses (the "place down" pattern in block_001). Raising
dedup discards this signal source by design.

### 3. Aggregate hit rate *improves* slightly when raised…

| threshold | hits / 116 GT | hit_rate |
|----------:|---------------:|---------:|
|   100 ms  |    37          | 31.9%    |
|   200 ms  |    40          | 34.5%    |
|  ≥600 ms  |    **43**      | **37.1%** (plateau) |

100 → 600ms gains 6 hits, then flatlines. The gain comes from peaks
that were getting beaten in the prominence tournament by low-quality
regimes at 100/200ms thresholds.

### 4. …but Agent B identified specific high-value losses at higher thresholds.

Two illustrative concrete cases that *do* get lost when raising:

- **block_005 App Store popup** (`beat_002` regime @71251ms,
  `isBeatAligned: true`, prominence 37.0). At 200ms it's selected and
  is the canonical match for `true_005_002` @71200ms ("Pocket Yoga
  purchase confirmation popup"). At ≥500ms it's merged away. The
  surviving peak ("key press" @70751) cannot semantically substitute.
- **block_008 ChatGPT AI generation** (`beat_007` regime @149271ms,
  prominence 118.75, semantic "AI 开始生成回复文本"). At 200ms it
  uniquely covers `true_008_011` @151000ms ("training plan output").
  At ≥500ms it's gone; the kept peak only covers "ChatGPT opens".

These are exactly the kind of high-semantic-density moments the
user's "viral video is information-dense" constraint asked us to
preserve. The aggregate +3 hit rate at 1000ms is a statistical
artifact — different GTs gain hits while these two lose theirs.

## Decision

**Keep `regime_dedup_window_ms = 200` as the default.** No code change.

### Why

- Raising **does not save API calls** (constraint #1 of the user's
  original motivation is unmet).
- Raising **does lose specific high-value events** (constraint #1 of
  the user's binding constraints is violated).
- Raising **disables a deliberately-added detection channel** (the
  ruptures PELT pass from T13 specifically targets motion-end events
  that peak detection misses).
- The aggregate hit-rate gain (+2.6pp at 1000ms vs 200ms) is too small
  to justify either of the above costs.

### What we'd need to change to actually reduce API cost

The binding lever is `max_peaks`, not `dedup_window_ms`. Lowering
`max_peaks` from 12 to e.g. 8 would cut ~30% of calls. But that's
prominence filtering by another name — the 4 lowest-prominence peaks
per block are exactly what get cut. Per user policy this is also off
the table. **As of this decision, 12 min per video at 130 API calls is
the effective floor in the current architecture.**

If/when this becomes a forcing function (e.g. month-end quota
pressure), the conversation has to expand to one of:
- Relax constraint #1 (allow some prominence filtering, perhaps
  conditional on block role — CTA blocks may be safe candidates).
- Architectural change: collapse multiple peaks into one Doubao call
  via a sprite/strip image (Agent C's earlier suggestion; explicitly
  rejected at the time because it would break the per-peak quality
  that gives us 83% hit rate on hook blocks).

## Implications for future work

1. **regime channel is hanging by 200ms.** Anyone raising the default
   above 400ms should expect the regime detector to silently become a
   no-op. Document this constraint in `visual_peak_detector.py` docstring?
   (Not done; would be a code addition, deferred.)
2. **The `--regime-dedup-window-ms` CLI flag is now known to be a
   composition lever, not a cost lever.** Anyone using it to "tune
   speed" will get confusing results.
3. **The real bottleneck is `max_peaks=12` × 11 blocks = 132 calls.**
   Future API cost reductions must come from changing this constraint
   or one of its parents (block count, per-block target).

## Alternatives considered and rejected

| Alternative | Rejection reason |
|---|---|
| Raise dedup to 1000ms | Doesn't save calls; loses high-value text_pop events; kills regime channel |
| Raise dedup to 500ms | Same problems at smaller magnitude |
| Drop dedup to 100ms | Loses 6 GT hits (aggregate -2.6pp) |
| Per-block-role conditional dedup (e.g. 200 default, 1000 for closing/CTA) | Would require new code; cleanup pass is delete-only; not pursued in this iteration |
| Lower `max_peaks` to 8 to save calls | Violates "no prominence filtering" constraint |
| Sprite batching (1 call per block) | Would break 83% hit rate on hook blocks; quality risk explicitly rejected earlier |

## References

- Agents A and B reports: in conversation transcript on
  `codex/fine-scan-peak-micro` branch, dated 2026-05-23.
- Production wall-clock baselines:
  - `seed_assets/analysis/macbook_neo/fine_scan_v03_concurrent/`
    (concurrent=20, 12min, 41% hit rate)
  - `seed_assets/analysis/macbook_neo/fine_scan_v03_aggressive/`
    (concurrent=50, 10min, +1 timeout failure)
- Ground truth: `seed_assets/analysis/macbook_neo/ground_truth/action_beats_ground_truth.json` (116 beats across 11 blocks).
- Related commits: `6d167f5` (concurrency), `a0c6c6f` (timeout retry).
