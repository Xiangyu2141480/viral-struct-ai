# ViralStruct AI / 爆构引擎

面向营销短视频的「爆款结构迁移 + 素材缺口补全 + 可解释时间线生成」AI 创作平台。

本仓库不是普通视频生成 demo，而是围绕评分项设计的完整工程骨架：

1. 从样例视频解析基础信息、字幕、镜头和关键帧。
2. 将样例抽象为 `ViralStructureGraph`，包含脚本结构、节奏结构、包装结构和镜头槽位。
3. 输入新商品 / 新主题 / 用户素材，分析素材是否能支撑目标结构。
4. 在结构槽位级别识别缺口，并用包装、字幕、裁切复用、AIGC 背景等策略补全。
5. 输出脚本、分镜、时间线和可播放 demo。
6. 提供迁移过程可视化、质量自检、多版本生成和人工可调能力。

## 推荐仓库名

```txt
viral-struct-ai
```

中文展示名：

```txt
爆构引擎：营销短视频结构迁移与素材补全平台
```

## 技术栈

```txt
apps/web        Next.js + React + TypeScript + TailwindCSS
apps/api        Node.js + Express + TypeScript
packages/shared 结构协议、Zod schema、共享类型
packages/remotion-video  Remotion 视频预览 / 渲染组件
FFmpeg / ffprobe 视频基础解析
LLM / VLM / ASR 通过 provider adapter 接入
```

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm dev
```

> 不要把任何真实 API Key 提交到仓库。题目中给出的 key 建议立即轮换，并只放在服务端 `.env` 中。

## 本项目的核心中间层

```txt
样例视频 → ViralStructureGraph → Slot Matching → Gap Repair → Timeline Protocol → Remotion Demo
```

## 评分覆盖

详见：

- `docs/TASK_BREAKDOWN.md`
- `docs/SCORING_MAP.md`
- `docs/DELIVERY_CHECKLIST.md`

## 交付物

最终应交付：

```txt
1. 代码仓库
2. 演示视频
3. 视频产物 case
4. 项目说明文档
```

项目说明文档必须包含：

```txt
整体 AI 架构
工具协议
安全边界
AI 工具使用说明
```
