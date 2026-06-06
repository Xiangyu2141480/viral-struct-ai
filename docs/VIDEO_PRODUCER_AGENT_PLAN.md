# Video Producer Agent — Investigation & Rewrite Plan (RFC)

> Status: **proposal / pending owner decisions** (see §7). Produced from a 10-agent investigation
> (7 SOTA research angles + codebase/rubric grounding → synthesis → adversarial critique).
> Owner mandate: the LLM's **creativity is the engine** — this is a video **producer** agent (creative,
> like Claude Design / v0 / Lovable), not a mechanical editor. It must *read & understand* a sample viral
> ad + a new product + messy assets and **author** a new, similar, high-quality ad. HyperFrames is the
> creative canvas. Honesty is a **thin guardrail**, not the center of gravity.

## 1. Where we sit on the creativity spectrum

The field splits cleanly by "is the LLM the engine that **authors** the artifact, or a peripheral that
**fills a template**?":

1. **LLM authors code/markup** (v0/Lovable made literal): HyperFrames (LLM writes HTML+CSS+paused-GSAP →
   headless-Chrome frame-seek → deterministic MP4), Remotion (React-as-video). Max creative ceiling; none
   natively do reference→similar transfer.
2. **LLM authors a structured plan/screenplay, a renderer realizes it** — the architecture consensus:
   FireRed Style-Skills (capture-once → replay), OpenMontage ("start from a video you love"), ViMax
   (Director/Screenwriter/Producer/Generator), VideoDirectorGPT, HeyGen Video Agent (blueprint→review→render),
   InVideo v4 (storyboard + intent-to-edit).
3. **LLM fills JSON into a fixed template** — short-video-maker, Creatify URL-to-video, Arcads. The anti-pattern.
4. **LLM only ranks/selects clips** — vigenair recut. No authoring.

**Reference→similar-AD transfer is a proven commercial category** ("Ad Clone": Creatify, Pollo, AdStellar —
"analyze hook/pacing/CTA, rebuild copy+visuals for YOUR product, don't copy word-for-word") — which validates
our premise. But every commercial tool keeps the extracted structure **hidden + shallow** and renders onto a
**closed avatar/stock stage**; every pure-generative one (Sora/Veo-driven) **hallucinates the product** and can
fabricate proof.

**Our codebase today** sits in paradigm (2)/(3), leaning template-fill:
- The LLM authors the **script/copy** (real per-segment authoring) and **selects** from a closed packaging
  vocabulary (5 caption styles / 7 card types / 6 transitions / 6 motion presets). It authors **zero** visual
  composition.
- The renderer paints **solid-colour blocks + libass captions** — even a *matched real asset* compiles only to
  a background colour token; **no asset pixels are composited.** The "video" is coloured cards with subtitles.
- BUT our **capture layer (`ViralStructureGraph`) is ahead of competitors** — it carries intent + sourceInstance
  + acceptanceCriteria + transferRule + boundaries + creativeIngredients: exactly the inspectable, first-class
  structure artifact the market hides. And `RenderExecutor` is genuinely renderer-neutral (the code already names
  "HyperFrames/Remotion later" as the upgrade path).

**The two real gaps** (not the boundary, not the data model):
- **(a) the renderer never shows real pixels**, and
- **(b) the LLM cannot author the visual artifact — it only picks registry ids.**

## 2. Recommended identity & architecture

**Identity:** a creative video **producer** that READS the sample + product + assets, UNDERSTANDS *why the
sample works*, and **authors twice**:
1. a migrated viral **structure** (re-invent the hook, re-pace beats, choose which real asset plays each slot
   intent, re-ground each proof beat in real evidence, justify deviations) → emits the inspectable
   `ViralStructureGraph`-derived blueprint;
2. the on-canvas **realization** (layout, motion, emphasis, caption design, transitions) composing the user's
   **real** asset media.

The closed packaging vocabulary is **demoted** from a hard ceiling to **(a)** a curated palette/house-style the
author draws from and **(b)** a Zod canonicalizer the validator snaps unsafe output back into. The
renderer-neutral two-layer boundary is **kept**, but redefined: *the agent emits typed **design intent / an
authored composition spec**, the renderer executes pixels* — so authorship is central without the agent touching
pixels.

**Honesty as a thin, external guardrail** (on the *factual* substrate only, never the creative one):
- on-screen **facts/proof imagery** may only come from the grounded product+asset set; the LLM authors
  hook/pacing/motion/look freely;
- **claim-binding lint**: every on-screen factual assertion is bound to a source asset, else revised-or-dropped;
- the **real-proof gate** forbids AIGC in proof slots; any unresolved proof slot is forced to the honest-
  substitute style (teal + 「替代卡片 · 素材缺失」) **at paint time, regardless of how the author styled it**;
