# Migrated thoughts & skills — from the leading video-editing agents

> What we deliberately ported (as **original code in our types**, not copied source) from the frontier OSS
> video-editing agents, why, and in what order. Distilled via a multi-agent extraction + synthesis + adversarial
> critique pass. Sources and licenses are recorded so the port stays legally clean.

## Principle (non-negotiable)

**Port patterns, not code.** Ideas/architectures are adopted; no external source, component code, TSX, JSON
presets, or prompt text is reproduced. Every artifact is original and expressed in *our* types
(`PackagingCardSpec`, `RenderInput`, `ViralStructureGraph.packaging`, `GapFillPlan`, `TimelineItem`).

| Source | License | Use | What we took |
|---|---|---|---|
| editor-pro-max | "Other" (all-rights-reserved) | **ideas only** | the *taxonomy* idea: a closed component/template/preset vocabulary the agent SELECTS from |
| short-video-maker | MIT | adaptable | props→fixed-template discipline; audio-duration-drives-timing; searchTerms→assetId indirection |
| FireRed-OpenStoryline | Apache-2.0 | adaptable | "Editing Skill" = capture a sample's style once → replay/migrate it; plan/render tool boundary |
| mcp-video | Apache-2.0 | adaptable | typed ops + preflight guardrails |
| OpenMontage | AGPL-3.0 | **ideas only** | pre-render QA gates (slideshow-risk, delivery-promise) |
| HyperFrames / cc-video-toolkit | Apache-2.0 / MIT | adaptable | agent-native render, lint/render self-heal loop, determinism fingerprint, project-state lifecycle |

## The one rule the critic made us state: honesty precedence

Styling must **never** mask honesty. The colour-block fallback and the `（替代卡片 · 素材缺失）` substitute
marker take precedence over any card styling: a `resolutionStatus:'unresolved'` segment is rendered as an
honest substitute regardless of theme/card, and a real-proof slot that became non-asset without honest
degradation is an **overclaim** (to be flagged by the delivery-promise gate). Invariants #1 (Honesty) and
#2 (Safety) outrank visual polish.

## Migrated *thoughts* (agentic reasoning) — status vs our project

- **Data-gen not code-gen** (have) — keep the boundary; tighten the *data* that crosses it (closed
  `PackagingCardSpec`, no new free-string escape hatch).
- **Closed vocabulary as the contract** (partial→landed) — LLM proposes an id, schema validates, code applies
  the registry record, verifier judges pixels. ← **landed as `packagingVocabulary.ts`**.
- **Capture-once-replay packaging style** (new) — `derivePackagingTheme(graph)` maps the source's loose
  packaging strings → a typed theme so the migrated video inherits the *look*, not just the skeleton.
- **Preflight/lint before pixels** (partial) — `preflightRenderInput()` tri-state findings → `warnings`.
- **Name & measure slideshow risk** (new) — the agent's weakest output property as a verifier dimension.
- **Delivery-promise honesty at the render layer** (partial) — join `RenderSegment`↔`GapFillPlan` by slotId.
- **Measured-audio / readability duration, slot-tolerance gated** (new).
- **Library-scoped AssetQuery→assetId ranker** (new) — offline analogue of searchTerms; the reuse-real rung.
- **Frame-indexed (paused-clock) motion** (new) — `motionTransform(preset, p)`, p = frame/total; never wall-clock.
- **DecisionTrace on the gap-fill ladder** (partial) — record rejected rungs + deciding factor.
- **ProjectState lifecycle wrapping the four-line spine** (new, low) — gate verdicts, not a replacement.
- **DO NOT PORT** (hold the line): agent-authored HTML/TSX/GSAP, Remotion runtime as the protocol, external
  stock fetch in the brain, imperative op streams, full-regeneration editing, vendor-scoring in the brain,
  and — critically — **AIGC/stock may restyle/pace/emphasise but NEVER manufacture proof**.

## Build order (synthesis)

1. **`packagingVocabulary.ts`** — closed id unions + registries + `PackagingCardSpec` + Zod + `motionTransform()`. ✅ **DONE**
2. Tighten `TimelineItem.packaging.captionStyle`→`CaptionStyleId`, widen `motion`→`MotionPresetId`; tighten `HyperFramesFillSpec` to ids.
3. `RenderSegment.card?: PackagingCardSpec` + `cardSpecFromTimelineItem()`; `THEME_REGISTRY.roleBackground` replaces `BACKGROUND_BY_ROLE`.
4. **`CARD_RENDERERS` in `ffmpegExecutor`** — paint styled cards (libass + drawbox) instead of solid colour. ← *the visible colour-block fix lands here*. Colour-block stays the honest fallback.
5. `derivePackagingTheme()` in video-agent; wire into the timeline generator + `buildDeterministicEditingSpec`.
6. `preflightRenderInput()` + `captionFits()` — render-side guardrail pass.
7. `scoreSlideshowRisk()` + `QualityReport.slideshowRisk` + a `motion_variation` verifier check (pending until motion lands).
8. `resolveAssetQuery()` + `AssetResolver`/`LibraryAssetResolver` — turn the reuse-real rung into composited footage.
9. `reconcileDurations()` + `DecisionTrace` + delivery-promise gate.
10. Real `timelinePatchPlanner` (typed `EditOperation`) + render-env/output-hash determinism fingerprint + `ProjectState`.

## What's landed now

**Step 1 — `packages/shared/src/packagingVocabulary.ts`** (original): the closed design vocabulary
(`CaptionStyleId`/`CardTypeId`/`TransitionId`/`MotionPresetId`/`ThemeId`, all derived from Zod enums =
single source of truth), the renderer-resolvable registries (`CARD_/CAPTION_/TRANSITION_/MOTION_/THEME_`),
the discriminated `PackagingCardSpec` + schema, loose-parse guards, and the pure `motionTransform()`.

Typecheck + build green. This is the dependency root; it does **not** change the rendered video yet — that
is **step 4** (`CARD_RENDERERS`), which is the next visible win.
