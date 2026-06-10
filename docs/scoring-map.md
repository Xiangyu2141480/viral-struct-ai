# Scoring Map / 评分点映射

This file maps the competition scoring criteria to concrete code, pages and demo evidence. It intentionally does not claim unfinished Remotion/MP4 export as a completed feature.

## 1. Scoring Table

| Competition requirement | Current implementation | Demo page | Evidence | Status |
|---|---|---|---|---|
| 样例输入与基础解析 | Seed/upload video parsing, metadata, cover/keyframes, transcript fallback | 01 样例解析, 一键演示 | `VideoAnalysis`, frame/cover media, seed list | Complete for demo and standard basics |
| 多条样例或更完整分析 | Seed videos and checked-in macbook_neo artifacts | 01 样例解析, 一键演示 | `seed_assets/analysis/macbook_neo/structure_graph.json` | Partially complete |
| 脚本/段落结构 | `ViralStructureGraph.segments` | 01 样例解析, 一键演示, 04 成片编译 | segment roles: hook/selling_point/cta/etc. | Complete |
| 节奏结构 | rough/fine scan artifacts, boundaries, rhythm fields, transition fidelity | 01 样例解析, 一键演示, 04 成片编译 | `boundaries`, `rhythm`, `QualityReport.transitionFidelity` | Complete for demo |
| 包装结构 | packaging protocol and timeline packaging | 01 样例解析, 03 缺口诊断, 04 成片编译 | caption density, card type, transition, motion | Complete |
| 新内容与素材输入 | product brief and AssetCard library | 02 素材输入, 一键演示 | `ContentBrief`, `AssetCard[]` | Complete for demo/standard flow |
| 素材是否足够 | slot matching and material gaps | 03 缺口诊断, 一键演示 | `SlotMatch`, `MaterialGap` | Complete |
| 结构迁移生成 | script, storyboard, timeline | 04 成片编译, 一键演示 | `ScriptSegment[]`, `StoryboardShot[]`, `TimelineItem[]` | Complete |
| 素材缺口识别 | missing slot and ingredient reasoning | 03 缺口诊断, 04 成片编译, 一键演示 | gap type, reason, impact | Complete |
| 素材缺口补全 | repair planner | 03 缺口诊断, 04 成片编译, 一键演示 | `GapRepair`, repair strategy/spec | Complete |
| 迁移过程可视化 | Generation Trace + Migration Evidence | 04 成片编译, 一键演示 | source structure -> mapping -> asset/gap -> repair -> final timeline | Complete |
| 结果可验证 | Web visual preview, timeline list, quality report | 04 成片编译, 一键演示 | preview + timeline + quality metrics | Complete as Web preview; no MP4 claim |
| 画面包装能力 | subtitle style, title/selling/CTA cards, transitions, motions | 04 成片编译 | Timeline packaging and Variant Diff | Complete |
| 转场结构迁移 | Transition Grammar turns source motion logic into category-native transition recipes | evidence panel, docs/manual output | `TransitionRecipe`, `CategoryPresetRegistry`, beverage demo recipes | Complete as plan-only handoff |
| 声音结构迁移 | Sonic Grammar plans music bed, silence, impact, foley, CTA and logo cues | evidence panel, docs/manual output | `AudioTrackPlan`, `AudioCue`, `BeatSyncMap`, `AudioGenerationJobCard` | Complete as plan-only handoff |
| 多版本生成 | high_click, high_conversion, premium | 04 成片编译 | Variant Diff and changed timeline/script/packaging | Complete |
| 真实素材适配 | Asset Manager backend contract: deterministic analysis, keyframes, quality scoring, slot affordance, contextual coverage, Asset Evidence, and scenario-aware material supply | 02 素材输入, 03 缺口诊断, 04 成片编译 data layer | `AssetAnalysisProfile`, `AssetLibraryReport`, `SlotCoverageMatrix`, `AssetSupplyContext`, `SlotMatch.assetEvidence`, `MaterialScenarioProfile` | Backend/data complete; UI handoff pending |
| 素材极少时的补全路径 | Single-image-only scenario keeps evidence coverage honest while producing manual shoot, AIGC prompt, and HyperFrames input briefs | API/docs/manual script | `MissingMaterialBrief`, `ManualShootBrief`, `AigcGenerationBrief`, `HyperframesFallbackBrief` | Backend/data complete; no external generation claim |
| AIGC 补全可扩展性 | AIGC-ready scenario marks generated/planned assets as proposed and provides prompt-ready briefs | API/docs/manual script | `materialScenario.scenarioType=aigc_ready`, `aigcGenerationBrief.safetyNotes` | Proposal/input layer complete; no real Gemini/Seedance call |
| 人工可调 | natural-language edit patch | 04 成片编译 | `/api/timeline/apply-edit`, Edit Summary | Complete as rule-based patch |
| 自然语言编辑加分 | five supported edit intents | 04 成片编译 | changed items before/after | Partial add-on, rule-based |
| 创意与产品完成度 | cohesive product flow and explainable UI | 单页全流程（路由 `/`） | standard workflow + 一键演示 | Complete for prototype |

