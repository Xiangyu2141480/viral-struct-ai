# Gap Repair Design

Status: active design, 2026-06-05.

This document is the source of truth for material-gap diagnosis and repair in the video editor agent. It replaces older wording that described gap repair as a loose priority list.

## Purpose

The video editor agent must inherit information from previous stages. It should never "magically make" an asset. For every missing or partial slot, it must explain the gap, choose a controlled fill path, and verify that the migrated structure still holds.

Core flow:

```txt
VideoEditContext
-> GapReport[]
-> GapFillPlan[]
-> TimelineItem[]
-> VerificationReport
```

## Inherited Context

`VideoEditContext` carries the state needed for repair:

- `ViralStructureGraph`: segments, shot slots, intent, source instance, acceptance criteria, rhythm, packaging, boundaries, creative ingredients.
- `ContentBrief`: product, target audience, scenario, selling points, CTA, style preference, claim boundaries.
- `AssetCard[]`: visual description, detected objects, human presence, motion potential, candidate slot roles, quality, source.
- `SlotMatch[]`: matched / partial / missing, score, matched criteria, missing description, treatment spec.
- `MaterialGap[]`: slot, role, severity, reason, impact, missing ingredients.
- `EditConstraints`: aspect ratio, AIGC allowance, human-generation allowance, claim sources, forbidden claims.

## GapReport

`GapReport` is diagnosis, not the repair itself.

Required information:

```ts
type GapReport = {
  id: string;
  slotId: string;
  segmentId: string;
  segmentRole?: SegmentRole;
  slotRole: ShotSlotRole;
  visualType: "image" | "video" | "text" | "generated";
  durationMs: number;
  evidenceType:
    | "none"
    | "product_identity"
    | "social_proof"
    | "factual_claim"
    | "usage_demo";
  requiresRealProof: boolean;
  emotionalFunction: "curiosity" | "desire" | "trust" | "urgency";
  whyUnmatched: string;
  missingIngredients: CreativeIngredientType[];
  sourceIntent?: ShotSlotIntent;
  acceptanceCriteria?: ShotSlotAcceptanceCriteria;
};
```

`requiresRealProof` is the hard routing gate.

If `requiresRealProof === true`, AIGC is forbidden as the first answer. The planner must route to `ask_user_for_asset`, or use deterministic attributed packaging only when it does not pretend to supply the missing proof.

## Three Fill Methods

Every `GapFillPlan` chooses exactly one primary method:

```txt
aigc_fill
deterministic_editing_fill
ask_user_for_asset
```

### AIGC Fill

Use only for low-proof visual gaps:

- Background.
- Cover image.
- Atmosphere insert.
- Abstract motion.
- Style bridge.
- Non-factual b-roll.

AIGC must not generate:

- Real human proof.
- Testimonials.
- Before/after evidence.
- Product identity proof.
- Logos.
- Readable text.
- Prices, rankings, certifications, or claims.

`AssetGenerationRequest` must include forbidden elements, risk flags, retry cap, fallback repair, and verification criteria. It must not include a factual-claim allow-list. Claims belong in HyperFrames cards or subtitles where they can be attributed and checked.

### Deterministic Editing Fill

This is the default automated path. It covers HyperFrames packaging and deterministic editing:

- Crop / zoom existing assets.
- Loop a still image with motion.
- Reorder or reuse assets.
- Title card.
- Selling-point card.
- Comparison card.
- CTA card.
- Subtitle or script repair.
- Transition bridge.
- Product layout animation.

This path fills communication gaps. It can explain, emphasize, compare, and package. It must not pretend that missing real proof exists.

### Ask User For Asset

Use when the gap needs real-world evidence:

- Human demo.
- Real usage process.
- Product identity proof.
- Social proof.
- Testimonial.
- Real before/after evidence.
- Regulated or strong factual claim proof.

The agent should not simply say "upload a video." It should produce a structured `UserAssetRequest`:

```ts
type UserAssetRequest = {
  reason: string;
  whyRequired: string;
  idealShot: string;
  minimalAcceptableShot: string;
  shootingTips: string[];
  durationMs: [number, number];
  framing: "closeup" | "medium" | "wide" | "macro";
  motion: "static" | "push_in" | "hand_operation" | "fast_cut";
  examplesToAvoid: string[];
  fallbackIfUserCannotProvide:
    | "hyperframes_attributed_card"
    | "leave_unresolved";
};
```

If no human is available in batch/demo mode, the gap must become a typed unresolved outcome, not silent fabrication.

## Routing Table

| Diagnosis | Method | Reason |
|---|---|---|
| `requiresRealProof = true` | `ask_user_for_asset` | Real evidence must not be fabricated. |
| Generic comparison / CTA / hook communication gap | `deterministic_editing_fill` | HyperFrames/cards/subtitles can carry communication. |
| Style/background/atmosphere gap with AIGC enabled | `aigc_fill` | Low-factuality visual supplement. |
| AIGC disabled or unsafe | `deterministic_editing_fill` or unresolved | Honest degradation beats fake footage. |

## Verification

Verification has two levels.

L1 local checks run per repair:

- Slot reference exists.
- Asset references exist.
- Duration fits.
- Safe area fits.
- Claims are supported.
- Product identity is real when required.
- No unapproved human generation.
- Visual coherence with neighboring assets.

L2 global checks run after the repair batch:

- Role sequence preserved.
- Pacing and duration tolerance preserved.
- Beat/transition alignment preserved when available.
- Emotional function preserved.
- Structure-fidelity KPI remains above tolerance.

A repair can pass L1 and still fail L2 if the batch ruins rhythm or persuasive function.

## M1-M3 Phasing

M1:

- Implement `GapReport`.
- Implement router capable of all three methods.
- Implement deterministic editing fill and user asset request.
- Let AIGC emit mocked requests or mocked `AssetCard`s only.
- Implement L1/L2 verifier surfaces.

M2:

- Add real `AssetGenerationRequest` flow with mocked AIGC outputs end to end.
- Add retry cap and fallback behavior.
- Add prompt-writing tests.

M3:

- Integrate real AIGC provider.
- Add VLM/perceptual verifier.
- Add visual-coherence checks and optional color/grade matching.

## Safety Invariants

- AIGC is not the default.
- Real proof gaps do not route to generated media first.
- Generated pixels do not contain claims.
- Every plan references a real inherited slot.
- Every referenced asset ID must exist.
- Every unresolved gap is surfaced in quality reporting.
- HyperFrames output is a compiled artifact, not canonical timeline state.
