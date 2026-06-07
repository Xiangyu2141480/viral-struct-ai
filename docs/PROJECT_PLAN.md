# Viral Struct AI 总规划

面向队友评审：这份文件是项目的总入口，用来判断当前路线是否合理、哪些事情已经具备基础、下一步应该怎么分工推进。更细的任务、评分和协议说明见文末“相关文档”。

## 1. 项目一句话

Viral Struct AI / 爆构引擎要做的是：

```txt
从爆款样例视频中抽取可迁移的视频结构，
迁移到新商品和用户素材中，
识别素材与创作要素缺口，
通过文案、包装、素材复用或补拍建议补全，
最终生成脚本、分镜、时间线和可播放 Web demo。
```

核心不是“复制一个爆款视频”，而是把爆款中的创作方法结构化、可解释、可迁移。

## 2. 当前仓库真实状态

### 已有工程骨架

| 模块 | 路径 | 当前作用 |
|---|---|---|
| Web 前端 | `apps/web` | Next.js 页面骨架，已有 `/analyze`、`/graph`、`/adapt`、`/gaps`、`/result` |
| API 后端 | `apps/api` | Express API 骨架，已有 videos/assets/structure/slots/gaps/timeline/quality 路由 |
| 共享协议 | `packages/shared` | TypeScript 类型 + Zod schema，定义结构图谱、素材卡、缺口、时间线等协议 |
| 视频渲染 | 待建 render adapter | 旧视频渲染包已移除，后续优先落地 HyperFrames + FFmpeg-backed render path |
| Seed 素材 | `seed_assets/raw_videos` | 已有多条原始样例视频，可用于后续真实解析和 demo case |
| 文档体系 | `docs` | 已有需求、评分、交接、安全、demo、工具协议等文档 |

### 当前已实现的能力性质

当前已经有 **mock 闭环和协议基础**，但还不是完整真实视频分析系统。

已具备：

- `VideoAnalysis` mock：基础元信息、镜头、关键帧、字幕概览。
- `ViralStructureGraph` mock：段落结构、镜头槽位、节奏、包装、creativeIngredients。
- `AssetCard` mock：素材类型、适合槽位、质量、detectedIngredients、humanPresence。
- `SlotMatch`：按语义、素材类型、视觉要素、动作、质量进行初步匹配。
- `MaterialGap`：能表达素材缺口和要素缺口。
- `GapRepair`：能给出标题卡、卖点卡、手部演示、补拍真人素材、风格建议等补全策略。
- Web 静态展示：`/graph` 展示结构图谱和爆款视频要素，`/gaps` 展示素材缺口和要素缺口。

尚未完成：

- 真实视频上传后的 ffprobe/FFmpeg 基础解析。
- 真实关键帧抽取、镜头切分、ASR。
- seed video 到结构图谱的真实自动分析。
- 前端真实调用 API 串联完整流程。
- HyperFrames-first preview / MP4 真实渲染。
- 多版本生成、人工可调、自然语言改片的真实交互。

## 3. 拿奖逻辑

评分不是只看最终视频，而是看“任务完成度 + 完成质量 + 展示效果”。因此规划的核心原则是：

```txt
先把 P0 闭环做成评委一眼可打分，
再做高性价比 P1 和加分项。
```

最重要的展示链路：

```txt
样例视频
  -> 基础解析
  -> 段落 / 节奏 / 包装 / creativeIngredients 拆解
  -> 新商品与用户素材
  -> 槽位匹配
  -> 素材缺口与要素缺口
  -> 补全策略
  -> 脚本 / 分镜 / 时间线 / Web demo
```

## 4. 核心协议设计

所有模块都围绕 `packages/shared/src/types.ts` 和 `packages/shared/src/schemas.ts`，不要让 LLM 直接输出散乱自然语言。

核心对象：

| 协议 | 用途 |
|---|---|
| `VideoAnalysis` | 表达视频元信息、镜头、关键帧、字幕 |
| `ViralStructureGraph` | 表达可迁移结构，是项目最核心的中间层 |
| `SegmentNode` | Hook / pain point / selling point / proof / usage / comparison / CTA |
| `ShotSlotNode` | 每个结构段落需要什么素材、动作、视觉要素 |
| `CreativeIngredient` | 爆款视频要素层，例如真人出镜、脸部近景、上脸试用、柔光、信任建立 |
| `AssetCard` | 用户素材理解结果，包含 detectedIngredients 和 humanPresence |
| `SlotMatch` | 结构槽位和用户素材的匹配结果 |
| `MaterialGap` | 缺少哪些素材或创作要素 |
| `GapRepair` | 如何补全缺口 |
| `TimelineItem` | 可被 HyperFrames/FFmpeg render adapter 消费的时间线草案 |
| `QualityReport` | 结构匹配、槽位覆盖、事实性、可读性等质量评价 |

