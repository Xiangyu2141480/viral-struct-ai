# Viral Struct AI / 爆构引擎

面向营销短视频的 **爆款结构迁移 + 素材缺口补全 + 时间线视频生成** 平台。

本项目不是做一个通用剪辑器，也不是简单让大模型写脚本，而是把优质样例短视频中的创作方法抽象成可迁移的结构协议，再迁移到新的商品、主题或用户素材中。

## 一句话定位

> 从爆款样例中抽取 Hook、节奏、卖点推进、包装样式和镜头槽位，再根据新商品与用户素材自动匹配、识别缺口、补全表达，并生成脚本、分镜、时间线和可播放 demo。

## 当前工程状态

已经完成：

- monorepo 项目骨架
- `apps/web` 前端页面骨架
- `apps/api` 后端 API 骨架
- `packages/shared` 共享类型与结构协议
- `packages/remotion-video` Remotion demo 包骨架
- GitHub Actions CI 基础配置
- 本地 `pnpm typecheck` 和 `pnpm build` 已通过
- 结构迁移项目文档与 GitHub 任务体系初始化

## 技术栈

- Frontend: Next.js / React / TypeScript
- Backend: Node.js / Express / TypeScript
- Shared Protocol: TypeScript + Zod
- Video: FFmpeg / ffprobe / Remotion
- AI: LLM / VLM / ASR / Agent
- Repo: pnpm workspace + Turborepo

## 推荐启动方式

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate

pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm build
pnpm dev
```

## 核心数据流

```txt
Sample Video
  ↓
VideoAnalysis
  ↓
ViralStructureGraph
  ↓
New Content + User Assets
  ↓
AssetCard[]
  ↓
SlotMatch[] + MaterialGap[]
  ↓
GapRepair[]
  ↓
Script + Storyboard + TimelineItem[]
  ↓
Remotion Preview / MP4 Demo
  ↓
QualityReport
```

## 核心创新点

1. **ViralStructureGraph**  
   把短视频抽象成 Hook、痛点、卖点、证明、CTA、节奏、包装、镜头槽位和转场关系。

2. **Structure Slot Matching**  
   不是先写脚本再硬匹配素材，而是先定义每个结构槽位需要什么素材，再匹配用户素材。

3. **Material Gap Detection**  
   明确识别缺少开头吸引镜头、商品特写、使用过程、对比镜头、CTA 镜头等问题。

4. **Gap Repair Planner**  
   通过标题卡、卖点卡、对比卡、CTA 卡、裁切放大、字幕补全、AIGC 背景等方式补足素材不足。

5. **Explainable Timeline Protocol**  
   输出不是纯文本，而是可以被 Remotion 或 FFmpeg 消费的时间线协议。

## 评分目标

目标不是“能生成一个视频”而已，而是尽量覆盖评分表所有得分点：

- P0 基础闭环：25 分
- P0 素材缺口识别与补全：20 分
- P0 可视化与结果验证：20 分
- P1 进阶创作能力：20 分
- 人机协同与整体完成度：15 分
- 加分项：最高 10 分

详细见：

- `docs/TEAM_HANDOFF.md`
- `docs/AI_CONTEXT.md`
- `docs/SCORING_EXECUTION_PLAN.md`
- `docs/DEMO_TARGET.md`
- `docs/ISSUE_INDEX.md`

## 安全边界

- 不复刻样例内容，只迁移结构方法。
- 不复制他人肖像、品牌元素、音乐原片段和受版权保护的画面。
- 用户上传素材默认视为用户有使用权。
- 营销文案中的功效、价格、排名、认证等强事实必须有用户输入或证据来源。
- API Key 只允许放在服务端 `.env`，不得提交到仓库。
