# Asset Manager Champion Iteration Report

## 1. PR Branch and Scope

- Branch: `feat/explainable-migration-demo-pipeline`
- Base checked against: latest `origin/main`
- PR scope: Asset Manager backend/data contract hardening for normalized assets, deterministic analysis profiles, role affordance, coverage matrix, asset supply context, UI handoff docs, sample JSON, and tests.
- Explicit non-scope: no React UI panels, no timeline generation ownership, no GapRepair strategy ownership, no MP4/Remotion ownership, and no external model dependency as the main demo path.

## 2. What Was Optimized

- Strengthened `AssetSupplyContext` so downstream agents receive candidate asset supply, missing ingredients, weak ingredients, constraints, potential impact, and evidence without treating those observations as final repairs.
- Added legacy-normalization warnings so old `AssetCard` records are visibly deterministic/fallback-normalized instead of silently treated as fully analyzed assets.
- Added helper APIs for downstream code to read slot-level coverage, candidates, observations, and missing ingredients without duplicating traversal logic.
- Expanded docs to make ownership boundaries explicit for UI and Video Agent teammates.

## 3. Responsibility Boundary

Asset Manager owns:

- Normalized `AssetCard.analysis`
- Deterministic quality/semantic/media/keyframe profiles
- Role affordance priors
- Coverage matrix and contextual coverage observations
- Candidate asset supply and constraints
- Missing/weak ingredient evidence

Asset Manager does not own:

- Final `SlotMatch` decisions
- Final `MaterialGap` decisions
- `GapRepair` strategy
- fallback cards
- timeline generation
- MP4 export
- visual UI implementation

## 4. Protocol Changes

- `AssetSupplyContext` remains versioned as `asset-supply-v1`.
- New consumers must treat unknown future fields as optional and tolerate missing fields.
- `coverageStatus` meanings are clarified:
  - `covered`: usable candidate evidence exists.
  - `weak`: some candidate evidence exists but requires downstream planning.
  - `insufficient`: required ingredient evidence is missing or unsafe to treat as a full shot.
- `observations` are evidence-only and use ownership marker `asset_manager_observation_only`.

## 5. Algorithm Improvements

- Candidate ranking now combines role affordance, quality, media readiness, semantic fit, editability, and safety.
- Candidate assets are ranked from all coverage row candidates, then capped, instead of only mirroring the best coverage row.
- Required ingredients are now role-aware:
  - opening hook: text-safe area, aspect ratio, short duration, packaging surface
  - product closeup: product evidence, label/safe area, aspect ratio
  - usage demo: usage evidence, motion, duration
  - comparison: comparison evidence and text-safe/packaging support
  - benefit proof: product/benefit surface evidence
  - CTA: CTA surface, product evidence, text-safe area, duration
  - cover: product evidence, text-safe area, aspect ratio

## 6. Video Agent Contract

Video Agent should consume:

- `contextualCoverage.slotCoverages[].candidateAssets`
- `candidateAssets[].usableAs`
- `candidateAssets[].constraints`
- `candidateAssets[].mediaReadiness`
- `contextualCoverage.observations`
- `missingIngredients`
- `availableButWeakIngredients`
- `potentialImpact`

Video Agent should not treat Asset Manager observations as final generation strategy. It should pass observations to SlotMatcher, GapRepairPlanner, storyboard planning, or external generation planning as evidence.

## 7. SlotMatcher / GapRepair Handoff

- SlotMatcher can use `AssetCard.analysis.roleAffordance`, `quality`, `semantic`, `warnings`, and `assetEvidence` as stronger priors.
- GapRepairPlanner should consume missing/weak ingredient observations as input evidence only.
- Asset Manager does not emit repair strategy fields such as `fallbackCards` or final `suggestedRepair`.

## 8. Sample JSON

Sample files included:

- `docs/examples/asset-analysis-sample.json`
- `docs/examples/asset-coverage-response.sample.json`
- `docs/examples/asset-evidence-sample.json`
- `docs/examples/asset-manager-error-response.sample.json`
- `docs/examples/asset-supply-context.sample.json`

All sample JSON files were validated with `python -m json.tool`.

## 9. Tests Added / Updated

Added hardening tests for:

- legacy analysis normalization warnings
- richer role-specific required ingredients
- weak/insufficient coverage observations
- candidate constraints and media readiness
- slot-level context helper functions
- evidence-only observation semantics

Key new files:

- `apps/api/src/services/assetSupplyContextBuilder.test.ts`
- `apps/api/src/services/assetSupplyContextUtils.test.ts`
- `apps/api/src/services/assetManager/assetSupplyContextUtils.ts`

## 10. Validation Results

- `pnpm typecheck`: passed
- `pnpm test`: passed
- `pnpm build`: passed
- `python scripts/validate_structure_graph.py seed_assets/analysis/macbook_neo/structure_graph.json`: passed
- `rg --hidden -n "ark-[A-Za-z0-9-]+" .`: no Volcengine API keys found

Note: test logs may include a simulated fine-scan failure path. The command exits successfully and the failure text is part of coverage for fallback behavior.

## 11. UI Scope

No React UI components were modified in this hardening iteration.

UI teammates should read:

- `docs/asset-manager-ui-contract.md`
- `docs/examples/asset-supply-context.sample.json`
- `docs/examples/asset-coverage-response.sample.json`
- `docs/examples/asset-evidence-sample.json`

## 12. Known Limitations

- Deterministic analysis is the stable main path.
- Optional VLM analysis remains disabled by default and is not required for the main demo.
- Asset Manager does not perform full long-video temporal grounding.
- Asset Manager does not provide final repair strategy, final timeline, MP4 output, or UI rendering.

## 13. Suggested PR Description Update

Add this reviewer-facing summary:

```md
### Asset Manager polish / hardening

- Hardens the Asset Supply Context protocol with role-aware required ingredients, candidate constraints, media readiness, and evidence-only observations.
- Adds helper functions for downstream consumers to read slot-level coverage, best candidates, missing ingredients, and observations without duplicating traversal logic.
- Keeps Asset Manager responsibilities bounded: it supplies normalized asset evidence and coverage observations, but does not own final SlotMatch, MaterialGap, GapRepair, fallback cards, timeline, MP4, or UI.
- Adds tests for legacy AssetCard normalization, deterministic warning behavior, role-specific ingredient extraction, weak/insufficient coverage, and helper behavior.
- Updates UI and Video Agent handoff docs with explicit do-not-overclaim guidance.
```
