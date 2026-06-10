# 项目结构文档 / Project Structure

> 爆款结构迁移引擎（Viral Struct AI）的代码地图、数据流和模块职责。
> 面向：新加入的开发者 / 队友交接 / 答辩前快速理解全局。

---

## 1. 一句话定位

从**优质样例短视频**中抽取「Hook / 节奏 / 卖点推进 / 包装 / 镜头槽位」等可迁移的**结构协议**，再迁移到**新商品 + 用户素材**上，自动识别素材缺口、补全缺口、生成脚本/分镜/时间线和多版本创意方案。

> 重点不是"凭空生成视频"，而是**结构方法的迁移**。

---

## 2. 顶层目录（Monorepo）

```
viral-struct-ai/
├── scripts/              # ★ Python 视频理解管线（stage1，离线跑，Doubao VLM）
├── packages/
│   └── shared/           # 协议层：TypeScript 类型 + Zod schema（前后端共享）
├── apps/
│   ├── api/              # 后端：Express + 迁移引擎 stage2（TS，在线）
│   └── web/              # 前端：Next.js（TS，用户交互）
├── prompts/              # LLM prompts（视频理解 / 素材 / 迁移）
├── seed_assets/          # 样例数据：原始视频 + 分析产物 + 素材库
├── docs/                 # 文档 + ADR 决策记录
├── tests/                # Python 单元测试（unittest）
├── .github/workflows/    # CI（pnpm build/typecheck + Python unittest）
├── requirements.txt      # Python 依赖（scipy/opencv/av/ruptures）
├── package.json          # pnpm workspace 根（turbo dev/build/test）
└── pnpm-workspace.yaml + turbo.json
```

**技术栈**：

| 层 | 技术 |
|---|---|
| 视频理解（stage1） | Python · Doubao/火山方舟 VLM · ffmpeg/ffprobe · PyAV · OpenCV · scipy · ruptures |
| 协议 | TypeScript + Zod |
| 后端（stage2） | Node.js · Express · openai SDK（调 Doubao OpenAI 兼容端点） |
| 前端 | Next.js 15 · React · Zustand（状态，localStorage 持久化） |
| 编排 | pnpm workspace + Turborepo |

---

## 3. 端到端数据流

```
样例视频 (raw_videos/*.mp4)
   │
   ▼  【STAGE 1 · Python 离线 · scripts/】 ← 深度语义理解
rough_scan(段落结构) → fine_scan v1(逐峰语义 + migrationContract)
   → boundary_scan(转场) → ASR(语音) → media_technical(规格)
   │
   ▼  extract_structure_graph.py（桥接，纯规则）
structure_graph.json  ← ViralStructureGraph (v1)
   segments + shotSlots + migrationContract(intent/sourceInstance/acceptanceCriteria)
   │
   ▼  【STAGE 2 · TS 后端 · apps/api/】 ← 迁移生成
新商品 brief + 用户素材(AssetCard[]) 一起进入：
   ① slotMatcher    哪张素材演哪个槽位
   ② gapRepairPlanner 缺口识别 + 补全策略
   ③ timelineGenerator 脚本 + 分镜 + 时间线 + 包装
   ④ qualityEvaluator 质量自检
   │
   ▼  【前端 · apps/web/】
一键演示 证据链  或  01 样例解析 → 02 素材输入 → 03 缺口诊断 → 04 成片编译（同一页面 / 路由 `/`，左侧步骤导航切换） 标准流程
```

**核心分界**：Python（stage1，离线，深度 VLM 理解）和 TS（stage2，在线，迁移生成）是**两套独立运行的东西**，通过 `structure_graph.json`（force-add 进 git 的产物）衔接。

---

## 4. 模块详解

### 4.1 `scripts/` — Python 视频理解管线（stage1）

> 离线跑，产出喂给 stage2 的 `structure_graph.json`。是整个引擎的地基。

| 文件 | 职责 |
|---|---|
| **doubao_rough_scan.py** | Stage1 粗扫：Doubao VLM 把整片切成语义 content block（段落结构）。含 curl HTTP 层 + 重试 + 并发信号量 |
| **doubao_fine_scan.py** | Stage2 细扫：逐 block 跑 visual peak detection + 每峰语义。`--prompt-version v1` 产出 migrationContract |
| **doubao_boundary_scan.py** | Stage1.5 边界微观扫描：转场 microscope clip 定位 |
| **visual_peak_detector.py** | 代码层视觉峰检测：DIS 光流 + MOG2 前景 + HSV 直方图 + ruptures PELT regime change（4 通道） |
| **video_tools.py** | ffmpeg 命令构造（preview 转码 / clip 切片 / peak window） |
| **extract_speech.py** | ASR：Volcengine Doubao flash 端点，产出 speech_transcript |
| **extract_media_technical.py** | ffprobe 元信息（aspectRatio/fps/duration/codec） |
| **augment_audio_beat_map.py** | beat_this 输出的 v1→v2 后处理（firstDownbeat/tempo stability） |
| **path_layout.py** | ★ 统一路径布局：`analysis_paths(video_id)` + `apply_video_id_defaults`（多样例不踩坑） |
| **build_analysis_manifest.py** | 生成 analysis_manifest.json（stage1 产物索引） |
| **extract_structure_graph.py** | ★ 桥接层：rough+fine+boundary → ViralStructureGraph（纯规则，零 LLM） |
| **analyze_asset_library.py** | 素材库分析：Doubao 多模态 → AssetCard[]（离线批量版） |
| **assemble_timeline.py** | Stage1.5 时间线汇总 |
| **validate_structure_graph.py** | structure_graph 轻量校验（镜像 schema） |
| **compare_fine_scan.py** | A/B 对比评测 harness（vs ground truth） |

