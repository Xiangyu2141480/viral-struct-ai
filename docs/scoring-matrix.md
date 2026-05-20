# Scoring Matrix / 评分证据矩阵

本文件是答辩和开发的共同准绳：每个评分点都必须能在产品页面、代码模块、文档或 demo case 中找到证据。

## 1. 基础闭环完成度，25 分

| 评分项 | 分值 | 目标分 | 产品证据 | 代码/文档证据 |
|---|---:|---:|---|---|
| 样例输入与基础解析 | 5 | 5 | `/analyze` 上传样例，展示时长、分辨率、封面、关键帧、镜头数、字幕/语音概览 | `apps/api` video analyzer；`VideoAnalysis` schema；`docs/TASK_BREAKDOWN.md` T01 |
| 结构拆解能力 | 10 | 9-10 | `/graph` 展示脚本结构、节奏结构、包装结构 | `ViralStructureGraph`；`docs/ARCHITECTURE.md`；T02 |
| 结构迁移生成能力 | 10 | 9-10 | `/result` 展示脚本、分镜、时间线草案、包装建议/preview | `TimelineItem` protocol；`docs/TOOL_PROTOCOL.md`；T04 |

## 2. 素材缺口处理能力，20 分

| 评分项 | 分值 | 目标分 | 产品证据 | 代码/文档证据 |
|---|---:|---:|---|---|
| 素材缺口识别 | 8 | 7-8 | `/gaps` 按结构槽位展示 matched / partial / missing、原因、影响 | `SlotMatch`、`MaterialGap`；T05 |
| 素材缺口补全 | 12 | 10-12 | `/gaps` 展示标题卡、卖点卡、对比卡、CTA 卡、字幕补全、裁切复用 | `GapRepair`；`Gap Repair Planner`；T06 |

## 3. 结果展示与可验证性，20 分

| 评分项 | 分值 | 目标分 | 产品证据 | 代码/文档证据 |
|---|---:|---:|---|---|
| 迁移过程可视化 | 10 | 9-10 | StructureGraph + MappingTable + GapBoard + RepairBoard + TimelineView | `apps/web/components`；T07 |
| 最终效果展示 | 10 | 9-10 | 分镜、时间线、样例结构与新结果对比、Remotion preview/MP4 demo | `packages/remotion-video`；T08 |

## 4. 进阶能力，20 分

| 评分项 | 分值 | 目标分 | 产品证据 | 代码/文档证据 |
|---|---:|---:|---|---|
| 画面包装能力 | 8 | 7-8 | 字幕样式、标题条、卖点卡、封面方案、转场建议至少 2 项 | `PackagingStructure`；T09 |
| 多版本生成 | 4 | 3-4 | 高点击版、高转化版、高节奏版/高质感版切换 | version strategy；T10 |
| 真实素材适配 | 8 | 6-8 | AssetCard、素材分类、槽位推荐、高光片段/关键帧筛选 | `AssetCard`；T11 |

## 5. 人机协同与整体完成度，15 分

| 评分项 | 分值 | 目标分 | 产品证据 | 代码/文档证据 |
|---|---:|---:|---|---|
| 人工可调能力 | 8 | 6-8 | 用户可改 hook、卖点顺序、包装风格、节奏、CTA 中至少 1 项并重新生成 | edit instruction / timeline patch；T12 |
| 创意与产品完成度 | 7 | 6-7 | 完整流程、清晰 UI、可解释结构迁移、稳定 demo | README、架构、demo case、质量报告 |

## 6. 加分项，最高 +10

| 加分项 | 目标证据 |
|---|---|
| 自然语言改片 | 输入“开头更抓人一些”等指令，输出可解释 timeline patch |
| 真实素材 + AIGC 补全融合 | 缺口处生成封面、背景、补充画面或配音建议，并标记 AIGC |
| 强可解释结构迁移 | 图谱、映射线、缺口和补全策略都能追溯到样例结构 |
| 完整包装链路 | 封面、字幕、标题条、贴纸、转场建议互相一致 |
| 工程质量 | typecheck/build/CI 通过，schema 校验，mock/real provider 双模式 |

## 7. 答辩展示顺序

```txt
1. 先讲一句话定位：不是复制爆款，而是迁移创作结构。
2. 打开样例分析，展示基础解析。
3. 打开结构图谱，展示脚本/节奏/包装三类结构。
4. 输入便携咖啡杯和有限素材。
5. 展示素材缺口：故意缺使用过程、对比镜头、CTA 镜头。
6. 展示补全策略：标题卡、卖点卡、对比卡、CTA 卡、字幕补全。
7. 展示脚本、分镜、时间线和 demo。
8. 展示多版本或人工调整作为冲分点。
```
