# Stack Decision: HyperFrames-First Video Editor Agent

Status: active decision, 2026-06-05.

This ADR is the implementation reference for the video editor agent stack. It supersedes older Remotion-first planning notes as implementation guidance. Historical research can still mention Remotion, but active code should not depend on it.

## Decision

Use a two-language backend intentionally:

```txt
Python = analysis sidecar
TypeScript = online product backend and video editor agent
```

Python owns slow or media-heavy understanding work:

- FFmpeg / ffprobe / OpenCV-style preprocessing.
- Rough scan, fine scan, boundary scan, ASR, media metadata, and asset analysis experiments.
- Offline or sidecar artifacts such as `structure_graph.json`.

TypeScript owns the online product workflow:

- API routes and orchestration in `apps/api`.
- Shared contracts in `packages/shared`.
- Video editor agent core in `packages/video-agent`.
- Gap routing, timeline planning, natural-language edit patches, verification, and render orchestration.
- HyperFrames compilation and preview harness.

The boundary between Python and TypeScript is versioned JSON contracts. Python must not own product workflow state; it emits artifacts. TypeScript validates those artifacts before using them.

## Renderer

HyperFrames is the sole active renderer direction.

Remotion is historical comparison only:

- No active dependency.
- No preview adapter.
- No renderer split where users preview one engine and ship another.

Preview should be solved around the same HyperFrames composition artifact that final render uses. HyperFrames compositions are HTML/CSS/JS, so the preview harness should mount the composition in a browser and drive frame/fps seeking. This is real work and should be budgeted, but it avoids preview-vs-final drift.

## Source Of Truth

Renderer-neutral IR remains the source of truth:

```txt
ViralStructureGraph
-> AssetCard[]
-> SlotMatch[]
-> MaterialGap[]
-> GapReport[]
-> GapFillPlan[]
-> TimelineItem[]
-> RenderInput
-> VerificationReport
```

HyperFrames HTML/CSS/JS is a compiled artifact, not canonical state. Do not leak HyperFrames-specific fields into `TimelineItem[]` or future `RenderInput`. Strategy-specific details can live in `GapFillPlan`, because that layer chooses how to fill a gap.

## Four-Line Principle

```txt
LLM proposes.
Schema validates.
Code applies.
Verifier judges.
```

LLMs may propose structured plans, copy, prompt requests, and edit operations. They must not directly mutate timelines, silently generate unvalidated assets, or ship arbitrary renderer code into the core path.

## LLM vs Deterministic Split

| Area | LLM / VLM | Deterministic Code |
|---|---|---|
| Source video understanding | rough/fine semantic observations | ffprobe, frame extraction, artifact assembly |
| Slot matching | alignment judge, missing descriptions | schema validation, asset ID checks, fallback scoring |
| Gap repair | copy/spec suggestions, AIGC prompt draft | `requiresRealProof` gate, method routing, verifier checks |
| Timeline editing | structured patch proposal | patch validation, application, resequencing |
| Rendering | none in core path | HyperFrames compiler, browser preview, FFmpeg verification |
| Quality | perceptual notes as optional inputs | compiler fidelity, duration, structure, safe-area, claim checks |

## M1 Walking Skeleton

M1 should build a deterministic spine before advanced natural-language editing:

1. `VideoEditContext` as inherited editor state.
2. `GapReport[]` as typed diagnosis.
3. `GapFillPlan[]` with three fill methods.
4. Local and global verification checks.
5. `TimelineItem[]` integration.
6. HyperFrames compiler input and preview harness spike.
7. Structure-fidelity KPI against the compiler input.

At M1, structure fidelity means compiler fidelity: rendered/measured output structure should match the planned `TimelineItem[]` within tolerance. Sample-migration fidelity comes later when the structure migration agent is fully implemented.

## Non-Goals

- Do not rebuild a general video editor.
- Do not make Python own interactive editing state.
- Do not use AIGC as the default answer to missing assets.
- Do not generate human proof, testimonials, product identity, or factual claims in AIGC pixels.
- Do not let HyperFrames DOM become the timeline protocol.
