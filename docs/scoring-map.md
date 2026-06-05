# Scoring Map / 评分点映射

This file maps the competition scoring criteria to concrete code, pages and demo evidence. It intentionally does not claim unfinished Remotion/MP4 export as a completed feature.

## 1. Scoring Table

| Competition requirement | Current implementation | Demo page | Evidence | Status |
|---|---|---|---|---|
| 样例输入与基础解析 | Seed/upload video parsing, metadata, cover/keyframes, transcript fallback | `/analyze`, `/demo` | `VideoAnalysis`, frame/cover media, seed list | Complete for demo and standard basics |
| 多条样例或更完整分析 | Seed videos and checked-in macbook_neo artifacts | `/analyze`, `/graph`, `/demo` | `seed_assets/analysis/macbook_neo/structure_graph.json` | Partially complete |
| 脚本/段落结构 | `ViralStructureGraph.segments` | `/graph`, `/demo`, `/result` | segment roles: hook/selling_point/cta/etc. | Complete |
| 节奏结构 | rough/fine scan artifacts, boundaries, rhythm fields, transition fidelity | `/graph`, `/demo`, `/result` | `boundaries`, `rhythm`, `QualityReport.transitionFidelity` | Complete for demo |
| 包装结构 | packaging protocol and timeline packaging | `/graph`, `/gaps`, `/result` | caption density, card type, transition, motion | Complete |
| 新内容与素材输入 | product brief and AssetCard library | `/adapt`, `/demo` | `ContentBrief`, `AssetCard[]` | Complete for demo/standard flow |
| 素材是否足够 | slot matching and material gaps | `/gaps`, `/demo` | `SlotMatch`, `MaterialGap` | Complete |
| 结构迁移生成 | script, storyboard, timeline | `/result`, `/demo` | `ScriptSegment[]`, `StoryboardShot[]`, `TimelineItem[]` | Complete |
| 素材缺口识别 | missing slot and ingredient reasoning | `/gaps`, `/result`, `/demo` | gap type, reason, impact | Complete |
| 素材缺口补全 | repair planner | `/gaps`, `/result`, `/demo` | `GapRepair`, repair strategy/spec | Complete |
| 迁移过程可视化 | Generation Trace + Migration Evidence | `/result`, `/demo` | source structure -> mapping -> asset/gap -> repair -> final timeline | Complete |
| 结果可验证 | Web visual preview, timeline list, quality report | `/result`, `/demo` | preview + timeline + quality metrics | Complete as Web preview; no MP4 claim |
| 画面包装能力 | subtitle style, title/selling/CTA cards, transitions, motions | `/result` | Timeline packaging and Variant Diff | Complete |
| 多版本生成 | high_click, high_conversion, premium | `/result` | Variant Diff and changed timeline/script/packaging | Complete |
| 真实素材适配 | AssetCard library and lightweight analyzer | `/adapt`, `/gaps` | `AssetCard`, suitable slots, detected objects | Partially complete |
| 人工可调 | natural-language edit patch | `/result` | `/api/timeline/apply-edit`, Edit Summary | Complete as rule-based patch |
| 自然语言编辑加分 | five supported edit intents | `/result` | changed items before/after | Partial add-on, rule-based |
| 创意与产品完成度 | cohesive product flow and explainable UI | all pages | standard workflow + `/demo` | Complete for prototype |

## 2. Strongest Demo Evidence

Show these in the recording:

1. `/demo`: one-click end-to-end evidence chain.
2. `/result`: Generation Trace showing source/fallback transparency.
3. `/result`: Migration Evidence showing the actual structure transfer.
4. `/result`: Variant Diff showing high_click / high_conversion / premium differences.
5. `/result`: Natural-language edit patch with Edit Summary and changed items.
6. `/gaps`: slot matching and repair source badges.

## 3. Recommended Scoring Narrative

```txt
We do not only generate a final script.
We expose the whole migration process:
sample pattern -> transferable intent -> new product mapping -> asset coverage -> material gap -> repair -> final timeline.
```

## 4. Known Scoring Limits

| Area | Current limitation | How to present |
|---|---|---|
| MP4 export | Not a stable completed feature | Present Web preview and timeline protocol |
| ASR | Not required in the main demo path | Mention manual transcript/artifact fallback |
| Full editor | No drag-and-drop editor | Present natural-language patch and generated timeline |
| VLM asset understanding | Lightweight and demo-oriented | Present AssetCard protocol and fallback |
| AIGC video generation | Not a main capability | Present packaging/text/material repair instead |

## 5. Demo Case

```txt
Source: macbook_neo structure artifacts
Target: 康师傅冰红茶
Material gaps: usage shot, comparison shot, CTA end-card
Repair: packaging cards, caption rewrite, asset reuse/crop suggestions
```

This case is suitable because it makes the material gap and repair logic visible.
