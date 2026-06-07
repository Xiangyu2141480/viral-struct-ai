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

Asset Manager now also exposes scenario-level handoff fields that these pages may display when useful:

- `assetSupplyContext.materialScenario`
- `assetSupplyContext.missingMaterialBriefs`

These fields support judge-facing scenarios such as single product image only, partial real footage, and AIGC-ready prompt planning. They are handoff inputs only, not final repair decisions.

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

Versioning:

- `protocolVersion` is `asset-supply-v1`.
- New fields should be additive and optional where possible.
- UI should tolerate missing optional fields and display `warnings`.

Response:

```json
{
  "assetSupplyContext": "<AssetSupplyContext>",
  "warnings": []
}
```

Sample: `docs/examples/asset-supply-context.sample.json`

Scenario samples:

- `docs/examples/scenario-single-image-only.sample.json`
- `docs/examples/scenario-partial-real-footage.sample.json`
- `docs/examples/scenario-aigc-ready.sample.json`

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
| material scenario | `assetSupplyContext.materialScenario.scenarioType` |
| evidence coverage | `materialScenario.evidenceCoverageScore` |
| completion feasibility | `materialScenario.completionFeasibilityScore` |
| recommended downstream mode | `materialScenario.recommendedDownstreamMode` |

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
| missing material brief | `assetSupplyContext.missingMaterialBriefs[]` joined by `affectedSlotId` |
| manual shoot input | `missingMaterialBriefs[].manualShootBrief` |
| AIGC prompt input | `missingMaterialBriefs[].aigcGenerationBrief` |
| HyperFrames input | `missingMaterialBriefs[].hyperframesBrief` |

Use `/api/slots/match` and `/api/gaps/repair` as the final sources of `SlotMatch`, `MaterialGap`, and `GapRepair`. Asset Manager rows are supporting material-supply evidence.

Backend helpers for downstream data joins:

- `getCoverageForSlot(assetSupplyContext, slotId)`
- `getBestCandidatesForSlot(assetSupplyContext, slotId)`
- `getObservationsForSlot(assetSupplyContext, slotId)`
- `getMissingIngredientsForSlot(assetSupplyContext, slotId)`
- `summarizeCoverageForSlot(assetSupplyContext, slotId)`

These helpers are pure functions and return evidence only. UI should not present their result as final repair strategy.

## 6. Field Mapping for `/result` Migration Evidence

| Evidence field | Source field |
| --- | --- |
| asset quality | `SlotMatch.assetEvidence.qualityScore`, fallback to `asset.analysis.quality.overallScore` |
| top affordance | `SlotMatch.assetEvidence.topAffordanceRole`, fallback to `asset.analysis.roleAffordance[0]` |
| keyframe evidence | `SlotMatch.assetEvidence.keyframeIds`, fallback to `asset.analysis.media.keyframes[].id` |
| match reason | `SlotMatch.assetEvidence.reasons`, fallback to `SlotMatch.reason` |
| weak/missing reason | `MaterialGap.reason`, or matching `MaterialCoverageObservation.evidence` |
| repair explanation | `GapRepair.explanation` and `GapRepair.gapSpec`, not Asset Manager |
| completion input brief | `assetSupplyContext.missingMaterialBriefs[]` joined by `affectedSlotId` |
| channel eligibility | `missingMaterialBriefs[].channelEligibility[]` |

Sample: `docs/examples/asset-evidence-sample.json`

## 6.1 Scenario Handoff Fields

`MaterialScenarioProfile` explains what kind of material-supply situation the user is in:

- `empty_assets`
- `single_image_only`
- `partial_real_footage`
- `aigc_ready`
- `mixed_real_and_aigc`

`evidenceCoverageScore` means how much the current assets directly cover the source structure. `completionFeasibilityScore` means how feasible completion is after downstream actions such as crop/zoom reuse, manual reshoot, prompt-based external generation, or HyperFrames-style card animation.

`MissingMaterialBrief` is not a repair strategy. It gives downstream modules structured input:

- `manualShootBrief`: what a normal user should reshoot.
- `aigcGenerationBrief`: prompt brief for an external adapter such as Gemini/Seedance-like generation, without calling that adapter.
- `hyperframesBrief`: card-animation input for a renderer, without rendering.
- `channelEligibility`: which downstream owner could consume the brief.

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
| scenario | “素材场景：单图 / 部分实拍 / AIGC-ready” |
| evidence coverage | “直接素材覆盖率：当前素材能直接支撑多少样例槽位” |
| completion feasibility | “补全可行性：结合补拍、AIGC prompt 和卡片动画后的可完成程度” |
| missing material brief | “补全输入简报：给补拍、外部生成或渲染模块的输入，不是最终补全策略” |

## 8. Do Not Overclaim

- Deterministic analyzer is the main path.
- Optional VLM is not required for the main demo.
- `analysis.vlm` is optional model evidence, not proof of real product claims.
- Do not claim complete video understanding.
- Do not call Asset Manager output a full video understanding system.
- Do not claim SAM2, GroundingDINO, SigLIP2, VideoRAG, or full long-video temporal grounding as implemented.
- Do not claim real user data or real CTR.
- Do not claim all missing assets are generated.
- Asset Manager does not render fallback cards or choose repair strategy.
- `MissingMaterialBrief` is a handoff input, not a final `GapRepair`.
- `AigcGenerationBrief` is prompt-ready only; it does not mean Gemini, Seedance, or another model generated media.
- `HyperframesFallbackBrief` is renderer input only; Asset Manager does not render HyperFrames output.

Defense wording:

> Asset Manager does not decide how to repair the gap. It explains why the asset supply is insufficient for a structural slot: which ingredient is missing, which segment is affected, which candidate assets are weak, and what impact this has on hook strength, product clarity, usage proof, CTA clarity, or packaging risk. SlotMatcher and GapRepairPlanner then use this evidence to make final matching and repair decisions.

> Asset Manager 不决定怎么补缺口。它只解释为什么当前素材供给不足以支撑某个结构槽位：缺了哪个素材要素、影响哪个段落、哪些候选素材只是弱覆盖，以及这会怎样影响开头吸引力、商品清晰度、使用证明、CTA 清晰度或包装风险。最终的匹配和补全策略仍由 SlotMatcher 与 GapRepairPlanner 决定。

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
- [ ] Scenario fields displayed with honest labels: “handoff brief”, “prompt-ready”, “not rendered output”.
- [ ] Single-image-only scenario shows low evidence coverage but higher completion feasibility.
- [ ] Partial-real-footage scenario keeps weak/insufficient observations visible.
- [ ] AIGC-ready scenario never claims generated media exists unless an external adapter supplies it.
