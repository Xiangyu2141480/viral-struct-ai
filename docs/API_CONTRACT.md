# Frontend–Backend API Contract

> 前端消费的所有 HTTP 接口。后端同学按此实现，类型定义以 `packages/shared/src/types.ts` 为准。

**Base URL：** `http://localhost:4000`（可通过环境变量 `NEXT_PUBLIC_API_BASE` 覆盖）

**通用约定：**
- 除文件上传外，请求体 `Content-Type: application/json`
- 错误时返回非 2xx 状态码，前端统一 throw `Error('API error: <status>')`
- 响应体中的 `warning` / `warnings` 字段前端会收集展示，但不阻断流程
- 媒体资源 URL：以 `/media` 开头的路径前端会自动拼上 `API_BASE`

---

## 类型速查

所有复杂类型均定义于 `packages/shared/src/types.ts`，可直接 import 使用。

| 类型名 | 简述 |
|---|---|
| `VideoAnalysis` | 视频解析结果（元数据、镜头、关键帧、字幕） |
| `ViralStructureGraph` | 病毒结构图谱（segments、shotSlots、edges、boundaries 等） |
| `ContentBrief` | 新商品简报 |
| `AssetCard` | 单个素材分析卡片 |
| `SlotMatch` | 单个槽位匹配结果 |
| `MaterialGap` | 单个素材缺口 |
| `GapRepair` | 单个缺口补全方案 |
| `ScriptSegment` | 脚本段 |
| `StoryboardShot` | 分镜帧（粗） |
| `TimelineItem` | 时间线条目（含包装、修复信息） |
| `QualityReport` | 质量自检报告 |
| `StoryboardFrame` | 分镜帧（含图像 prompt、AI 安全状态） |
| `MissingMaterialGenerationJob` | 缺失素材生成计划任务 |
| `DemoEstimate` | 效果预估报告 |
| `Boundary` | 片段边界（转场类型、强度、微分镜） |

---

## 1. 视频输入与解析

### `GET /api/videos/seeds`

列出服务器端预置的 seed 视频列表。

**Response**
```ts
{
  videos: Array<{
    filename: string;      // 用于后续 analyze 请求
    displayName: string;   // UI 显示名
    sizeBytes: number;
  }>
}
```

---

### `POST /api/videos/seeds/analyze`

对服务器端 seed 视频做解析。

**Request**
```ts
{
  filename: string;          // 对应 seeds 列表中的 filename
  manualTranscript?: string; // 可选手动字幕，用于 fallback
}
```

**Response** → `VideoAnalysis`

```ts
// VideoAnalysis 结构（完整定义见 types.ts）
{
  metadata: VideoMetadata;         // videoId, duration, fps, width, height, aspectRatio
  shots: Shot[];                   // id, start, end, keyframeUrl?, description?
  keyframes: Keyframe[];           // time, url, description?
  transcript: TranscriptSegment[]; // start, end, text
  analysisSource?: 'real_ffmpeg' | 'mock_fallback';
  warnings?: string[];
}
```

---

### `POST /api/videos/upload`

上传本地视频文件，返回服务端分配的 videoId。

**Request** — `multipart/form-data`
| 字段 | 类型 | 说明 |
|---|---|---|
| `video` | File | 视频文件 |

**Response**
```ts
{
  videoId: string;      // 后续 analyze 使用
  originalName: string;
  path: string;         // 服务端存储路径（调试用）
}
```

---

### `POST /api/videos/:videoId/analyze`

对已上传视频做解析。

**Request**
```ts
{
  manualTranscript?: string;
}
```

**Response** → `VideoAnalysis`（同上）

---

## 2. 结构图谱抽取

### `POST /api/structure/extract`

从视频解析结果中抽取可迁移的 Viral Structure Graph。

**Request**
```ts
{
  videoAnalysis: VideoAnalysis;
}
```

**Response**
```ts
{
  structureGraph: ViralStructureGraph;
  debug?: {
    fallbackUsed: boolean;
    extractionSource?: 'rough_fine_scan_artifact' | 'video_analysis_rules' | 'mock_fallback';
    segmentCount: number;
    evidenceCount: number;
    warnings: string[];
  }
}
```