- AIGC is **marked** (the rubric's only honesty ask). The one hard floor: **never fabricate proof.**
- Because the ad is authored onto the user's *real* assets and missing coverage is surfaced (not invented), the
  system is **structurally incapable of hallucinating the product** — a defensible wedge the pure-generative
  competitors lack.

## 3. Grounding in the ACTUAL rubric (`scoring-matrix.md`, 100 + 10)

The adversarial critique correctly flagged that the synthesis over-weighted **determinism fingerprinting** and
**C2PA provenance** — those are *not* rubric items (they were my `AGENT_GOAL.md` invariants). What the rubric
actually rewards, and how this plan serves it:

| Rubric area | Pts | How the creative-producer rewrite serves it |
|---|---:|---|
| 结构迁移生成能力 | 10 | LLM **authors** the migrated structure (not template-fill) |
| 素材缺口补全 | 12 | gap doctrine kept; cards become **authored**, not picked |
| 最终效果展示 (preview/MP4) | 10 | **P0 fixes this** — real pixels instead of colour blocks |
| 画面包装能力 | 8 | LLM-authored caption/title/card/transition design |
| 真实素材适配 | 8 | **P0** composites real footage/keyframes |
| 多版本生成 | 4 | "generate N variants of this migrated structure" |
| 人工可调能力 | 8 | intent-to-edit ("开头更抓人") over the authored blueprint |
| 创意与产品完成度 | 7 | the whole creative-producer thesis |
| Bonus +10 | +10 | NL editing · real+AIGC fusion (marked) · explainable migration |

**Conclusion:** the creativity vision and the rubric point the same way. Strict determinism/provenance would
have been wasted effort. **Drop them.**

## 4. Reconciled phased plan (synthesis ambition × critique pragmatism)

- **P0 — Make pixels real (fix the colour-block lie).** Composite matched real asset media (footage keyframes /
  images, Ken-Burns/crop-zoom) **in the existing ffmpeg executor**; keep ffmpeg the reliable default. Honest
  substitute stays the only colour-block. *Directly unlocks 最终效果 (10) + 真实素材适配 (8); lowest risk; both
  synthesis & critique agree this ships first.*
- **P1 — Promote the LLM from id-selector to STRUCTURE + PACKAGING author.** Director/Screenwriter authoring of
  the migrated structure; add `creative_patterns` (hook_mechanism / emotional_arc / pacing / visual_rhythm) to
  the graph so the agent reads *why it works*; author a **validated composition spec** per beat (layout / motion
  / caption / transition). Packaging vocabulary → palette + canonicalizer. *Serves 结构迁移 (10) + 画面包装 (8)
  + 创意 (7).*
- **P2 — Human steer: intent-to-edit + multi-version.** Promote the timeline-patch stubs into conversational
  per-beat re-authoring; "generate N variants (高点击/高转化/高节奏)". *Serves 人工可调 (8) + 多版本 (4) + bonus.*
- **Spike (parallel, time-boxed) — HyperFrames authoring track.** LLM authors HTML/CSS/paused-GSAP behind the
  existing `RenderExecutor` interface as the rich **preview** the scoring plan names ("HyperFrames-first
  preview"). Kept a spike so a doc-only dependency can't break the demo.
- **DROPPED / deferred** (not rubric points, high cost): VLM visual self-heal loop, C2PA provenance manifest,
  determinism fingerprint, raw-HTML-as-the-only-path.

## 5. Keep / Refactor / Discard

**Keep:** `RenderContract.ts` boundary + honest-accounting; `ViralStructureGraph` + `ShotSlotNode` capture
(expand with `creative_patterns`); `slotMatcher` / `gapRepairPlanner` / `gapFillPolicy` (requiresRealProof
routing is sound); `safety.ts` + the honest-substitute concept (re-home as lint + paint-time enforcement);
`ffmpegExecutor` as the reliable executor; the four-line spine as the **audit skeleton** (now feeding the
author); `structureExtractor` + `assetAnalyzer`.

**Refactor:** `packagingVocabulary.ts` → palette + Zod canonicalizer (not a ceiling); `timelineGenerator` →
Director/Screenwriter authoring of blueprint + composition spec; `compileRenderInput` → carry **asset media** +
authored spec to the renderer; verifier files → static lint (claim-binding, real-proof, caption-fit);
`MIGRATED_SKILLS.md` line 46 → "agent authors **specs/composition**, not raw uncontrolled pixels."

**Discard:** the premise that matched real assets render as colour blocks; the hard-ceiling framing of the
packaging vocabulary; template-only narrative as a *primary* path (degraded fallback only).

## 6. Adversarial critique (recorded)

Verdict: *"reject as framed; accept P0 only."* Strongest points (all incorporated above):
- **Fabricated determinism/provenance bars** absent from the rubric → re-anchored to `scoring-matrix.md`, dropped.
- **Canvas not installed** (HyperFrames/Remotion/Chrome doc-only) → composite real pixels in ffmpeg; ffmpeg stays
  default; HyperFrames demoted to a time-boxed spike.
- **Raw HTML codegen risks "demo cannot run"** → author a **validated composition spec** applied
  deterministically, not raw HTML.
- **Creativity must not live only in card styling** → front-load it into understanding + structure migration.
- **Verifier/safety "keeps" are partly stubs** → keep what's real (gapFillPolicy/gapFillVerifier); defer VLM critique.

## 7. Open decisions for the owner

1. **Authoring mechanism / canvas** — validated composition-spec → ffmpeg (demo-safe), raw HTML → HyperFrames
   (max creativity, infra risk), or both (spec→ffmpeg reliable MP4 + HyperFrames preview spike).
2. **Sequencing vs the demo** — P0 real-pixels first, creativity-first, or parallel; what does the demo gate on?
3. **Determinism strictness** — the rubric doesn't require it; default = allow benign creative variance (recommended).
4. **Gen-video for real product photo** — allow honesty-safe image-to-video (Seedance keeps the real photo) for
   motion slots, or deterministic Ken-Burns/crop-zoom only? (default: deterministic now, model-router later.)