### 4.2 `packages/shared/src/` — 协议层

| 文件 | 职责 |
|---|---|
| **types.ts** | 全部 TS 类型：ViralStructureGraph / ShotSlotNode(+migrationContract) / AssetCard / SlotMatch / GapRepair / TimelineItem / QualityReport |
| **schemas.ts** | 对应 Zod schema（运行时校验，前后端共用） |
| **index.ts** | 导出 |

### 4.3 `apps/api/src/` — 后端迁移引擎（stage2）

**入口**：`index.ts`（Express，端口 4000，`dotenv/config` 读 `apps/api/.env`）

**路由** `routes/`：

| 路由 | 端点 | 作用 |
|---|---|---|
| videos.ts | `/api/videos` | seed 列表 / 上传 / **真实解析**（ffprobe+ffmpeg） |
| structure.ts | `/api/structure` | 结构图谱抽取（优先预计算 artifact） |
| assets.ts | `/api/assets` | 素材分析（图片走 Doubao 多模态） |
| slots.ts | `/api/slots` | 槽位匹配 |
| gaps.ts | `/api/gaps` | 缺口识别 + 补全 |
| timeline.ts | `/api/timeline` | 时间线生成 + 自然语言改片(mock) |
| quality.ts | `/api/quality` | 质量评估 |
| demo.ts | `/api/demo` | **一键 demo 编排**（串调全链路 + evidence chain） |

**服务** `services/`：

| 服务 | 作用 |
|---|---|
| **videoAnalyzer.ts** | 01 样例解析 核心：ffprobe 元信息 + ffmpeg 抽 5 关键帧 + 均匀切镜头(占位) + 手动字幕(无 ASR) |
| **structureExtractor.ts** | 结构来源三选一优先级：**预计算 artifact(我的 stage1) > 规则抽取 > mock** |
| scanStructureGraphLoader.ts | 加载 + Zod 校验 stage1 的 structure_graph.json |
| **assetAnalyzer.ts** | 素材多模态分类 + `analyzeAssetsWithFallback`（LLM→文件名规则降级） |
| assetLibraryLoader.ts | 加载预置素材库 asset_cards.json |
| **slotMatcher.ts** | `matchSlots`(规则) + `matchSlotsLLM`(judge) + WithFallback |
| **gapRepairPlanner.ts** | `planGapRepairs` + `planGapRepairsLLM`(拍摄规格) + WithFallback |
| **timelineGenerator.ts** | `generateTimelineMock` + `generateTimelineLLM`(逐段脚本) + WithFallback |
| **qualityEvaluator.ts** | 6+1 维度真实算分 |
| **demoShowcase.ts** | 写死的 demo case 数据（康师傅冰红茶 + macbook_neo） |
| **llmProvider.ts** | LLM gate（缺 key 则 throw → 被 fallback 接住） |
| videoPaths.ts / visualIngredientExtractor.ts | 路径解析 / 视觉配料提取 |

### 4.4 `apps/web/` — 前端（Next.js，端口 3000）

**页面** `app/`：

| 页面 | 路由 | 用户做什么 |
|---|---|---|
| page.tsx | `/` | 首页：单页应用入口（左侧步骤导航切换） |
| 一键演示 | 一键演示（按钮，URL `/demo` 永久重定向到 `/`） | **一键评审演示**（全预置，点一个按钮看完整证据链） |
| 步骤 01 · 样例解析 | 01 样例解析 | 步骤1：选 seed / **上传视频** + 粘字幕 → 真实解析 |
| 步骤 01 · 样例解析 | 01 样例解析（结构图/上下对位在同一步内） | 步骤2：结构图谱（段落/槽位/节奏/包装） |
| 步骤 02 · 素材输入 | 02 素材输入 | 步骤3：改商品 brief + **上传图片素材** |
| 步骤 03 · 缺口诊断 | 03 缺口诊断 | 步骤4：槽位匹配 + 缺口板 |
| 步骤 04 · 成片编译 | 04 成片编译 | 步骤5：时间线 + 多版本 + 自然语言改片 + 质量 |

