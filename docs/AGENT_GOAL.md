# Agent Goal — viral-struct-ai Decision Agent

> North star for the Layer-1 **Decision Agent** (the "brain"). It consumes facts and emits
> typed decisions; a separate **HyperFrames Render Executor** (Layer 2) encodes pixels.

## North Star

Given a sample's `ViralStructureGraph` and the user's `AssetCard[]`, the Decision Agent drives the chain

```
SlotMatch[] → MaterialGap[] → GapReport[] → GapFillPlan[] → TimelineItem[] → RenderInput → RenderResult → QualityReport
```

so the migrated short video is the **most faithful structure transfer the assets can support**, with
**every gap resolved by the safest honest path**, and **every decision explainable, adjustable, and verifiable**.

> Operating sentence: *always choose the safest honest repair path; when assets/AIGC are unavailable,
> degrade missing evidence into a clearly-marked HyperFrames communication substitute instead of pretending
> the missing footage was recreated.*

## The reframe — what "perfect" means

**Perfect = perfect decision-making + perfect accounting**, not perfect material. A missing epic clip is not a
failure; *pretending it wasn't missing* is. The agent is judged on the correctness of its decisions and its
honesty about limits — never on possessing perfect footage.

## Two-layer split

- **Layer 1 — Decision Agent** (this goal): consumes facts → emits typed decisions. Owns deterministic
  *decision* invariants, but **not** deterministic *media execution*. Never touches pixels.
- **Layer 2 — HyperFrames Render Executor**: consumes `RenderInput`/`TimelineItem[]` → encodes the 成片.

## Operating contract

**LLM proposes · Schema validates · Code applies · Verifier judges.** No exceptions.

## Gap doctrine

Resolution order: **reuse real (crop/zoom) → HyperFrames communication card → bounded AIGC → ask user →
honest degraded substitute.** Routed by `requiresRealProof` / `evidenceType`.

> HyperFrames can replace structure, pacing, emphasis, copy, rhythm, and packaging — it **cannot** replace
> missing real-world evidence. Missing *proof* therefore degrades to an attributed substitute marked
> `resolutionStatus:'unresolved'` + `qualityImpact`, **never faked**.

## The seven invariants (the definition of "correct" — each is checkable)

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **Honesty** — never claim more than delivered | `resolutionStatus` / `qualityImpact` on `GapFillPlan`, propagated to `QualityReport` |
| 2 | **Safety** — no fabricated proof / testimonial / identity / claim | `safety.ts`, `requiresRealProof` gate, AIGC carries no claims |
| 3 | **Determinism** — same facts → same decisions | four-line spine; `GapReportSchema`/`GapFillPlanSchema.parse` at the boundary |
| 4 | **Boundary** — consumes facts, emits typed decisions, no media | `VideoEditContext` in → decisions out; renderer-neutral output |
| 5 | **Structure fidelity** — preserve role seq / rhythm / beat / emotional function, or report deviation | `summarizeTimelineStructure` vs the sample graph + `acceptanceCriteria` |
| 6 | **Completeness** — every gap → a typed outcome, none silently dropped | `count(plans) == count(gaps)`; `unresolved` surfaced in `QualityReport` |
| 7 | **Controllability** — every decision inspectable, overridable, re-runnable | `evidenceTrace` + `timelineEditor` NL edits |

## Coverage matrix (what "handle everything" means)

| Asset situation | Slot role | Decision |
|---|---|---|
| Covered | any | real asset (light treatment) |
| Partial | any | `reuseSpec` (crop/zoom) + packaging overlay |
| Missing | informational | `deterministic_editing_fill` → HyperFrames card |
| Missing | atmospheric, AIGC on | `aigc_fill` (reference-conditioned, no claims) |
| Missing | real-proof, user can provide | `ask_user_for_asset` |
| Missing | real-proof, can't + AIGC off | honest degraded substitute → `unresolved` + `qualityImpact` |

No empty cell; no cell handled by fabrication.

## Capability ladder

| Level | Meaning | Status |
|---|---|---|
| **L0** | Every gap → a valid, schema-checked decision; invariants hold at plan time | in progress |
| **L1** | Decisions executed — system outputs a 成片 (HyperFrames executor) | not started |
| **L2** | Every decision verified — two-level checks + self-heal | partial |
| **L3** | Human loop — NL edit / manual adjust / multi-version, invariant-gated | partial |
| **L4** | Optimize — best faithful migration, measured | not started |

## Acceptance bar

Goal met when, across an asset×gap test matrix (incl. epic-clip / declined-user / AIGC-off cases):
**0 invariant violations · GOAL.pdf P0 loop runs offline producing 成片 + `evidenceTrace` + `QualityReport`
· structure fidelity ≥ threshold with itemized deviations · 100% gap completeness · 100% replay determinism
· human override honored.**
