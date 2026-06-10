# Viral Struct AI / 爆款结构迁移引擎

Viral Struct AI 是一个面向营销短视频创作的 AI 平台原型：从优质样例视频中拆解可迁移的创作结构，再迁移到新的商品、主题和素材中，生成可解释的脚本、分镜、时间线草案和 Web 视觉预览。

本项目的重点不是复刻样例内容，也不是做完整剪辑器，而是展示“样例理解 -> 结构抽象 -> 素材适配 -> 缺口补全 -> 结果生成”的可验证闭环。

## 当前可演示能力

- 真实样例输入与基础解析：seed video / upload、ffprobe 元信息、封面、关键帧、手动字幕 fallback。
- 结构抽取：`ViralStructureGraph`，包含脚本段落、节奏、包装、镜头槽位、migration contract、rough/fine scan artifact fallback。
- 新内容与素材输入：商品 brief、康师傅冰红茶 demo 素材库、`AssetCard` 素材理解协议。
- Asset Manager 数据层：素材解析、视频关键帧、质量评分、slot affordance、coverage matrix、Asset Evidence 输出，并提供 `AssetSupplyContext` 作为 UI / SlotMatcher / GapRepairPlanner / Video Agent 的素材供给证据合同。
- 素材适配：`SlotMatch`、`MaterialGap`、`GapRepair`，支持 LLM enhanced 路径和 deterministic fallback。
- 结果生成：脚本、分镜、`TimelineItem[]`、包装建议、Web 视觉预览。
- 可解释展示：Generation Trace、Migration Evidence、Quality Report。
- 多版本生成：高点击版、高转化版、高质感版，fallback 下也有真实差异。
- 自然语言改片：`/api/timeline/apply-edit` rule-based patch，支持 hook、商品信息、字幕、节奏、CTA 五类指令。

## 技术栈

- Frontend: Next.js / React / TypeScript
- Backend: Node.js / Express / TypeScript
- Shared Protocol: TypeScript + Zod
- Video Analysis: FFmpeg / ffprobe / Python rough/fine scan scripts
- AI Provider: OpenAI-compatible LLM client, Volcengine Doubao optional, deterministic fallback by default
- Workspace: pnpm workspace + Turborepo

## 本地启动

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --no-frozen-lockfile

pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

默认入口：

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- 主评审演示：打开 `http://localhost:3000/`，点击「一键演示」按钮（`/demo` 现已永久重定向到 `/`）
- 标准产品流程：01 样例解析 → 02 素材输入 → 03 缺口诊断 → 04 成片编译（同一页面 / 路由 `/`，左侧步骤导航切换）

## 核心流程

```txt
样例视频分析
  -> 结构抽取
  -> 内容 brief 输入
  -> 素材适配
  -> 槽位匹配
  -> 缺口识别
  -> 缺口补全
  -> timeline 生成
  -> 多版本生成
  -> 自然语言改片
  -> 质量评估
```

## 关键页面

应用现已合并为单页（路由 `/`），通过左侧步骤导航切换；下表的「位置」对应单页内的步骤。

| 位置 | 用途 |
|---|---|
| 一键演示 | 主评审路径，一键展示 macbook_neo 样例到康师傅冰红茶的迁移闭环 |
| 步骤 01 · 样例解析 | 选择 seed / 上传视频 / 手动字幕，展示真实视频元信息和关键帧 |
| 步骤 01 · 样例解析 | 展示样例结构图谱、rough/fine scan 结构、migration contract（结构图/上下对位在同一样例步骤内） |
| 步骤 02 · 素材输入 | 输入商品 brief，加载或分析 `AssetCard` 素材 |
| 步骤 03 · 缺口诊断 | 展示 slot matching、material gaps、gap repairs 和 fallback source |
| 步骤 04 · 成片编译 | 展示脚本、分镜、timeline、Web 预览、Generation Trace、Migration Evidence、Variant Diff、自然语言改片 |

## 关键 API

| API | 用途 |
|---|---|
| `GET /api/videos/seeds` | 列出 seed videos |
| `POST /api/videos/seeds/analyze` | 解析 seed video |
| `POST /api/videos/upload` | 上传视频 |
| `POST /api/structure/extract` | 从 `VideoAnalysis` / artifact 抽取结构图 |
| `GET /api/assets/libraries/:libraryId` | 加载预生成素材库 |
| `POST /api/assets/analyze` | deterministic 素材分析，可选 VLM enrichment，默认关闭 |
| `POST /api/assets/manager/analyze-batch` | 归一化旧 AssetCard，输出 Asset Manager report |
| `POST /api/assets/manager/coverage` | Asset Manager coverage matrix、library report、normalized AssetCard，并包含 contextual coverage |
| `POST /api/assets/manager/asset-supply-context` | 输出 `asset-supply-v1` 素材供给上下文，不生成 fallback card 或 repair strategy |
| `POST /api/assets/manager/video-agent-bundle` | legacy alias，返回 `asset-supply-v1` response |
| `POST /api/slots/match` | `matchSlotsWithFallback` |
| `POST /api/gaps/repair` | `planGapRepairsWithFallback` |
| `POST /api/timeline/generate` | `generateTimelineWithFallback` |
| `POST /api/timeline/apply-edit` | 自然语言改片 rule-based patch |
| `POST /api/quality/evaluate` | 质量评估 |
| `POST /api/demo/run` | 主演示闭环 |

## 安全边界

- API key 只能通过本地环境变量注入，不提交真实 key。
- LLM / optional VLM / ASR 失败时必须 fallback，页面显示 source 和 warning。
- 只迁移样例的结构方法，不复制原视频内容、音乐、人物肖像或品牌表达。
- 当前 Remotion package 仍是 placeholder，不把 MP4 导出作为本阶段主交付能力。
- 当前自然语言改片是 rule-based timeline patch，不是完整智能剪辑器。
- Asset Manager deterministic 是主路径；optional VLM 默认关闭，不是主 demo 依赖。
- 当前未接入 SAM2 / GroundingDINO / SigLIP2 / VideoRAG，也未完成完整长视频 temporal grounding。

## 交付文档

- `docs/ARCHITECTURE.md`
- `docs/PROJECT_PLAN.md`
- `docs/DEMO_SCRIPT.md`
- `docs/scoring-map.md`
- `docs/final-delivery.md`
- `docs/safety-and-ai-tools.md`
- `docs/asset-manager-ui-contract.md`
- `docs/asset-manager-video-agent-contract.md`
- `docs/TOOL_PROTOCOL.md`