## 2. Strongest Demo Evidence

Show these in the recording:

1. 一键演示: one-click end-to-end evidence chain.
2. 04 成片编译: Generation Trace showing source/fallback transparency.
3. 04 成片编译: Migration Evidence showing the actual structure transfer.
4. 04 成片编译: Variant Diff showing high_click / high_conversion / premium differences.
5. 04 成片编译: Natural-language edit patch with Edit Summary and changed items.
6. 03 缺口诊断: slot matching and repair source badges.
7. API/docs: Asset Manager coverage matrix and Asset Evidence show why assets cover or miss source slots.
8. API/docs/manual script: Asset Manager scenario comparison shows single image only, partial real footage, and AIGC-ready handoff briefs.
9. Evidence panel/docs/manual script: Transition / Sonic Grammar shows visual grammar, transition plan, audio cue plan, missing transition assets, and warnings.

## 3. Recommended Scoring Narrative

```txt
We do not only generate a final script.
We expose the whole migration process:
sample pattern -> transferable intent -> new product mapping -> asset coverage -> material gap -> repair -> final timeline.
We also separate the sample into visual grammar, transition grammar, and sonic grammar, so judges can see how motion and sound support the migrated structure without claiming rendered external generation.
```

## 4. Known Scoring Limits

| Area | Current limitation | How to present |
|---|---|---|
| MP4 export | Not a stable completed feature | Present Web preview and timeline protocol |
| ASR | Not required in the main demo path | Mention manual transcript/artifact fallback |
| Full editor | No drag-and-drop editor | Present natural-language patch and generated timeline |
| Asset Manager UI | Backend/data contract is ready, but new visual panels are owned by UI teammate | Present docs/examples and current 02 素材输入 flow; do not claim the new inspector UI is implemented |
| VLM asset understanding | Optional adapter only; deterministic analyzer is the main path | Present Asset Manager protocol, fallback, and `analysis.vlm` as optional |
| Advanced vision stack | SAM2/GroundingDINO/SigLIP2/VideoRAG are not integrated | Mention as future enhancement only |
| Long-video temporal grounding | Full temporal grounding is not completed | Use checked-in structure artifacts and deterministic/keyframe evidence |
| AIGC video generation | Not a main capability | Present packaging/text/material repair instead |
| AIGC-ready Asset Manager briefs | Prompt/input layer only | Say these are handoff briefs for external adapters, not generated media |
| Transition/Sonic Grammar | Plan-only/job-card-only | Say it is a renderer/external-adapter handoff, not proof of mixed audio or generated video |
| Offline diagnostics | Heuristic only | Never present them as fake CTR, conversion, or real user behavior |

## 5. Demo Case

```txt
Source: macbook_neo structure artifacts
Target: 康师傅冰红茶
Material gaps: usage shot, comparison shot, CTA end-card
Repair: packaging cards, caption rewrite, asset reuse/crop suggestions
Transition/Sonic: keyboard-rain logic is sanitized into beverage-native ice cube rain, heatwave shatter, cap pop, cold mist, CTA lock-up and plan-only audio cues.
```

This case is suitable because it makes the material gap and repair logic visible.
