# Fine Scan 输出契约 — 同步会准备材料

> 目的:与 `structureExtractor` / `slotMatcher` / `gapRepairPlanner` /
> `timelineGenerator` 等下游消费 Fine Scan 输出的同学对齐:
>
> 1. 我们现在产出什么 (v0.3, 已可用)
> 2. 你们的协议期望什么 (`ViralStructureGraph` in `packages/shared/src/types.ts`)
> 3. 两者的落差在哪
> 4. 三个关键决策

---

## 1. Fine Scan 当前产出 — `fine_content_block_semantic_v0_3`

**单次跑(11 个 block)产生:**

```
seed_assets/analysis/<video_id>/fine_scan_*/
├── block_001_fine_scan.json   ← 19 个顶层字段,见下
├── block_002_fine_scan.json
├── ...
├── block_011_fine_scan.json
├── fine_structure_scan.json   ← 合并清单 (5 字段: videoId, scanMode, roughScanRef, blockCount, contentBlocks[])
└── fine_scan_failures.json    ← 仅在有 block 失败时生成
```

**每块 JSON 的 19 字段(按用途分类):**

| 分类 | 字段 | 来源 |
|---|---|---|
| **身份 (5)** | schemaVersion / blockId / videoId / sourceTimeRangeMs / samplingInfo | 代码 |
| **块级模型语义 (10)** | roleConfirmation, positionalContext, dominantTone, transferableMotifs, requiredAssetType, textOverlayBehavior, productPresentation, transitionOut, claimVisualizationPattern, inspectionAnswers | Doubao (fine_structure_scan prompt) |
| **动作节奏 (1 数组)** | actionBeats[] (~14/块) | 代码(visual peak detector + ruptures)+ Doubao (peak_micro_scan per peak) |
| **审计 (3)** | peakDetectionStats, audioBeatsUsedAbsMs, alignmentToleranceMs | 代码 |

**actionBeats[] 单个 beat 的 schema:**
```json
{
  "beatId": "beat_001",
  "semanticAction": "双手举出黄色笔记本",
  "actionType": "entry",
  "beforeState": "白空白画面",
  "afterState": "双手举出黄色笔记本",
  "relativePositionBucket": "early",
  "anchorMs": 500,                      // 绝对视频时间, 代码算
  "timeRangeMs": {"start": 0, "end": 1300},
  "anchorSource": "visual_peak",        // 或 "regime_boundary"
  "nearestAudioBeatMs": 3600,
  "deltaMs": -3100,
  "isBeatAligned": false,
  "alignmentToleranceMs": 120,
  "anchorConfidence": 0.98,             // 模型置信度
  "visualPeak": {                       // 视觉证据
    "peakId": "peak_002",
    "prominence": 15.4,
    "motionScore": 15.0,
    "channels": ["hist_delta", "frame_diff", "flow_mag", "area_delta"]
  }
}
```

完整样例: `seed_assets/analysis/macbook_neo/fine_scan_v03_concurrent/block_001_fine_scan.json`

---

## 2. 团队协议期望 — `ViralStructureGraph` (in `packages/shared/src/types.ts:211`)

```typescript
interface ViralStructureGraph {
  meta: { duration, aspectRatio, videoType, style }
  structureSummary: string
  segments: SegmentNode[]              // role / start / end / purpose / transferRule / importance
  shotSlots: ShotSlotNode[]            // role / segmentId / requiredAsset / fallbackStrategies / importance
  rhythm: RhythmStructure              // avgShotDuration / cutFrequency / peakAt / pattern
  packaging: PackagingStructure        // captionDensity / titleStyle / transitions / coverStyle
  creativeIngredients: CreativeIngredient[]
  edges: GraphEdge[]                   // from / to / type ('sequence' | 'requires' | 'maps_to' | 'fallback')
}
```

---

## 3. 落差对照

| 协议字段 | Fine Scan 是否产出? | 备注 |
|---|---|---|
| `meta.duration` | 间接(可从 rough_scan 推) | 需要在 manifest 里 expose |
| `meta.aspectRatio` | ❌ 无 | rough_scan 可能有 |
| `meta.videoType` / `meta.style` | ❌ 无 | 是 model 主观判断,我们没问 |
| `structureSummary` | ❌ 无 | Stage 1 rough_scan 有 `oneSentenceStructure` |
| `segments[]` 一对一映射? | ⚠ 部分 | 我们的 block ≈ segment;`role` 枚举大致重叠;但 `purpose / transferRule / importance` 我们没产 |
| `segments[].role` (hook/pain_point/selling_point/proof/usage/comparison/cta) | ⚠ 部分 | 我们的 `roleConfirmation.role` 重叠部分(hook 等) |
| `shotSlots[]` | ❌ 概念错位 | 我们的 actionBeats 是"已发生的视觉事件",shotSlots 是"槽位模板"。一对一不通 |
| `rhythm` | ⚠ 部分 | peakDetectionStats 有原始数据,但 `cutFrequency` / `pattern` 没归类 |
| `packaging` | ❌ 无 | textOverlayBehavior 偏向单块字幕,packaging 是视频级总结 |
| `creativeIngredients[]` | ⚠ 部分 | `transferableMotifs` 概念接近,但 schema 不同(没有 evidence / transferability 字段) |
| `edges[]` | ❌ 无 | "block N → block N+1" 这种 sequence edge 容易生成,但 `requires / maps_to / fallback` 是 slot 匹配后才知道 |