`ViralStructureGraph` 关键字段：

```ts
{
  schemaVersion?: 'v0' | 'v1';
  meta: { duration, aspectRatio, videoType, style };
  structureSummary: string;
  segments: SegmentNode[];       // role: hook|pain_point|selling_point|proof|usage|comparison|cta
  shotSlots: ShotSlotNode[];     // 每个镜头槽位的资产要求
  rhythm: RhythmStructure;
  packaging: PackagingStructure;
  creativeIngredients: CreativeIngredient[];
  edges: GraphEdge[];
  boundaries?: Boundary[];       // 片段边界（转场信息），可选
}
```

---

## 3. 素材输入与分析

### `POST /api/assets/analyze`

上传素材文件（可多个）+ 文字描述，返回 AssetCard 列表。

**Request** — `multipart/form-data`
| 字段 | 类型 | 说明 |
|---|---|---|
| `assets` | File[] | 图片/视频素材，可多个（可为空） |
| `textBrief` | string | 素材文字描述，如「已有瓶身主图，缺少真人口播」 |

**Response**
```ts
{
  assetCards: AssetCard[];
  source?: 'upload_analysis';
}
```

---

### `GET /api/assets/libraries/:libraryId`

读取预置素材库（demo 场景使用 `kangshifu_demo`）。

**Response**
```ts
{
  assetCards: AssetCard[];
  source: 'asset_library';
  libraryId: string;
}
```

`AssetCard` 关键字段：

```ts
{
  id: string;
  type: 'image' | 'video' | 'text';
  url?: string;                          // 媒体 URL，以 /media 开头时前端自动拼 base
  text?: string;                         // type=text 时使用
  detectedObjects: string[];
  suitableSlots: ShotSlotRole[];         // 适配的槽位角色
  qualityScore: number;                  // 0..1
  detectedIngredients?: CreativeIngredientType[];
  humanPresence?: { hasHuman, role?, framing?, actions? };
  analysisSource?: 'static_library' | 'mock_filename_rules' | 'llm_multimodal' | 'manual_text_brief';
  // ...更多字段见 types.ts
}
```

---

## 4. 槽位匹配与缺口识别

### `POST /api/slots/match`

匹配素材到结构槽位，输出匹配结果和缺口列表。

**Request**
```ts
{
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  boundaries?: Boundary[];   // 来自 structureGraph.boundaries
}
```

**Response**
```ts
{
  matches: SlotMatch[];
  gaps: MaterialGap[];
  alignmentSource?: 'llm_judge' | 'rule_based';
  warning?: string;
  warnings?: string[];
}
```

`SlotMatch` 关键字段：
```ts
{
  slotId: string;
  assetId?: string;
  score: number;             // 0..1
  status: 'matched' | 'partial' | 'missing';
  reason: string;
  // ...
}
```

`MaterialGap` 关键字段：
```ts
{
  slotId: string;
  role: ShotSlotRole;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  impact: string;
  gapSpec?: { ideal?, minimalAcceptable?, alternativeIfNoShoot? };
  // ...
}
```

---

### `POST /api/gaps/repair`

为每个素材缺口生成补全方案（修复策略）。

**Request**
```ts
{
  gaps: MaterialGap[];
  assetCards: AssetCard[];
  newContent: ContentBrief;
  structureGraph: ViralStructureGraph;
  boundaries?: Boundary[];
}
```

**Response**
```ts
{
  repairs: GapRepair[];
  gapSpecSource?: 'llm_generated' | 'rule_based';
  warning?: string;
  warnings?: string[];
}
```

`GapRepair` 结构：
```ts
{
  slotId: string;
  strategy: GapRepairStrategy;   // 'text_card' | 'crop_zoom' | 'aigc_background' | ... (共17种)
  explanation: string;
  generatedAssetHint?: string;
  gapSpec?: GapShootSpec;
}
```

---

## 5. 时间线生成

### `POST /api/timeline/generate`

