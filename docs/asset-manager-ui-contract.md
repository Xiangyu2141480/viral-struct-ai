# Asset Manager UI Contract

## 1. Purpose

Asset Manager gives UI and downstream services deterministic material-supply evidence. It normalizes `AssetCard` data, adds `AssetAnalysisProfile`, scores slot affordance, computes contextual coverage, and reports material coverage observations.

It does not own final matching, final gap creation, repair strategy, fallback card rendering, timeline composition, or MP4 rendering.

## 2. Pages That May Consume This Data

| Page | Data to consume | Intended use |
| --- | --- | --- |
| `/adapt` | `AssetCard.analysis`, `AssetLibraryReport`, `ContextualAssetCoverageReport` | Show asset count, quality, affordance, warnings, weak/missing roles. |
| `/gaps` | `ContextualSlotCoverage`, `MaterialCoverageObservation`, `SlotAssetCandidate` | Explain why material supply is covered, weak, or insufficient before final gap repair. |
| `/result` | `SlotMatch.assetEvidence`, optional `ContextualSlotCoverage` join | Enrich migration evidence with quality, keyframes, affordance, and weak/missing reasons. |

## 3. API Endpoints

### POST `/api/assets/manager/analyze-batch`

Use when UI has assets but no structure graph yet.

Request:

```json
{
  "assetCards": ["<AssetCard>"],
  "contentBrief": "<ContentBrief optional>",
  "libraryId": "kangshifu_demo"
}
```

Response:

```json
{
  "assetCards": ["<normalized AssetCard>"],
  "report": "<AssetLibraryReport>",
  "warnings": [],
  "source": "deterministic_asset_manager",
  "protocolVersion": "asset-manager-v1"
}
```

Loading state: “Analyzing assets locally…”

Empty state: “Upload images/videos or load a demo library to start asset analysis.”

Fallback behavior: old `AssetCard` objects without `analysis` are normalized deterministically.

### POST `/api/assets/manager/coverage`