**组件** `components/`：VideoAnalysisPanel · StructureGraphMock · AssetAdaptPanel · GapBoard · TimelineView · QualityReportPanel · VisualTimelinePreview · DemoShowcasePanel · ScoreMap

**状态**：`lib/workflowStore.ts`（Zustand，持久化 localStorage；两条路径共享同一份 store，内置默认康师傅 brief）

### 4.5 `prompts/` — LLM Prompts

| 目录 | 文件 |
|---|---|
| video_understanding/ | rough_structure_scan_v0 · fine_structure_scan_**v0/v1** · peak_micro_scan_v0 · boundary_micro_scan_v0 |
| asset_library/ | asset_card_v0/v1 |
| migration/ | slot_alignment_v0 · gap_spec_v0 · script_generation_v0 |

> v1 prompt 相对 v0 的关键差异：fine_structure_scan **追加 migrationContract**（intent/sourceInstance/acceptanceCriteria）。

### 4.6 `seed_assets/` — 样例数据

```
seed_assets/
├── raw_videos/           # 13 个原始样例（macbook_neo / chocolate_mud_pie / 花西子 / 国窖1573 ...）
├── processed_videos/     # preview 转码（5fps/720w，给 rough scan 上传）
├── analysis/<video_id>/  # stage1 产物（rough/fine/boundary/media/structure_graph）
│                         #   ⚠️ gitignored，仅 structure_graph.json 被 force-add
└── asset_libraries/<id>/ # 用户素材库（per-target-product，如 kangshifu_demo）
```

**当前 checked-in 的完整样例**：`macbook_neo`（3C/16:9/英文 TVC）+ `chocolate_mud_pie`（食品/9:16/中文带货，v1 链路）。

---

## 5. 两条用户路径

| | 一键演示 路径 | 标准 5 步路径 |
|---|---|---|
| 受众 | 评委演示 | 展示产品形态 |
| 输入 | 几乎零（全预置康师傅+macbook） | 可上传自己的视频/素材 |
| LLM | `*WithFallback`（LLM 优先，降级规则） | main 上偏规则（PR #38 升级 LLM fallback） |
| 价值 | 完整证据链 + 评分映射 | 真交互（真 ffmpeg + 真 Doubao 图片分类） |

---

## 6. 关键架构设计

1. **Python 离线 vs TS 在线的双层**：深度 VLM 理解（stage1，Python）跑得慢、离线、只对预处理样例；轻量技术解析（01 样例解析，TS ffmpeg）实时、对任意上传。两者通过 `structure_graph.json` 衔接，`structureExtractor` 优先用 stage1 深产物。
2. **迁移协议 migrationContract**：每个 shotSlot 带 `intent`(KEEP 可迁移意图,禁产品名) / `sourceInstance`(SWAP 源片实例) / `acceptanceCriteria`(可接受替代)。这是"迁移结构方法而非复制画面"的协议载体。
3. **全链路 fallback**：每个 LLM 阶段都有 `xxxWithFallback`（LLM 失败降级规则/模板），并标注 source（`llm_judge` / `rule_based` / `template`）。**无 key 也能完整演示**。
4. **HTTP 传输用 curl**：Python stage1 的 Doubao 调用走 curl（Schannel TLS），绕过 Windows OpenSSL 大上传 SSL-EOF。
5. **路径布局 path_layout**：`--video-id` 自动 derive 所有路径，防多样例污染。

---

## 7. 真实 vs 演示边界（答辩诚实清单）

**🟢 真实**：ffprobe 元信息 + ffmpeg 关键帧（01 样例解析）· Doubao 图片多模态分类（02 素材输入）· stage1 structure_graph + 27 迁移契约 · ASR（Volcengine，离线验证 0-error）

**🔴 占位/降级**：01 样例解析 镜头分段（均匀切模板）· 字幕（无在线 ASR，手动粘）· 自然语言改片（前端 3 关键词字符串匹配）· 多版本（无并排 diff）· main 上 slot/gap/timeline（规则版，PR #38 升级 LLM）· 视频素材上传（只看文件名）

**不 claim**：MP4 导出 · 完整 ASR 主流程 · 完整智能剪辑器 · Seedance/GPT Image 真接入 · 真实点击率/转化率数据

---

## 8. 关键文件速查

| 想找… | 看这里 |
|---|---|
| 视频怎么被理解的 | `scripts/doubao_*_scan.py` + `visual_peak_detector.py` |
| 迁移协议定义 | `packages/shared/src/types.ts`（ViralStructureGraph） |
| stage1 → stage2 桥接 | `scripts/extract_structure_graph.py` |
| 一键 demo 怎么编排 | `apps/api/src/routes/demo.ts` |
| 01 样例解析 怎么解析 | `apps/api/src/services/videoAnalyzer.ts` |
| 结构来源优先级 | `apps/api/src/services/structureExtractor.ts` |
| 前端流程状态 | `apps/web/lib/workflowStore.ts` |
| 评分映射 | `docs/scoring-map.md` |
| 架构决策记录 | `docs/DECISIONS/*.md` |