根据结构图谱、素材匹配结果生成完整时间线（含脚本和分镜）。

**Request**
```ts
{
  structureGraph: ViralStructureGraph;
  newContent: ContentBrief;
  matches: SlotMatch[];
  repairs: GapRepair[];
  assets: AssetCard[];
  variant: 'high_click' | 'high_conversion' | 'premium';
  boundaries?: Boundary[];
}
```

**Response**
```ts
{
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  scriptSource?: 'llm_generated' | 'template';
  warning?: string;
  warnings?: string[];
}
```

`TimelineItem` 关键字段：
```ts
{
  id: string;
  start: number;
  end: number;
  segmentRole: SegmentRole;
  slotId: string;
  assetId?: string;
  script: string;
  subtitles: string[];
  visualAction: string;
  packaging: {
    captionStyle: string;
    cardType?: 'title_card' | 'selling_point_card' | 'comparison_card' | 'cta_card';
    transition?: 'quick_cut' | 'zoom_in' | 'push' | 'fade';
    motion?: 'crop_zoom' | 'pan' | 'static' | 'push_in';
  };
  repair?: GapRepair;
}
```

---

### `POST /api/timeline/apply-edit`

对已有时间线应用自然语言改片指令。

**Request**
```ts
{
  instruction: string;          // 例："开头更抓人一些，把商品信息提前，节奏更快"
  timeline: TimelineItem[];
  contentBrief: ContentBrief;
}
```

**Response**
```ts
{
  updatedTimeline: TimelineItem[];
  patchSummary: string;
  changedItems: Array<{
    itemId: string;
    changes: string[];
    before: TimelineItem;
    after: TimelineItem;
  }>;
  editType: TimelineEditType;          // 'hook_stronger' | 'product_info_earlier' | 'reduce_subtitles' | 'increase_rhythm' | 'stronger_cta' | 'combined' | 'unsupported'
  appliedEditTypes: TimelineEditType[];
  rationale: string;
  warnings: string[];
  supportedEditSuggestions: string[];
}
```

---

## 6. 质量自检

### `POST /api/quality/evaluate`

对时间线进行质量打分。

**Request**
```ts
{
  matches: SlotMatch[];
  timeline: TimelineItem[];
  boundaries?: Boundary[];         // 有 boundaries 时会额外计算 transitionFidelity
  contentBrief: ContentBrief;
  assets: AssetCard[];
}
```

**Response**
```ts
{
  qualityReport: QualityReport;
}
```

`QualityReport` 结构：
```ts
{
  structureMatch: number;          // 0..1
  slotCoverage: number;            // 0..1
  visualScriptAlignment: number;   // 0..1
  factuality: number;              // 0..1
  coherence: number;               // 0..1
  subtitleReadability: number;     // 0..1
  warnings: string[];
  transitionFidelity?: number;     // 0..1，仅当请求中有 boundaries 时返回
}
```

---

## 7. Storyboard Prompt 规划

### `POST /api/storyboard/plan`

为时间线每个条目生成图像生成 prompt，含安全状态检测。

**Request**
```ts
{
  timeline: TimelineItem[];
  structureGraph: ViralStructureGraph;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
}
```

**Response**
```ts
{
  frames: StoryboardFrame[];
  source: 'storyboard_prompt_planner';
  warnings: string[];
}
```

`StoryboardFrame` 关键字段：
```ts
{
  id: string;
  frameIndex: number;
  frameType: 'opening_hook' | 'product_closeup' | 'benefit_usage' | 'gap_repair' | 'cta_cover';
  title: string;
  timelineItemId: string;
  imagePrompt: {
    positivePrompt: string;
    negativePrompt: string;
    aspectRatio: string;
    styleHints: string[];
    promptSource: 'storyboard_prompt_planner';
  };
  safetyStatus: {
    status: 'passed' | 'needs_review' | 'blocked';
    ipRisk: 'low' | 'medium' | 'high';
    brandRisk: 'low' | 'medium' | 'high';
    claimRisk: 'low' | 'medium' | 'high';
    reasons: string[];
  };
  // ...更多字段见 types.ts
}
```