**结论:** Fine Scan 当前输出能直接喂的字段大约**只占协议 30%**。剩余 70% 要么需要**适配/转换**,要么**根本就不在 Fine Scan 职责内**。

---

## 4. 三个关键决策(同步会的核心议题)

### Q1. 适配层谁写?

**选项 A — Fine Scan 侧写 Python 适配器** (`fine_scan_to_vsg.py`)
- 我们多写 ~200 行,直接产出 ViralStructureGraph JSON
- 你们 TS 端直接读
- ⚠ 我们要替你们做一些主观选择(比如 `videoType` 怎么定)
- ⚠ 假数据/空数据(`shotSlots[]`, `edges[]`)由我们填,可能不符合你们预期

**选项 B — TS 侧适配** (你们写 `vsg-adapter.ts`)
- 我们保持 v0.3 schema 稳定
- 你们消费时 mapping + 自填缺失字段
- ✅ 你们可以按需 lazily 决定哪些字段必填
- ⚠ 每次我们改 v0.3 schema 都可能破你们的 adapter

**选项 C — 双方都不写**
- 你们直接读 v0.3 JSON,在业务代码里就地处理
- ✅ 最简单
- ⚠ 没有契约,容易漂移

**选项 D — Fine Scan 重新对齐到 ViralStructureGraph 当 native 输出**
- 我们丢弃 v0.3 schema,直接输出 ViralStructureGraph
- ✅ 你们零 mapping
- ⚠ 我们要"伪造"很多字段(transferRule 我们没信号源)

---

### Q2. 缺失字段谁补?

按优先级排,哪些字段你们**真的会消费**:

| 字段 | 当前缺/部分 | 谁能产? | 谁来加? |
|---|---|---|---|
| `meta.duration / aspectRatio` | 缺 | rough_scan / ffprobe | ? |
| `meta.videoType / style` | 缺 | 需新增 Doubao 调用询问 | ? |
| `structureSummary` | 缺 | rough_scan 有类似字段 | ? |
| `segments[].purpose / transferRule` | 缺 | 需新增 prompt 字段或推断 | ? |
| `shotSlots[]` | 概念错位 | **从 actionBeats 派生?还是独立扫?** | 这是同步会最重要的设计决策 |
| `creativeIngredients[]` 完整 schema | 部分 | 需新增 prompt 字段 | ? |
| `edges[]` | 缺 | block 间 sequence 可代码生成 | ? |

---

### Q3. 文件交付 vs API 交付?

**当前:** 我们写到 `seed_assets/analysis/<video>/fine_scan_*/*.json`。你们直接 `fs.readFileSync` 读。

**问题:**
- 多视频时路径管理麻烦
- 失败情况通过额外的 `fine_scan_failures.json` 传递,你们要主动检查
- partial success(11 块里 1 块失败)处理不一致

**选项:**
- (a) 保持文件交付,我们给一个 stable JSON path convention
- (b) 我们提供一个 Python CLI:`fine_scan run <video_id> --emit json` 直接打印到 stdout
- (c) 你们的 apps/api/services/videoAnalyzer.ts 可以 spawn Python subprocess 跑我们的 CLI

---

## 5. 同步会的 minimum 议程(15 分钟)

1. **3 分钟** — 我演示一份真实 block_001 JSON(让大家看到具体数据)
2. **5 分钟** — 一起看协议落差表,你们回答"你们实际用到哪些字段"(可能 50% 都不用)
3. **5 分钟** — 拍板 Q1 / Q2 / Q3
4. **2 分钟** — 我把决策落到本文档,下周开干

---

## 6. 我对决策的初步倾向(仅供参考,不是定论)

- **Q1**: **选项 B**(TS 侧适配)。Fine Scan 是数据生产者,业务消费方向太多变,适配层放消费侧更灵活。
- **Q2**: 让你们告诉我"你们消费的 top 5 字段",我们 prioritize 那 5 个;其他暂时不补。
- **Q3**: 保持文件交付(选项 a)。简单可调试;CLI 化(选项 b/c)是 month 2 的事。

---

## 附录 — 你们现在就可以直接读的字段速查

如果想立刻开始集成,这些字段在每块 JSON 里直接可用,与 ViralStructureGraph 对应关系最好:

```typescript
// In your TS code:
const block = JSON.parse(await fs.readFile(path));

// 直接可对应 ViralStructureGraph.segments[i] 的核心字段:
const segment = {
  id: block.blockId,
  role: block.roleConfirmation.role,        // 注意:enum 范围与 SegmentRole 重叠但不完全相同
  start: block.sourceTimeRangeMs.start / 1000,
  end: block.sourceTimeRangeMs.end / 1000,
  duration: (block.sourceTimeRangeMs.end - block.sourceTimeRangeMs.start) / 1000,
  // purpose, transferRule, importance, narration, caption: 缺,需要 adapter 填
};

// 直接可对应 actionBeats / 时间线生成:
const beats = block.actionBeats.map(b => ({
  time: b.anchorMs / 1000,
  action: b.semanticAction,
  type: b.actionType,
  alignedToBeat: b.isBeatAligned,
}));

// 直接可对应 transferableMotifs(部分):
const motifs = block.transferableMotifs;
```

---

**最后更新:** 2026-05-23 (Week 2-C 同步会前)  
**作者(Fine Scan owner):** 严平川  
**待消费方代表:** ?(同步会上指认)