Use when UI has a structure graph and wants both legacy matrix fields and new contextual coverage.

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
  "matrix": "<SlotCoverageMatrix>",
  "report": "<AssetLibraryReport>",
  "assetCards": ["<normalized AssetCard>"],
  "contextualCoverage": "<ContextualAssetCoverageReport>",
  "assetSupplyContext": "<AssetSupplyContext>",
  "warnings": []
}
```

Loading state: “Calculating material coverage…”

Empty state: show “No assets loaded” if `assetCards.length === 0`; show “No structure slots available” if `matrix.totalSlotCount === 0`.

Fallback behavior: if `structureGraph.shotSlots` is missing or empty, coverage falls back to role-level rows.

### POST `/api/assets/manager/asset-supply-context`

Canonical handoff for UI teammates, SlotMatcher, GapRepairPlanner, and future Video Agent work.

Response:

```json
{
  "assetSupplyContext": "<AssetSupplyContext>",
  "warnings": []
}
```

Sample: `docs/examples/asset-supply-context.sample.json`

### POST `/api/assets/manager/video-agent-bundle`

Legacy alias only. New UI should not depend on this name.

Response:

```json
{
  "assetSupplyContext": "<AssetSupplyContext>",
  "warnings": [],
  "deprecatedRoute": true
}
```

### POST `/api/assets/manager/search`

Not implemented. UI should filter returned `assetCards` client-side for now.

## 4. Field Mapping for `/adapt`

| UI field | Source field |
| --- | --- |
| asset count | `assetSupplyContext.libraryProfile.assetCount` or `assetCards.length` |
| media type counts | `libraryProfile.byType` |
| average quality | `libraryProfile.avgQualityScore` |
| weak roles | `libraryProfile.weakRoles` |
| missing roles | `libraryProfile.missingRoles` |
| coverage score | `contextualCoverage.coverageSummary.coverageScore` |
| per-asset top affordances | `asset.analysis.roleAffordance.slice(0, 3)` |
| thumbnail | `asset.url`, else `asset.analysis.media.keyframes[0].url`, else placeholder |
| keyframes | `asset.analysis.media.keyframes` |
| warnings | `asset.analysis.warnings`, `libraryProfile.warnings`, response `warnings` |
| optional VLM caption | `asset.analysis.vlm.shortCaption` when present |

## 5. Field Mapping for `/gaps`

| UI field | Source field |
| --- | --- |
| slot coverage status | `contextualCoverage.slotCoverages[].coverageStatus` |
| slot role | `slotCoverages[].slotRole` |
| affected segment | `slotCoverages[].affectedSegmentId` |
| candidate assets | `slotCoverages[].candidateAssets` |
| why weak/insufficient | `slotCoverages[].limitations`, `observations[].evidence` |
| missing ingredients | `slotCoverages[].missingIngredients`, `observations[].missingIngredients` |
| weak ingredients | `slotCoverages[].weakIngredients`, `observations[].availableButWeakIngredients` |
| potential impact | `observations[].potentialImpact` |
| asset evidence | `candidateAssets[].evidence` |

Use `/api/slots/match` and `/api/gaps/repair` as the final sources of `SlotMatch`, `MaterialGap`, and `GapRepair`. Asset Manager rows are supporting material-supply evidence.

## 6. Field Mapping for `/result` Migration Evidence

| Evidence field | Source field |
| --- | --- |
| asset quality | `SlotMatch.assetEvidence.qualityScore`, fallback to `asset.analysis.quality.overallScore` |
| top affordance | `SlotMatch.assetEvidence.topAffordanceRole`, fallback to `asset.analysis.roleAffordance[0]` |
| keyframe evidence | `SlotMatch.assetEvidence.keyframeIds`, fallback to `asset.analysis.media.keyframes[].id` |
| match reason | `SlotMatch.assetEvidence.reasons`, fallback to `SlotMatch.reason` |
| weak/missing reason | `MaterialGap.reason`, or matching `MaterialCoverageObservation.evidence` |
| repair explanation | `GapRepair.explanation` and `GapRepair.gapSpec`, not Asset Manager |

Sample: `docs/examples/asset-evidence-sample.json`

## 7. Recommended UI Copy

| Concept | Recommended copy |
| --- | --- |
| 素材覆盖率 | “素材覆盖率 / Material coverage” |
| 弱覆盖 | “弱覆盖：可用但不足以单独支撑该结构槽位” |
| 覆盖不足 | “覆盖不足：当前素材缺少关键视觉/动作/文案要素” |
| 素材证据 | “素材证据：质量、关键帧和角色适配来自本地确定性分析” |
| 质量分 | “质量分 / Quality score” |
| 适配度 | “角色适配度 / Role fit” |
| fallback | “Fallback safe：缺少模型或 ffmpeg 时仍返回可解释结果” |
| optional VLM | “可选视觉模型增强：非主 demo 依赖，失败会回退到本地确定性分析” |

## 8. Do Not Overclaim

- Deterministic analyzer is the main path.
- Optional VLM is not required for the main demo.
- `analysis.vlm` is optional model evidence, not proof of real product claims.
- Do not claim complete video understanding.
- Do not claim SAM2, GroundingDINO, SigLIP2, VideoRAG, or full long-video temporal grounding as implemented.
- Do not claim real user data or real CTR.
- Do not claim all missing assets are generated.
- Asset Manager does not render fallback cards or choose repair strategy.

## 9. Integration Checklist

- [ ] Loading state while coverage or supply-context request runs.
- [ ] Empty state for zero assets.
- [ ] Partial data state for old `AssetCard` without `analysis`.
- [ ] Missing keyframes state for images/text or failed ffmpeg.
- [ ] No ffmpeg state: show warnings, do not blank the page.
- [ ] No VLM key state: label deterministic analysis, do not show “AI vision complete”.
- [ ] Optional VLM enabled state: show `analysis.vlm.risks` and keep deterministic fallback labels.
- [ ] Warnings display at asset, report, and contextual coverage levels.
- [ ] Join coverage rows by `slotId`.
- [ ] Join asset evidence by `assetId`.
- [ ] Keep `/api/slots/match` and `/api/gaps/repair` as final gap pipeline.
- [ ] Do not hide weak or insufficient status.
