# ViralStructureGraph 协议 v2 审计 — 4 sub-agent 并行评估

**Date:** 2026-05-23
**Owner:** 严平川 (Fine Scan)
**Branch:** `codex/fine-scan-peak-micro`
**Status:** 🟡 审计完成,等待同步会拍板后实施
**Co-decision required:** 是(协议是跟下游团队共享的契约,不能单方面改)

## 触发事件

W2-C 同步会前,先审计 `packages/shared/src/types.ts:211-225` 的
`ViralStructureGraph` 协议。用户提问 `CreativeIngredient.confidence`
字段「有什么用」— 推断这是设计时的重大缺陷,要求逐字段重新审视。

初步判定 43 个字段中:
- ✅ KEEP: 17 (~41%)
- ⚠ WEAK: 14 (~34%)
- ❌ KILL: 8 (~20%)
- 🔧 RECAST: 4 (~5%)

为避免单人偏见,启动 4 个 sub-agent 并行独立审计。

## 方法

4 个角色,各自独立 review 我的初判,可反对:

| Agent | 角色 | 类型 | 关注点 |
|---|---|---|---|
| A | Producer(上游产出方)| architect | 哪些字段我们产不出?编造类清单 |
| B | Consumer(下游消费方)| general-purpose | grep apps/ 找真实消费点 |
| C | Schema Engineering | architect | 字段冗余/枚举漂移/命名错位 |
| D | Cross-Category | general-purpose | 跨品类(3C/食品/家居/课程)适配性 |

## 4 Agent 核心发现

### Agent A — Producer 视角

5 个反对我初判的字段(全部加码到 KILL):
- `narration / caption` ⚠ → ❌:Fine prompt L116 **明文禁止**输出文字内容
- `shotSlots` 整族 ⚠ → ❌:上游 2 个 prompt 都没"shot slot"概念
- `creativeIngredients` 整族越界 — "ingredient" 概念上游不存在
- `RhythmStructure.peakAt` ⚠ → ❌:Fine 每块 10-12 个 peaks,单 number 是降维丢失
- `edges` 整族 ❌:上游零信号

「编造类字段」清单(必填但无可靠产出):
1. `meta.style: 'high_click'|...` — KPI 概念,需 A/B 数据
2. `meta.videoType` 4 枚举 vs Rough Scan 5 枚举不重叠
3. `SegmentNode.purpose / transferRule` 自由 string
4. `SegmentNode.importance: 1-5` 上游零信号必凭感觉
5. `CreativeIngredient.confidence` 实测 0.85-0.98 永远高位常数

### Agent B — Consumer 视角(grep 硬证据)

**最震撼的单一发现**:

> 整个 ViralStructureGraph 协议处于 **producer-only 状态**。
> `apps/web/` 所有组件(`StructureGraphMock.tsx`、`TimelineView.tsx`、
> `GapBoard.tsx`、`QualityReportPanel.tsx`)是写死的中文字符串数组,
> **完全不接受任何 graph 数据,连 props 都没有**。
> `apps/api/` 只有 `slotMatcher` 和 `timelineGenerator` 真正读字段,
> **只读 8 个**:
>
> - `segments[]` 的 `id/role/start/end`
> - `shotSlots[]` 的 `id/segmentId/role/requiredAsset.{type, motion}/
>   visualIngredientRequirements/humanRequirement.{required, framing, action}`

`rhythm / packaging / creativeIngredients / meta / structureSummary /
edges` **全部 0 命中**。

### Agent C — Schema Engineering

10 个跨字段设计缺陷:

1. **生命周期混淆**: `GraphEdge.type` 把 analysis-time 关系(sequence)
   和 match-time 关系(requires/maps_to/fallback)塞同一数组 — 违反 ISP