---

## 8. 缺失素材生成规划

### `POST /api/material-generation/plan`

为无法用现有素材填补的缺口，规划 AI 生视频任务。

**Request**
```ts
{
  materialGaps: MaterialGap[];
  repairs?: GapRepair[];
  storyboardFrames?: StoryboardFrame[];
  timeline?: TimelineItem[];
  contentBrief?: ContentBrief;
  aspectRatio?: '9:16' | '16:9' | '1:1' | 'unknown';
  provider?: 'mock' | 'seedance_2_0';
}
```

**Response**
```ts
{
  jobs: MissingMaterialGenerationJob[];
  source: 'missing_material_generation_planner';
  warnings: string[];
}
```

---

## 9. 效果预估

### `POST /api/analytics/demo-estimate`

基于离线启发式规则估算视频效果（非真实用户数据）。

**Request**
```ts
{
  structureGraph: ViralStructureGraph;
  contentBrief: ContentBrief;
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  timeline: TimelineItem[];
  storyboardFrames: StoryboardFrame[];
  missingMaterialJobs: MissingMaterialGenerationJob[];
  qualityReport?: QualityReport;
  generationVariant: 'high_click' | 'high_conversion' | 'premium';
}
```

**Response**
```ts
{
  demoEstimate: DemoEstimate;
}
```

`DemoEstimate` 结构：
```ts
{
  disclaimer: 'Offline heuristic estimate. Not based on real user behavior.';
  generatedAt: string;   // ISO 8601
  metrics: {
    viralPotential: DemoEstimateMetric;
    templateFit: DemoEstimateMetric;
    gapRepairCoverage: DemoEstimateMetric;
    evidenceConfidence: DemoEstimateMetric;
    variantDistinctiveness: DemoEstimateMetric;
    estimatedCtrLift: DemoEstimateMetric;
  };
  components: Record<string, number>;
  warnings: string[];
}

// DemoEstimateMetric
{
  score: number;
  label: string;
  explanation: string;
  formula?: string;
  simulated?: boolean;
}
```

---

## 10. StructMigrate 演示页专用接口（`/api/struct/*`）

> ⚠️ 这一组是 **新增、待后端实现** 的接口，专供单页应用（路由 `/`，`/demo` 已永久重定向到 `/`）的「爆款结构迁移引擎」四屏 UI
> （`apps/web/app/_struct/`）。与第 1–9 节不同，它们消费的是该 UI **自有的数据模型**，
> **不复用** `@viral-struct/shared`，因此后端按本节给出的 TS 形状返回即可，前端无需做类型桥接。
>
> 类型源文件（以此为准）：
> - 业务对象：`apps/web/app/_struct/data.ts`（`SourceVideo` / `Material` / `Diagnosis` / `CompileVersion` / `TargetProduct` 等）
> - 请求/响应 DTO：`apps/web/app/_struct/api/types.ts`
>
> **降级约定（重要）：** 这些接口任意一个不可用（网络错误 / 未实现 / 非 2xx）时，前端会 **自动回退到本地示例数据**
> 并把 `mode` 标记为 `mock`，因此后端逐个上线即可，未实现的接口不会阻断演示。

### 共享业务类型