### Creative Ingredients 边界

`creativeIngredients` 只识别可迁移创作要素，不评价人的外貌。

允许：

```txt
human_presence
face_closeup
host_talking
makeup_application
skin_texture_display
before_after_comparison
soft_light
clean_background
trust_building
```

禁止：

```txt
beauty_score
颜值评分
美女程度
这个人够不够好看
```

## 5. 推荐开发路线

### M1：真实样例视频解析

目标：让 `/analyze` 从 seed video 或上传视频得到真实基础分析，而不是纯 mock。

负责人建议：后端 + 视频处理同学。

范围：

- 接入 `ffprobe` 读取 duration/fps/resolution/aspectRatio。
- 用 FFmpeg 抽封面和关键帧。
- 保留手动 transcript fallback。
- API 返回 `VideoAnalysis`，前端 `/analyze` 展示真实结果。

验收：

- 至少能选择或上传 1 个 seed video。
- 页面展示时长、分辨率、封面/关键帧、镜头数、字幕概览。
- `pnpm typecheck` 和 `pnpm build` 通过。

### M2：结构抽取从 mock 走向半真实

目标：把真实 `VideoAnalysis` 变成结构图谱。

负责人建议：AI / 协议同学。

范围：

- 基于 transcript + keyframes 生成 `segments`。
- 保留 mock fallback。
- 让 `structureExtractor` 输出完整 `ViralStructureGraph`。
- creativeIngredients 先用规则 + mock/VLM 占位，后续再接真实 VLM。

验收：

- `/graph` 能展示段落结构、节奏、包装、爆款视频要素。
- 结构输出能通过 Zod schema。
- 结果能解释“为什么这个样例可迁移”。

### M3：素材适配与缺口识别

目标：让用户素材真正进入 `AssetCard -> SlotMatch -> MaterialGap` 链路。

负责人建议：后端 + 前端协作。

范围：

- `/adapt` 支持输入商品信息、卖点、CTA 和上传素材。
- `assetAnalyzer` 输出素材类型、对象、detectedIngredients、humanPresence。
- `slotMatcher` 输出 matched / partial / missing。
- `/gaps` 展示素材缺口和 creativeIngredients 要素缺口。

验收：

- 能稳定展示“素材不足”的 case。
- 缺口不只说“缺使用过程”，还要说“缺真人近脸上脸试用 / 妆前妆后 / 信任元素”。

### M4：补全策略与结果生成

目标：输出可评审的脚本、分镜、时间线和包装建议。

负责人建议：AI / 前端 / 视频同学。

范围：

- `gapRepairPlanner` 根据不同 gap 输出补全策略。
- `timelineGenerator` 输出脚本、分镜、TimelineItem。
- `/result` 展示脚本、分镜、时间线、包装建议。
- 补全策略优先做文案/字幕、标题卡、卖点卡、对比卡、CTA 卡、手部演示、风格建议。

验收：

- 至少输出脚本 + 分镜 + 时间线草案。
- 每个补全策略都能追溯到某个缺口。

### M5：Web demo 和视频渲染 adapter

目标：让评委看到可播放 demo 或准视频时间线。

负责人建议：前端 + 视频渲染同学。

范围：

- 将 `TimelineItem[]` 映射到 HyperFrames-first render adapter。
- 先做标题卡、卖点卡、对比卡、CTA 卡、图片裁切和字幕。
- 后续再考虑导出 MP4。

验收：

- `/result` 能预览 15 秒左右 demo。
- 能说明每段来自哪个样例结构槽位。

### M6：冲分能力

目标：补 P1 和加分项，但不破坏 P0 稳定性。

优先级：

1. 多版本生成：高点击版 / 高转化版 / 高节奏版。
2. 人工可调：hook、卖点顺序、节奏、包装风格。
3. 自然语言改片：输出 timeline patch。
4. AIGC 背景/封面补全：必须标注 AIGC，不能默认生成真人替代。

## 6. 队友分工建议