2. **枚举漂移**:
   - `SegmentRole` 7 vs Fine `roleConfirmation.role` 8(3 个不重叠)
   - `videoType` 4 vs Rough `likelyVideoType` 5(完全不重叠)
   - `captionPosition` 4 枚举 vs Fine `positionGrid` 1-9
   - `cardTypes: string[]` vs `TimelineItem.packaging.cardType` 枚举
   - `transitions: string[]` vs Rough `techniqueTags` 枚举
3. **品类强绑定**(美妆 bias):见 Agent D
4. **生产/消费归属缺失**:无 `@produced_by / @consumed_by` 注释
5. **派生字段**:`SegmentNode.duration = end - start`
6. **冗余表达**:`CreativeIngredient.{segmentIds, requiredForSlotIds}`
   与 `GraphEdge` 表达同一关系两次
7. **名实不符**:`meta.style` 字面 style 值是 KPI;
   `transferRule` 名为 rule 实为自由 string;
   `structureSummary` 名为 summary 实为 debug log
8. **可空性偷懒**:双层 `?` 导致防御性 `?.?.??` 写法
9. **打分契约缺失**:`confidence/importance/score/severity` 无阈值文档
10. **上游信息丢失**:Fine Scan 产 `peakId/prominence/motionScore/
    channels/anchorSource/beforeState/afterState/timeRangeMs`,
    协议只用单 `peakAt: number` 承接 — **信息蒸发率 >99%**

### Agent D — Cross-Category

跨品类可用性评分 **42 / 100**:

| 品类 | 评分 |
|---|---:|
| 美妆 | 90 |
| 3C | 65 |
| 食品 | 45 |
| 服装 | 40 |
| 家居 | 35 |
| 课程 / 本地服务 | 25 |

**致命单点**:`CreativeIngredientType` 把「内容语义」和「样式语义」
混杂(`scene_style / soft_light / clean_background / premium_visual /
lifestyle_context` 5 项与 `VisualStyleTag` 重复定义),且 40% 枚举
强绑定美妆。

### 4 Agent 共识(必删字段)

- `confidence` (CreativeIngredient) — 实测常数,信息量 0
- `importance` (Segment/ShotSlot) — 同 confidence 病
- `duration` (Segment) — 派生字段,= end - start
- `style` (meta) — 命名错位,KPI 不是 style
- `purpose / transferRule / explanation / coverStyle / titleStyle / pattern` — 自由 string

## 综合方案 — v2 ViralStructureGraph

### 设计原则

1. **按生命周期分 3 层**:
   - Block Layer(Fine Scan 块级,Producer 必填)
   - Timing Layer(visual_peak_detector + audio,Producer 必填)
   - Aggregate Layer(slot/ingredient,**aggregator 阶段产**,Producer 不填)
2. **每字段强制 `@produced_by / @consumed_by` JSDoc**
3. **打分字段全删**,除非附带阈值消费契约
4. **品类维度显式化**:`meta.category` + ingredient 三段式
5. **自由 string 字段一律改枚举**,只在用户素材描述等不可枚举处保留
6. **枚举跨字段对齐**(`cardType / transition / role` 全协议唯一来源)

### v2 TypeScript 草案(精简到核心)