```ts
type RoleKey  = 'hook' | 'pain' | 'emotion' | 'product' | 'compare' | 'social' | 'cta';
type StateKey = 'filled' | 'weakly' | 'missing' | 'critical';

interface SourceSegment {
  id: string;            // 's1' …
  role: RoleKey;
  start: number;         // 秒
  end: number;           // 秒
  label: string;         // '开场抓停'
  shot: string;          // 镜头描述
  caption: string;       // 字幕
}

interface SourceVideo {
  id: string;
  title: string;
  platform: string;
  duration: number;
  views: string; likes: string;
  finish_rate: number; ctr: number; cvr: number;
  protocol_version: string;          // 'StructureIR.v2.3.1'
  segments: SourceSegment[];
  rhythm:   { avg_shot: number; cuts: number; hook_density: string; bgm_bpm: number; caption_density: string };
  packaging:{ title_template: string; captions: string; bgm: string; cover: string };
}

interface TargetProduct {
  name: string; category: string; price: string;
  stock: number; asset_count: number; industry: string;
}

interface Material {
  id: string;
  kind: 'photo' | 'text';
  subject: string;
  slot: string | null;     // 推荐/已分配的 SourceSegment.id，未分配为 null
  quality: number;         // 0–1
  color?: string;
}

interface Diagnosis {
  state: StateKey;
  have: string[];
  need: string[];
  gap_reason: string;
  impact: { dim: string; pct: number; note: string };
  fix: { kind: string; desc: string } | null;
  strategy: string | null; // 'aigc' | 'hyperframes' | …
}

interface CompileVersion {
  id: string;              // 'click' | 'convert' | 'premium'
  name: string; desc: string; bias: string;
  stats: { k: string; v: string; up: boolean }[];
  mainStrat: string;
}

interface TimelineSeg {
  id: string; role: string;
  start: number; end: number;
  label: string; shot: string; caption: string;
  fixKind?: string | null;
}
```

所有响应都可携带可选的 `warnings?: string[]`（前端收集展示，不阻断）。

---

### `POST /api/struct/sample/analyze`

**屏 01｜样例解析。** 把一条爆款短视频解析为可迁移的结构协议（StructureIR）。

两种调用方式：
- 上传文件：`multipart/form-data`，字段 `video`（单文件）
- 指定种子：`application/json`，`{ "sampleId": "douyin_2786341" }`

响应：

```ts
{ sourceVideo: SourceVideo; warnings?: string[] }
```

---

### `POST /api/struct/materials/upload`

**屏 02｜素材入库。** 上传新商品素材，后端自动分类 / 识别主体 / 推荐槽位。

请求：`multipart/form-data`
- `assets`：File[]（可多文件）
- `product`：string（`JSON.stringify(TargetProduct)`）

响应：

```ts
{ materials: Material[]; warnings?: string[] }   // slot 字段为后端推荐结果
```

---

### `POST /api/struct/materials/match`

**屏 02｜槽位分配。** 持久化用户手动分配的槽位；`assignments` 省略时由后端自动匹配。

```ts
// 请求
{
  sourceVideo: SourceVideo;
  materials: Material[];
  assignments?: Record<string, string | null>;  // materialId -> slotId | null
}
// 响应
{ materials: Material[]; warnings?: string[] }
```

---

### `POST /api/struct/diagnose`

**屏 03｜缺口诊断。** 对每个槽位做「需要 ↔ 已有」四态匹配，并给出影响与补全路径。

```ts
// 请求
{ sourceVideo: SourceVideo; materials: Material[]; product: TargetProduct }
// 响应
{ diagnosis: Record<string, Diagnosis>; warnings?: string[] }   // key = SourceSegment.id
```

---

### `POST /api/struct/strategy/apply`

**屏 03｜应用补全策略。** 对单个槽位执行推荐的修复策略，返回更新后的诊断。

```ts
// 请求
{
  slotId: string;
  sourceVideo: SourceVideo;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
}
// 响应
{ diagnosis: Record<string, Diagnosis>; appliedSlots: string[]; warnings?: string[] }
```

---

### `POST /api/struct/compile`

**屏 04｜成片编译。** 按所选版本把结构 + 素材 + 诊断编译为可播放时间线。

```ts
// 请求
{
  sourceVideo: SourceVideo;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  versionId: string;            // 'click' | 'convert' | 'premium'
}
// 响应
{ version: CompileVersion; timeline: TimelineSeg[]; warnings?: string[] }
```

---

### `POST /api/struct/nl-edit`

**屏 04｜自然语言改片。** 基于当前版本与时间线，按一句话指令生成新草稿。

```ts
// 请求
{
  instruction: string;          // '把商品信息提前到第 3 秒'
  versionId: string;
  sourceVideo: SourceVideo;
  timeline: TimelineSeg[];
}
// 响应
{ timeline: TimelineSeg[]; patchSummary: string; warnings?: string[] }
```

