# Asset Manager Video Agent Contract

## Purpose

Asset Manager exposes `AssetSupplyContext` as deterministic material-supply evidence for downstream systems. It tells the Video Agent what assets exist, how reliable they are, which source slots they can support, and where material coverage is weak or insufficient.

Asset Manager does not render fallback cards, choose repair strategy, create final `MaterialGap`, or compose a timeline. Those decisions belong to SlotMatcher, GapRepairPlanner, and the Video Agent.

## Protocol Version

- Canonical response: `protocolVersion: "asset-supply-v1"`
- Canonical endpoint: `POST /api/assets/manager/asset-supply-context`
- Legacy alias: `POST /api/assets/manager/video-agent-bundle`
  - The route name is kept for compatibility.
  - Its response is still `asset-supply-v1`.
  - New consumers should use `/asset-supply-context`.

## Endpoint

### POST `/api/assets/manager/asset-supply-context`

Request:

```json
{
  "structureGraph": "<ViralStructureGraph optional>",
  "assetCards": ["<AssetCard>"],
  "contentBrief": "<ContentBrief optional>",
  "libraryId": "kangshifu_demo"
}
```

Response:

```json
{
  "assetSupplyContext": {
    "protocolVersion": "asset-supply-v1",
    "libraryId": "kangshifu_demo",
    "generatedAt": "1970-01-01T00:00:00.000Z",
    "assets": [],
    "libraryProfile": {},
    "contextualCoverage": {
      "coverageSummary": {},
      "slotCoverages": [],
      "observations": []
    },
    "warnings": []
  },
  "warnings": []
}
```

Sample:

- `docs/examples/asset-supply-context.sample.json`

## Responsibility Boundary

Asset Manager provides:

- normalized assets
- deterministic asset analysis
- media/keyframe/quality evidence
- slot affordance priors
- contextual slot coverage
- candidate asset supply
- missing ingredients
- potential impact evidence
- material coverage observations

Asset Manager does not provide:

- fallback card rendering
- final `SlotMatch` decision
- final `MaterialGap` decision
- `GapRepair` strategy
- title/benefit/CTA card composition
- timeline composition
- MP4 rendering

## How Video Agent Should Consume It

For each `ContextualSlotCoverage`:

1. Read `coverageStatus`.
2. Inspect `candidateAssets[]`.
3. Read `candidateAssets[].mediaReadiness`.
4. Read `candidateAssets[].constraints`.
5. If coverage is `weak` or `insufficient`, use `observations[]` as evidence, then wait for or request `GapRepair` output.

For each `SlotAssetCandidate`:

- `usableAs` means what the asset can safely support, such as `image_clip`, `video_clip`, `poster_frame`, or `overlay_support`.
- `constraints.notEnoughForStandaloneShot` means the candidate should not be treated as a final shot without downstream planning.
- `mediaReadiness.hasUsableUrl` and `hasLocalPath` are readiness evidence, not permission to read arbitrary paths.
- `evidence` includes role affordance, quality, semantic signals, keyframe IDs, reasons, and warnings.

For each `MaterialCoverageObservation`:

- Treat it as `asset_manager_observation_only`.
- Use `missingIngredients` and `potentialImpact` to help SlotMatcher/GapRepairPlanner decide what the actual gap and repair should be.
- Do not treat it as the final gap object.

## Legacy Route

`POST /api/assets/manager/video-agent-bundle` remains as a route alias while teammates migrate.

Response:

```json
{
  "assetSupplyContext": {},
  "warnings": [],
  "deprecatedRoute": true,
  "message": "Legacy route name; response uses asset-supply-v1."
}
```

It no longer returns `fallbackCards` or Asset Manager-owned repair strategy.

## SlotMatcher / GapRepairPlanner Contract

SlotMatcher should:

- consume normalized `AssetCard.analysis`
- optionally consume `ContextualSlotCoverage`
- decide matched / partial / missing
- produce alignment reason and `assetEvidence`

GapRepairPlanner should:

- consume final `MaterialGap`
- consume `MaterialCoverageObservation` as supporting evidence
- choose repair strategy and shoot/spec/card guidance
- own any title card, benefit card, CTA card, crop/reuse, AIGC, or shoot-request strategy

## Safety and Honesty

- Deterministic Asset Manager is the stable path.
- Optional VLM enrichment is disabled by default.
- Do not claim complete video understanding.
- Do not claim SAM2, GroundingDINO, SigLIP2, VideoRAG, or full long-video temporal grounding as implemented.
- Do not claim real CTR, real conversion, or real user behavior.
- Do not claim GPT Image, Seedance, or external generation has produced media unless a separate adapter really did so.

## Review Checklist

- [ ] Response uses `protocolVersion: "asset-supply-v1"`.
- [ ] Weak/insufficient coverage is represented by `ContextualSlotCoverage` and `MaterialCoverageObservation`.
- [ ] No canonical Asset Manager response contains `fallbackCards`.
- [ ] No canonical Asset Manager response contains Asset Manager-owned `suggestedRepair`.
- [ ] Old `AssetCard` without `analysis` still works.
- [ ] Video Agent remains responsible for fallback rendering and timeline-to-video decisions.