| 角色 | 负责模块 | 关键文件 |
|---|---|---|
| 产品/答辩 | demo case、评分证据、答辩话术 | `docs/PROJECT_PLAN.md`、`docs/scoring-matrix.md`、`docs/DEMO_TARGET.md` |
| 前端 | 页面流程和可视化 | `apps/web/app/*`、`apps/web/components/*` |
| 后端 | API 串联和视频处理 | `apps/api/src/routes/*`、`apps/api/src/services/*` |
| 协议/AI | shared schema、LLM prompt、结构抽取 | `packages/shared/src/*`、`docs/PROMPTS.md`、`apps/api/src/services/llmProvider.ts` |
| 视频渲染 | HyperFrames-first preview / MP4 | render adapter 待建 |
| 测试/集成 | typecheck/build、demo 稳定性、素材管理 | `package.json`、`turbo.json`、`.github/workflows/*`、`seed_assets/raw_videos` |

## 7. Demo 主案例建议

当前仓库已有多条 seed videos，包括：

```txt
huaxizi.mp4
macbook_neo.mp4
youlemei.mp4
feihenaifen.mp4
tanwanlanyue.mp4
guojiao1573.mp4
bangbaoshi.mp4
chanel_makeup.mp4
chanel_makeup_2.mp4
chocolate_mud_pie.mp4
flattened_croissant.mp4
TVC.mp4
YVES SAINT LAURENT .mp4
```

建议 demo 分两类：

1. 美妆/人设要素 case：用 `huaxizi.mp4`、`chanel_makeup.mp4`、`chanel_makeup_2.mp4` 展示 creativeIngredients。
2. 电商通用 case：用 `youlemei.mp4`、`feihenaifen.mp4`、`bangbaoshi.mp4` 等展示结构迁移和素材缺口补全。

主展示最好故意给不完整素材，因为这能稳定展示缺口识别和补全能力。

## 8. 工程规则

- `packages/shared` 是协议源头，改协议必须同步改 Zod schema。
- 所有 AI 输出必须最终落到结构化协议，不能只返回自然语言。
- 每个 AI 模块必须保留 mock fallback，答辩现场不能依赖真实模型才可演示。
- 火山方舟 Doubao 可作为 real mode provider；真实 key 只放本地 `.env`，不得入库。
- 涉及 AIGC 人物、模特、声音时必须保守，不默认生成真人替代。
- 大视频文件已经直接放入 Git；后续如继续增加 50MB+ 文件，应考虑 Git LFS 或压缩版本。

## 9. 近期优先级

下一步按这个顺序推进：

1. 打通 seed video 选择或上传入口。
2. 接 ffprobe/FFmpeg，替换 `analyzeVideoMock` 的元信息和关键帧。
3. 把 `/analyze -> /graph -> /adapt -> /gaps -> /result` 串成一个真实前端流程。
4. 用一个固定 demo case 跑通完整链路。
5. 加 HyperFrames-first video render preview。
6. 加多版本与人工调整。

不要现在优先做：

- 大而全的剪辑器。
- 复杂 timeline 拖拽编辑。
- 训练模型。
- 依赖现成产品直接生成结果。
- 默认 AIGC 真人替代。

## 10. 验收标准

阶段性验收必须满足：

```txt
pnpm typecheck
pnpm build
```

答辩验收必须能展示：

- 样例视频基础解析。
- 脚本/节奏/包装/creativeIngredients 结构拆解。
- 新商品和用户素材输入。
- 素材槽位匹配。
- 素材缺口和要素缺口。
- 补全策略。
- 脚本、分镜、时间线。
- Web demo 或可播放视频 preview。
- 安全边界和 AI 工具使用说明。

## 11. 相关文档

- `docs/product-requirements.md`：需求和 P0/P1 范围。
- `docs/scoring-matrix.md`：评分证据矩阵。
- `docs/SCORING_EXECUTION_PLAN.md`：按评分项拆执行策略。
- `docs/TASK_BREAKDOWN.md`：任务拆分。
- `docs/ARCHITECTURE.md`：AI 架构。
- `docs/TOOL_PROTOCOL.md`：工具协议。
- `docs/DEMO_TARGET.md`：演示流程。
- `docs/safety-and-ai-tools.md`：AI 工具与安全边界。
- `docs/AI_CONTEXT.md`：给 AI 助手和协作者的上下文。
- `docs/TEAM_HANDOFF.md`：交接说明。
