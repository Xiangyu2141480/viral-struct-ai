# GitHub Issues Backlog

下面这些 issue 可以直接复制到 GitHub。

## Milestone M1 - P0 Core Loop

### Issue 1: 初始化 monorepo 和基础 CI

Labels: `type/backend`, `type/frontend`, `risk/demo-critical`

验收：

```txt
pnpm install 可用
pnpm typecheck 可用
apps/web 可启动
apps/api 可启动
```

### Issue 2: 实现样例视频上传与基础解析

Labels: `score/p0-core`, `type/video`, `risk/demo-critical`

验收：

```txt
上传视频
ffprobe 元信息
封面图
关键帧
镜头数
字幕 fallback
```

### Issue 3: 实现 ViralStructureGraph schema

Labels: `score/p0-core`, `type/ai`

验收：

```txt
SegmentNode
ShotSlotNode
RhythmStructure
PackagingStructure
GraphEdge
zod validation
```

### Issue 4: 实现结构抽取 mock + LLM adapter

Labels: `score/p0-core`, `type/ai`

验收：

```txt
输入 videoAnalysis
输出脚本 / 节奏 / 包装结构
支持 mock 模式，保证答辩不依赖模型稳定性
```

## Milestone M2 - P0 Gap Detection & Repair

### Issue 5: 实现 AssetCard 生成

Labels: `score/p1-real-assets`, `type/video`, `type/ai`

验收：

```txt
图片 / 视频素材生成描述
spatial frame
temporal frames
suitableSlots
qualityScore
```

### Issue 6: 实现 slot matching

Labels: `score/p0-gap`, `risk/demo-critical`

验收：

```txt
每个 slot 输出 matched / partial / missing
每个缺口给出 reason 和 impact
```

### Issue 7: 实现 gap repair planner

Labels: `score/p0-gap`, `type/ai`, `risk/demo-critical`

验收：

```txt
支持 title_card
支持 crop_zoom
支持 comparison_card
支持 cta_card
```

## Milestone M3 - P0 Visualization & Demo

### Issue 8: 实现 StructureGraph 可视化

Labels: `score/p0-visualization`, `type/frontend`

### Issue 9: 实现 MappingTable 和 GapBoard

Labels: `score/p0-visualization`, `type/frontend`

### Issue 10: 实现 TimelineView

Labels: `score/p0-visualization`, `type/frontend`

### Issue 11: 实现 HyperFrames-first video render preview

Labels: `score/p0-core`, `type/video`, `risk/demo-critical`

## Milestone M4 - P1 Advanced Creation

### Issue 12: 画面包装生成

Labels: `score/p1-packaging`, `type/frontend`, `type/video`

验收：字幕样式、卖点卡、封面方案、转场建议至少 2 项。

### Issue 13: 多版本生成

Labels: `score/p1-packaging`, `type/ai`

验收：高点击版、高转化版、高质感版。

### Issue 14: 人工可调能力

Labels: `score/p1-human-in-loop`, `type/frontend`

验收：hook、卖点顺序、节奏、包装风格可调整。

### Issue 15: 自然语言改片

Labels: `score/p1-human-in-loop`, `type/ai`

验收：一句话生成 timeline patch。

## Milestone M5 - Final Delivery

### Issue 16: 项目说明文档

Labels: `type/docs`, `risk/demo-critical`

### Issue 17: 演示视频录制

Labels: `risk/demo-critical`

### Issue 18: 最终 case 整理

Labels: `risk/demo-critical`