---

### `POST /api/struct/export` ＋ `GET /api/struct/export/:jobId`

**屏 04｜导出成片。** 这是 **当前后端完全缺失的能力**（生成可下载 MP4），需新建。
渲染为长任务：`POST` 创建任务，`GET` 轮询状态直到 `status === 'done'`。

```ts
type ExportJobStatus = 'pending' | 'rendering' | 'done' | 'failed';

// POST 请求
{ versionId: string; format: string; timeline: TimelineSeg[] }   // format 如 'MP4 · 1080×1920'

// POST / GET 响应（同一形状）
{
  jobId: string;
  status: ExportJobStatus;
  progress: number;             // 0–100
  downloadUrl?: string;         // status==='done' 时给出；/media 开头会自动拼 API_BASE
  warnings?: string[];
}
```

---

### 备注：暂未启用的前端可视化组件

`apps/web/app/_struct/viz.tsx` 中还有两个 **已实现但当前未渲染** 的备选诊断视图：

- `DiagnosticRadar`：7 角色 × 满足度 雷达图
- `GapHeatmap`：槽位 × 维度 缺口热力表

它们复用 `POST /api/struct/diagnose` 返回的 `diagnosis` 数据，**不需要后端提供任何额外接口**。
目前屏 03 用的是另一套诊断视图（结构带 + 四态叠加 + 槽位明细表 + 满足度圆环），这两个组件作为备用保留；
若后续启用，数据契约不变。

---

## StructMigrate 演示页调用顺序

```
屏01  POST /api/struct/sample/analyze        → SourceVideo
屏02  POST /api/struct/materials/upload       → Material[]（自动推荐 slot）
      POST /api/struct/materials/match        → Material[]（手动分配，可选）
屏03  POST /api/struct/diagnose               → Record<slotId, Diagnosis>
      POST /api/struct/strategy/apply         → 更新后的 Diagnosis（逐槽位，可选）
屏04  POST /api/struct/compile                → CompileVersion + TimelineSeg[]
      POST /api/struct/nl-edit                → 新 TimelineSeg[]（可选）
      POST /api/struct/export                 → { jobId, status }
        └─ GET /api/struct/export/:jobId      → 轮询直到 status==='done' + downloadUrl
```

> 任一步失败前端自动回退到本地示例数据（`mode='mock'`），不阻断后续屏幕。

---

## 接口调用顺序（正常流程）

```
GET  /api/videos/seeds
POST /api/videos/seeds/analyze          → VideoAnalysis
  └─ POST /api/structure/extract        → ViralStructureGraph

POST /api/assets/analyze                → AssetCard[]
 OR  GET  /api/assets/libraries/:id    → AssetCard[]

POST /api/slots/match                   → SlotMatch[], MaterialGap[]
POST /api/gaps/repair                   → GapRepair[]

POST /api/timeline/generate             → timeline, script, storyboard
  ├─ POST /api/storyboard/plan          → StoryboardFrame[]
  ├─ POST /api/material-generation/plan → MissingMaterialGenerationJob[]
  └─ POST /api/quality/evaluate         → QualityReport
       └─ POST /api/analytics/demo-estimate → DemoEstimate

# 可选：自然语言改片
POST /api/timeline/apply-edit           → updatedTimeline
  └─ POST /api/quality/evaluate         → QualityReport（重新打分）
```

---

## 完整类型引用

```ts
// 直接从 @viral-struct/shared import：
import type {
  VideoAnalysis, ViralStructureGraph, ContentBrief, AssetCard,
  SlotMatch, MaterialGap, GapRepair, ScriptSegment, StoryboardShot,
  TimelineItem, QualityReport, StoryboardFrame,
  MissingMaterialGenerationJob, DemoEstimate, Boundary
} from '@viral-struct/shared';
```

后端若用 TypeScript，可在 `packages/shared/` 目录下直接安装并 import 这些类型。  
若用 Python，参考 `packages/shared/src/types.ts` 手写对应的 dataclass / TypedDict。