```typescript
export interface ViralStructureGraphV2 {
  meta: {
    schemaVersion: 'v2.0'
    runId: string
    aspectRatio: '9:16' | '16:9' | '1:1' | '4:5' | '2:3' | 'unknown'
    durationMs: number
    category: 'beauty' | '3c' | 'food' | 'apparel' | 'home' | 'course' | 'local_service' | 'other'
    provenance: { roughScanVersion: string; fineScanVersion: string; modelId: string }
  }

  segments: ReadonlyArray<{
    id: string
    role: NarrativeRole
    startMs: number
    endMs: number
    blockSemantics: {
      dominantTone: DominantTone
      productPresentation: ProductPresentation
      claimVisualizationPattern?: ClaimPattern
      textOverlay: { elements: TextOverlayElement[] }
    }
    visualBeatIds: ReadonlyArray<string>
    incomingTransitionId?: string
    outgoingTransitionId?: string
  }>

  rhythm: {
    avgShotDurationMs: number
    beats: ReadonlyArray<VisualBeat>  // 承接全部 Fine Scan actionBeats 字段
  }

  audio: {
    bpm: number
    beats: ReadonlyArray<{ tMs: number; isDownbeat: boolean; beatNumber: number }>
  }

  transitions: ReadonlyArray<{
    id: string
    fromSegmentId: string
    toSegmentId: string
    pivotMs: number
    windowMs: { start: number; end: number }
    techniqueTags: ReadonlyArray<TransitionTechnique>
    visualChange: string
  }>

  // Aggregate Layer:downstream aggregator 产
  shotSlots?: ReadonlyArray<ShotSlotV2>      // 只保留 Agent B 验证有消费的 8 个字段
  creativeIngredients?: ReadonlyArray<IngredientV2>  // 三段式 base+扩展+作用域
  repairPolicies?: ReadonlyArray<RepairPolicy>
}
```

### 字段精简对比

| 维度 | v1 | v2 | 变化 |
|---|---:|---:|---:|
| 顶层字段 | 8 | 7 | -1 |
| 总子字段 | 43 | 28 | **-35%** |
| KILL 类字段 | 8 | 0 | -8 |
| 自由 string 字段 | 11 | 3(全在合法位置)| -73% |
| 跨品类可用性评分 | 42 / 100 | ~80 / 100 | **+90%** |

## 实施路径

| Phase | 工作 | 时间 | 风险 |
|---|---|---|---|
| 1 | 删 8 KILL 字段 + 加 @produced_by/@consumed_by JSDoc | 2-3 天 | **零**(Agent B grep 证明无人读)|
| 2 | 引入 rhythm.beats / audio / transitions(承接 Fine Scan 已产物);Web 端真正消费 graph | 1 周 | 中 |
| 3 | meta.category;CreativeIngredientType 三段式重构;shotSlots/ingredients 移到 aggregate layer | 2-3 周 | 高 |

## 同步会 5 个待决问题

1. `apps/web/` 现在是 mock 字符串,不接 graph。在 web 真正消费 graph 前,
   能不能把协议砍到只剩 8 字段的真实契约,等 web 接入后再增量加?
2. `confidence / importance / *Score` 字段任何业务逻辑在读吗?v2 全删
   有反对吗?
3. `shotSlots / creativeIngredients` 是 aggregate-layer 概念,Fine Scan
   产不出。能定义为 optional + 标注 producer 不填、aggregator 阶段填吗?
4. SegmentRole 协议 7 vs Fine 8,3 个不重叠。**必须拍板对齐**,否则
   adapter 永远在打补丁。
5. 跨品类适配:`meta.category` 加吗?不加 3 个月后扩到食品/家居时
   `CreativeIngredientType` 美妆 bias 会爆。

## 备选方案(已评估,被否决)

| 方案 | 否决理由 |
|---|---|
| 不动协议,Fine Scan 写适配器适配 v1 | 让上游编造下游不读的字段,纯浪费 token |
| 一次性大改协议 | 风险过高;无法跟 web 端进度对齐 |
| 全字段保持 string + 文档约束 | Agent C 证明已经在自我矛盾(cardTypes/transitions 内部矛盾) |
| 增字段不删字段 | 字段累积是协议腐败的主因 |

## 引用

- 4 sub-agent 原始报告:本会话 transcript `codex/fine-scan-peak-micro`
- 协议定义:`packages/shared/src/types.ts:211-225`
- 上游 Fine Scan 实测产物:`seed_assets/analysis/macbook_neo/fine_scan_v03_concurrent/block_001_fine_scan.json`
- 同步会准备文档:`docs/FINE_SCAN_OUTPUT_CONTRACT.md`
- 姊妹 ADR:`docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md`
