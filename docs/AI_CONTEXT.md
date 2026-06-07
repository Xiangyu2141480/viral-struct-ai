# AI Context / 给队友 AI 助手看的上下文

请所有参与开发的 AI 助手先阅读本文件。目标是避免不同 AI 各做各的，导致项目方向发散。

## 1. 项目身份

项目名称：

```txt
Viral Struct AI / 爆构引擎
```

项目任务：

```txt
爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台
```

项目方向：

```txt
营销短视频结构迁移
```

不要把项目做成：

- 通用视频编辑器
- 纯文案生成器
- 纯 AIGC 视频生成器
- 纯竞品调研文档
- 只上传素材然后让模型生成结果的黑盒工具

## 2. 当前工程事实

- 仓库是 pnpm workspace + Turborepo。
- 前端在 `apps/web`。
- 后端在 `apps/api`。
- 共享协议在 `packages/shared`。
- 旧视频渲染包已移除；视频最后一公里不再绑定旧 renderer，后续优先评估 HyperFrames + FFmpeg-backed render adapter。
- 当前本地 typecheck 和 build 已通过。
- CI 中需要先 build `@viral-struct/shared`，否则 API / Web 包无法解析共享类型。

## 3. 核心中间层

所有能力都要围绕：

```txt
ViralStructureGraph
```

不要让 LLM 直接输出散乱文本。

推荐链路：

```txt
VideoAnalysis
  -> ViralStructureGraph
  -> AssetCard[]
  -> SlotMatch[] + MaterialGap[]
  -> GapRepair[]
  -> TimelineItem[]
  -> QualityReport
```

`ViralStructureGraph` 现在还必须包含：

```txt
creativeIngredients
```

这一层也可以在产品话术中称为 visualTraits，用于描述样例视频中的可迁移创作要素，例如真人出镜、脸部近景、上脸试用、妆效对比、手部试色、柔光画面、干净背景、场景风格和信任建立方式。

重要边界：

```txt
creativeIngredients 不是颜值识别，不允许做 beauty_score、美女程度、颜值评分等字段或结论。
系统识别的是中性的画面创作条件、人物出镜方式、动作方式、场景风格和信任建立方式。
```

这些要素必须参与 ShotSlotNode 的素材要求、AssetCard 的素材理解、SlotMatch 的匹配评分、MaterialGap 的缺口识别、GapRepair 的补全策略，以及 `/graph` 和 `/gaps` 的可视化展示。

## 4. 必须优先覆盖的评分点

优先级从高到低：

1. P0 基础闭环
2. 素材缺口识别
3. 素材缺口补全
4. 迁移过程可视化
5. 最终 demo 可播放
6. 包装生成
7. 多版本生成
8. 人工可调
9. 自然语言改片

## 5. 不要做的事

- 不要过早实现复杂时间线编辑器。
- 不要过早做复杂转场库。
- 不要把大量时间花在训练模型上。
- 不要依赖线上模型才能跑 demo。
- 不要生成没有证据的营销强断言，比如“销量第一”“全网最低”“医用级”等。
- 不要提交任何密钥。

## 6. 推荐实现策略

每个 AI 模块都应该有两种模式：

```txt
mock mode
real mode
```

mock mode 用于保证答辩稳定。

real mode 用于展示技术能力。

## 7. 结构迁移的关键定义

样例视频不是被复制，而是被抽象为：

- 段落结构
- 镜头槽位
- 节奏模式
- 包装模式
- 转场策略
- 封面风格
- 可迁移规则

新视频不是复刻样例内容，而是复用其创作方法。

## 8. 最重要的展示逻辑

最终页面必须让评委看见：

```txt
样例结构是什么
这些结构映射到新内容哪里
哪些槽位缺素材
系统为什么认为缺
系统选择了什么补全策略
最终时间线如何生成
```

新增 creativeIngredients 后，还必须让评委看见：

```txt
样例中有哪些爆款视频要素
这些要素需要什么用户素材
当前素材满足了哪些要素
缺失的人物出镜、动作、对比或场景风格如何补全或降级
```

## 9. 推荐 Prompt 原则

要求 LLM 输出 JSON，并说明：

- role
- purpose
- duration
- transferRule
- requiredAsset
- fallbackStrategies
- evidence
- risk

输出后必须用 Zod 校验。

## 10. 一句话项目解释

> Viral Struct AI learns the transferable structure of a viral marketing short video, maps it to a new product and incomplete user materials, repairs missing material slots, and generates an explainable timeline-based video demo.
