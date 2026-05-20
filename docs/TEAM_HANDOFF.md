# Team Handoff / 给队友的项目交接说明

## 1. 我们现在已经完成了什么

当前已经完成的是 **参赛项目的工程地基和任务系统**：

- GitHub 仓库已创建：`viral-struct-ai`
- monorepo 骨架已完成
- 前端、后端、共享协议、Remotion 包已经拆好
- 本地 `pnpm install`、`pnpm typecheck`、`pnpm build` 已通过
- CI 已修复 pnpm 版本冲突和 workspace 依赖构建顺序问题
- 已建立项目文档体系
- 已建立 milestones、labels 和 18 个核心 issues

当前项目还不是最终 demo。接下来要把 mock 链路逐步替换成真实能力。

## 2. 项目最终要做成什么

最终 demo 要展示一个完整闭环：

```txt
上传爆款样例视频
  ↓
系统展示基础解析：时长、比例、封面、镜头数、字幕概览
  ↓
系统抽取样例结构：脚本结构、节奏结构、包装结构
  ↓
输入新商品和不完整素材
  ↓
系统识别素材是否能支撑样例结构
  ↓
系统指出哪些结构槽位缺素材
  ↓
系统给出补全策略
  ↓
系统生成新脚本、分镜、时间线和可播放 demo
  ↓
用户可以调整 Hook、卖点顺序、节奏、包装风格
  ↓
系统生成多版本结果
```

## 3. 选择的拿奖方向

我们选择的是：

> 营销类短视频 + Motion Graph 可解释结构迁移

不要做通用剪辑器，也不要做纯脚本生成器。

评委需要看到的是：

- 从样例中抽出了什么结构
- 这个结构如何迁移到新商品
- 用户素材哪里不够
- 系统如何补足缺口
- 最终如何生成时间线和视频 demo

## 4. 核心模块

### 4.1 Video Analyzer

负责样例视频基础解析。

输入：

```txt
sample.mp4
```

输出：

```txt
duration / fps / resolution / cover / keyframes / shots / transcript
```

### 4.2 Structure Extractor

负责从样例中抽结构。

输出：

```txt
ViralStructureGraph
```

至少包含：

- 脚本结构：Hook / 痛点 / 卖点 / 证明 / CTA
- 节奏结构：镜头频率、快慢段、高潮位置
- 包装结构：字幕密度、标题条、卖点卡、转场、封面风格

### 4.3 Asset Analyzer

负责理解用户上传素材。

每个素材输出：

```txt
AssetCard
```

包含：

- 素材类型
- 空间描述
- 时间动作描述
- 适合的结构槽位
- 质量分
- 是否适合做 Hook / 商品特写 / 使用过程 / 对比 / CTA

### 4.4 Slot Matcher

把结构槽位和素材匹配。

输出：

```txt
matched / partial / missing
```

### 4.5 Gap Repair Planner

负责素材缺口补全。

补全方式优先级：

1. 标题卡补全
2. 卖点卡补全
3. 对比卡补全
4. CTA 卡补全
5. 裁切放大和现有素材复用
6. 字幕和文案补全
7. AIGC 背景或封面补全

### 4.6 Timeline Generator

生成：

- 脚本
- 分镜
- 时间线草案
- 包装方案
- Remotion 可播放 demo

## 5. 当前最重要的开发顺序

不要一开始做高级 UI，也不要一开始做 AIGC 视频生成。

优先顺序：

```txt
1. Mock 全链路跑通
2. 样例视频真实解析
3. ViralStructureGraph 真实抽取
4. 用户素材 AssetCard 分析
5. Slot matching
6. Gap detection
7. Gap repair
8. Timeline generation
9. Remotion preview
10. 多版本和人工可调
```

## 6. 队友开发规则

- 先读 `packages/shared/src` 里的类型，不要随便改协议。
- 所有 AI 输出必须经过 schema 校验。
- 所有核心模块都要支持 mock 模式，保证答辩现场可演示。
- 不要把 API Key、Token、Cookie、真实账号密码写进仓库。
- 不要把项目做成通用剪辑器，始终围绕“样例结构迁移”。
- 新功能要对应 GitHub issue。
- Demo-critical 任务优先级最高。

## 7. 最理想的最终展示结果

最终页面至少包括：

```txt
/analyze   样例视频分析
/graph     结构图谱
/adapt     新内容和素材输入
/gaps      素材缺口识别与补全
/result    脚本、分镜、时间线和视频 demo
```

最终答辩要能一句话说明：

> 我们不是复制爆款视频，而是抽取爆款视频的创作结构，并将其迁移到新商品和用户素材中；当素材不足时，系统会识别结构槽位缺口并自动补全。
