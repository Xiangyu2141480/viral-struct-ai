# Architecture / 整体 AI 架构

## 1. Project Shape

Viral Struct AI 是一个结构迁移型 AI 创作平台。系统把样例视频拆成结构协议，再把结构迁移到新商品和用户素材，输出脚本、分镜、timeline、包装建议和 Web 视觉预览。

```txt
apps/web          Next.js 产品界面和演示页面
apps/api          Express API、规则引擎、LLM fallback services
packages/shared   TypeScript 类型和 Zod schema
packages/remotion-video
                  Remotion 包骨架，本阶段不是主交付能力
scripts           Python rough/fine scan、视频分析、artifact 生成工具
seed_assets       样例视频、分析 artifact、demo 素材库
```

## 2. End-To-End Flow

```txt
Sample video / seed artifact
  -> VideoAnalysis
  -> ViralStructureGraph
  -> ContentBrief + AssetCard[]
  -> SlotMatch[] + MaterialGap[]
  -> GapRepair[]
  -> ScriptSegment[] + StoryboardShot[] + TimelineItem[]
  -> Variant Diff + Natural Language Edit Patch
  -> QualityReport
  -> Web visual preview and explainability panels
```

## 3. Frontend

Key pages:

| Page | Main component | Purpose |
|---|---|---|
| `/demo` | `DemoShowcasePanel` | Main review demo: one-click structure migration showcase |
| `/analyze` | `VideoAnalysisPanel` | Seed/upload video parsing and metadata display |
| `/graph` | structure graph page | Structure extraction and graph artifact display |
| `/adapt` | adapt page | Product brief and AssetCard library input |
| `/gaps` | `GapBoard` | Slot matching, material gaps, repairs, source badges |
| `/result` | `TimelineView` | Timeline, visual preview, trace, migration evidence, variants, natural language edit |

Frontend state is centralized in `apps/web/lib/workflowStore.ts`. The store keeps:

- `videoAnalysis`
- `structureGraph`
- `contentBrief`
- `assetCards`
- `slotMatches`
- `materialGaps`
- `repairs`
- `script`
- `storyboard`
- `timeline`
- `qualityReport`
- `pipelineTrace`
- `timelineEditSummary`

## 4. API Routes

| Route | Service path | Behavior |
|---|---|---|
| `/api/videos/*` | `videoAnalyzer`, `videoPaths` | seed/upload parsing, ffprobe metadata, cover/keyframes |
| `/api/structure/extract` | `structureExtractor` | artifact-first structure graph extraction with fallback |
| `/api/assets/*` | `assetAnalyzer`, `demoAssetLibrary` | AssetCard analysis and static library loading |
| `/api/slots/match` | `slotMatcher` | `matchSlotsWithFallback` |
| `/api/gaps/repair` | `gapRepairPlanner` | `planGapRepairsWithFallback` |
| `/api/timeline/generate` | `timelineGenerator` | `generateTimelineWithFallback` |
| `/api/timeline/apply-edit` | `timelineEditPlanner` | deterministic natural-language timeline patch |
| `/api/quality/evaluate` | `qualityEvaluator` | scoring and transition fidelity |
| `/api/demo/run` | `demo` route | stable review demo chain |

## 5. Python Video Analysis

Python scripts under `scripts/` support the richer video analysis artifacts:

- media technical extraction
- audio beat maps
- rough scan
- fine scan
- boundary micro scan
- structure graph assembly

The standard Web demo can run without making live model calls because checked-in artifacts and deterministic fallback paths are available. When artifacts are missing or model calls fail, the API falls back to rule/template behavior and reports warnings.

## 6. Core Protocols

### `VideoAnalysis`

Basic video metadata, shots, keyframes, transcript, source and warnings.

### `ViralStructureGraph`

The central migration protocol. It contains:

- `segments`: hook / pain point / selling point / proof / usage / comparison / CTA
- `shotSlots`: required asset shape and transfer constraints
- `rhythm`: shot duration and cut frequency
- `packaging`: subtitle density, title/card/transition style
- `creativeIngredients`: transferable creative elements
- `boundaries`: transition semantics from boundary scan

### `ShotSlot`

Each target slot says what kind of visual evidence is needed and, in v1, may include:

- `intent`: transferable purpose and motion/composition intent
- `sourceInstance`: what the source video did
- `acceptanceCriteria`: acceptable replacements for the new product

### `AssetCard`

Structured understanding of user or demo assets:

- type, text/url
- detected objects
- suitable slots
- quality score
- visual content
- motion potential
- creative ingredients

### `SlotMatch`

Maps each `ShotSlot` to an `AssetCard` with matched / partial / missing status, score, reason, source and optional treatment spec.

### `MaterialGap`

Explains missing visual or ingredient requirements, severity, reason and impact.

### `GapRepair`

Proposes repair strategies such as caption rewrite, title card, selling point card, CTA card, crop zoom, reuse asset or shoot suggestion.

### `TimelineItem`

Renderable/editable timeline draft with:

- timing
- source segment and slot
- asset or repair
- script
- subtitles
- visual action
- packaging
- script source

### `QualityReport`

Measures structure match, slot coverage, visual-script alignment, factuality, coherence, subtitle readability and optional transition fidelity.

### `PipelineTrace`

Frontend trace object for judging evidence:

- `alignmentSource`
- `gapSpecSource`
- `scriptSource`
- `warnings`

### `MigrationEvidence`

Frontend-built evidence rows joining:

```txt
Source Structure -> New Mapping -> Asset / Gap -> Repair -> Final Timeline
```

## 7. Fallback Architecture

Every model-adjacent service follows the same rule:

```txt
Try LLM enhanced path
  -> if missing key, network error, invalid output, or rejected schema
  -> deterministic fallback
  -> return source + warning
```

Current fallback paths:

- slot matching: rule-based `matchSlots`
- gap repair: rule-based `planGapRepairs`
- timeline generation: template `generateTimelineMock`
- natural language edit: deterministic `applyTimelineEdit`
- video analysis: mock fallback where real media parsing fails

## 8. Current Limits

- Remotion is not the main delivery surface in this checkpoint.
- Real MP4 export is not implemented as a stable user-facing feature.
- ASR is not the main standard-flow dependency; manual transcript and artifacts remain important fallbacks.
- Natural language editing is a rule-based timeline patch system, not a full intelligent video editor.
- Asset understanding is lightweight and demo-oriented, not a full VLM asset management product.
