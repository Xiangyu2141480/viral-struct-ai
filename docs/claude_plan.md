# 爆款结构迁移引擎 — 技术架构与技术栈设计

下面这套架构基于你的比赛任务（P0/P1）、VC-LLM 的启发，以及"营销类视频"的方向定位来设计。我会按**分层架构 → 模块详解 → 技术栈选型 → 数据流 → 部署架构**五个维度展开。

---

## 一、整体架构分层

整个系统按**七层架构**设计，从上到下是：

```
┌─────────────────────────────────────────────────────────────┐
│  L7  前端展示层  (Web UI + 可视化)                            │
├─────────────────────────────────────────────────────────────┤
│  L6  应用服务层  (Node.js / API Gateway)                     │
├─────────────────────────────────────────────────────────────┤
│  L5  Agent 编排层  (LangGraph / 自研 Orchestrator)           │
├─────────────────────────────────────────────────────────────┤
│  L4  核心能力层  (六大核心 Agent)                              │
│  ┌───────┬───────┬───────┬───────┬───────┬───────┐         │
│  │样例解析│结构抽取│素材理解│缺口决策│生成补全│成片合成│       │
│  └───────┴───────┴───────┴───────┴───────┴───────┘         │
├─────────────────────────────────────────────────────────────┤
│  L3  模型服务层  (LLM / VLM / ASR / TTS / T2I / T2V)         │
├─────────────────────────────────────────────────────────────┤
│  L2  基础能力层  (FFmpeg / OpenCV / Remotion)                │
├─────────────────────────────────────────────────────────────┤
│  L1  数据存储层  (PostgreSQL + Redis + Qdrant + MinIO)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、各层模块详解

### L1 — 数据存储层

| 组件 | 用途 | 选型理由 |
|---|---|---|
| **PostgreSQL** | 结构化数据：用户、项目、视频元数据、结构 Schema、生成任务记录 | 成熟稳定，支持 JSONB 存复杂结构 |
| **Redis** | Agent 中间状态缓存、任务队列、prompt cache | 低延迟，比赛 demo 也方便 |
| **Qdrant**（或 Milvus） | 向量数据库：clip embedding、卖点 embedding、爆款样例库 | 开源、自托管简单、过滤能力强 |
| **MinIO**（或本地 FS） | 对象存储：原始视频、切片、生成产物、封面图 | S3 兼容，本地即可跑 |

**关键表结构设计**：

```
samples          (样例视频元数据)
├── structures   (从样例抽取的结构 Schema)
├── shots        (镜头切分结果)
└── annotations  (人工/AI 标注)

projects         (用户的生成项目)
├── user_assets  (用户上传素材)
├── gap_reports  (缺口识别报告)
├── plans        (生成方案：脚本/分镜/时间线)
└── outputs      (成片/分镜图等)

structure_library (结构模板库)
└── slots        (结构槽位定义)
```

---

### L2 — 基础能力层

| 工具 | 用途 |
|---|---|
| **FFmpeg** | 视频切片、转码、合成、字幕烧录、音视频混合 |
| **OpenCV** | 帧差计算、镜头边界检测、构图分析、关键帧提取 |
| **PySceneDetect** | 自动镜头切分（封装好的 OpenCV 方案） |
| **Remotion** | 编程式视频合成（React 语法写视频），用于精细包装控制 |
| **HyperFrames**（可选） | 模板化视频生成（如果时间不够，可作为快速 fallback） |
| **MoviePy** | Python 侧的视频拼接、字幕叠加（轻量任务用） |

**Remotion vs HyperFrames 选型**：
- **优先 Remotion**：自主可控、可解释性强（每一帧都是代码生成的），评分加分项里"工程质量"会受益
- **HyperFrames 做 backup**：如果 Remotion 学习成本太高，用它快速出 demo

---

### L3 — 模型服务层

这层是你能力上限的关键，**所有调用走统一的 ModelGateway 封装**，便于换模型和 A/B 测试。

| 任务 | 推荐方案 | 备注 |
|---|---|---|
| **LLM（主推理）** | 火山方舟 Doubao-Seed-2.0-lite（比赛官方提供） + Claude/GPT-4o 作 fallback | 比赛资源已给，能省 token 钱 |
| **VLM（视频/图像理解）** | Qwen2.5-VL-7B-Instruct（开源自部署）或 GPT-4o（云端） | 用于镜头分类、卖点识别、风格判断 |
| **ASR（字幕提取）** | Whisper-large-v3（本地）或 火山 ASR | 提取样例视频的口播 |
| **TTS（配音生成）** | edge-tts（免费免本地部署）或 火山 TTS | 给生成的脚本配音 |
| **Text Embedding** | bge-m3 或 jina-embeddings-v3 | 卖点/脚本/标签的向量化 |
| **Vision Embedding** | CLIP ViT-L/14（OpenAI）或 EVA-CLIP | 视觉素材的向量化，做 clip-槽位匹配 |
| **T2I（封面/补充画面）** | 即梦 API 或 SDXL 本地 | AIGC 补全 |
| **T2V（视频补全）** | 即梦视频 / Runway / Sora（按预算） | AIGC 视频补全（可选） |

**ModelGateway 封装设计**：
```python
class ModelGateway:
    def llm(self, messages, model="doubao") -> str
    def vlm(self, images, prompt) -> dict
    def asr(self, audio_path) -> List[Segment]
    def tts(self, text, voice) -> bytes
    def embed_text(self, texts) -> np.ndarray
    def embed_image(self, images) -> np.ndarray
    def gen_image(self, prompt, style_ref=None) -> Image
    def gen_video(self, prompt, ref_image=None) -> Video
```

这层封装的好处：评委问"你用了哪些 AI 工具，分别用在哪些环节"时，你直接拿这张表答辩。

---

### L4 — 核心能力层（六大 Agent）

这是你**项目的灵魂**，每个 Agent 对应评分项里的一个或多个任务。

#### Agent 1: 样例解析器（Sample Parser）
- **对应任务**：P0 任务1 样例视频输入与解析
- **职责**：
  - 接收样例视频 → ASR 提取口播 + PySceneDetect 切镜头 + OpenCV 提取关键帧
  - 调 VLM 给每个镜头打标签（特写/中景/远景、产品/人物/场景、动作类型）
  - 输出 `SampleArtifact`：包含时长、镜头数、文本量、镜头序列等基础信息
- **输出 Schema 示例**：
```json
{
  "sample_id": "sample_001",
  "duration": 28.5,
  "shots": [
    {"shot_id": "s1", "start": 0, "end": 2.3, "scale": "close-up",
     "content": "product", "ocr_text": "全网最低价", "asr_text": "..."}
  ],
  "audio": {"has_bgm": true, "bgm_bpm": 128, "asr_full": "..."}
}
```

#### Agent 2: 结构抽取器（Structure Extractor）⭐ 项目灵魂
- **对应任务**：P0 任务2 结构拆解（占 10分，是结构迁移类项目的核心）
- **职责**：从 SampleArtifact 抽取三类结构
  - **脚本结构**：调 LLM 对 ASR 文本做段落分类（hook / 展开 / 卖点1/2/3 / CTA）
  - **节奏结构**：分析镜头时长分布、切换频率、BGM 卡点位置
  - **包装结构**：调 VLM 识别字幕样式、贴纸、转场类型、封面风格
- **关键创新**：定义你自己的 `MarketingStructureSchema`（这是你的差异化）
- **输出**：`StructureGraph` —— 一个有向图，节点是"结构槽位"，边是时序+依赖

```json
{
  "structure_id": "struct_001",
  "template_type": "种草型",
  "slots": [
    {"slot_id": "hook", "type": "pain_point", "duration_range": [2,4],
     "shot_requirement": "close-up", "text_style": "question"},
    {"slot_id": "product_intro", "type": "showcase", "duration_range": [3,5],
     "shot_requirement": "medium-shot", "must_have_product": true},
    {"slot_id": "selling_point_1", ...},
    {"slot_id": "cta", "type": "call_to_action", "duration_range": [2,3],
     "text_style": "imperative"}
  ],
  "rhythm": {"avg_shot_duration": 2.8, "cuts_per_10s": 4.2},
  "packaging": {"subtitle_style": "large_bottom", "transitions": ["zoom_in"]}
}
```

#### Agent 3: 素材理解器（Asset Analyzer）
- **对应任务**：P0 任务3 新内容输入 + P1 任务11 真实素材适配
- **职责**：理解用户上传的素材
  - 切镜头 → 给每个 clip 打标签 → 算 CLIP embedding 入库 Qdrant
  - 借鉴 **VC-LLM 的双分辨率表示法**（spatial + temporal）做 clip 表征
  - 输出 `UserAssetGraph`：每段素材的标签、可用槽位候选、embedding

#### Agent 4: 缺口决策 Agent（Gap Decision Agent）⭐ 项目壁垒
- **对应任务**：P0 任务5+6 素材缺口识别与补全（20分大头）
- **职责**：核心 ReAct 风格 Agent
  - **匹配阶段**：对每个结构槽位，从用户素材库中检索 top-K 候选（CLIP embedding + 标签过滤）
  - **缺口识别**：判断每个槽位是否有合格匹配（设定阈值 + LLM 二次判断）
  - **策略选择**：对每个缺口槽位，决策用哪种补全策略（重排 / 文案 / 包装 / AIGC / 复用）
- **策略选择的决策表**（这部分要在答辩时讲清楚）：

| 缺口类型 | 优先策略 | Fallback |
|---|---|---|
| 缺开头 hook 镜头 | AIGC 生成或包装强化（标题条+音效） | 用现有最有冲击力的素材+裁切 |
| 缺产品特写 | 现有素材局部放大 | AIGC 生成产品图 |
| 缺使用场景 | 文案/字幕补全 + 静帧+kenburns | AIGC T2V |
| 缺对比镜头 | 结构重排（删掉这个槽位） | 包装：用前后对比卡片 |
| 缺 CTA 镜头 | 包装补全（弹出 CTA 卡片）| 文案口播覆盖 |

#### Agent 5: 生成补全 Agent（Generation Agent）
- **对应任务**：P0 任务4 结构迁移生成 + P1 任务9 画面包装
- **职责**：执行 Agent 4 选定的策略
  - **脚本生成**：基于结构槽位+产品信息+样例的"语气风格"，借鉴 VC-LLM 的 grounded generation 方式
  - **分镜生成**：为每个槽位生成详细的分镜描述
  - **包装生成**：字幕样式、标题条文案、贴纸推荐、转场建议
  - **AIGC 补全调用**：T2I/T2V 生成缺失画面
- **关键约束**：每个生成结果必须挂到结构槽位 ID 上，便于追溯（可解释性！）

#### Agent 6: 成片合成器（Composer）
- **对应任务**：P0 任务8 结果可验证 + P1 任务10 多版本生成
- **职责**：把所有产物组装成可看的结果
  - **时间线生成**：JSON 形式的剪映/Remotion 时间线
  - **多版本分支**：高点击版（hook 加强）/ 高转化版（卖点密集）/ 高节奏版（切镜更快）
  - **成片渲染**：调 FFmpeg 或 Remotion 实际渲染 mp4
  - **字幕烧录**：参考 VC-LLM 的 SSA 规则（13字符上限、关键词不断词）

---

### L5 — Agent 编排层

**选型推荐：LangGraph**（LangChain 出品，比 LangChain 更适合做有状态多 Agent）

为什么选 LangGraph：
- 显式定义状态图（State Graph），比赛要求的"可视化迁移过程"刚好对应
- 支持条件路由（缺口判断→不同补全策略）
- 内置 checkpoint，便于"人工可调"任务（任务12）做回放和修改

**核心 StateGraph 设计**：

```python
class PipelineState(TypedDict):
    sample_video: Path
    sample_artifact: Optional[SampleArtifact]
    structure: Optional[StructureGraph]
    user_assets: List[UserAsset]
    asset_graph: Optional[UserAssetGraph]
    matching: Optional[MatchingResult]
    gap_report: Optional[GapReport]
    plans: List[GenerationPlan]
    outputs: List[VideoOutput]
    messages: List[Message]  # 用于自然语言改片
    user_overrides: Dict     # 用户人工调整

graph = StateGraph(PipelineState)
graph.add_node("parse_sample", agent_sample_parser)
graph.add_node("extract_structure", agent_structure_extractor)
graph.add_node("analyze_assets", agent_asset_analyzer)
graph.add_node("decide_gap", agent_gap_decision)
graph.add_node("generate", agent_generation)
graph.add_node("compose", agent_composer)

graph.add_edge("parse_sample", "extract_structure")
graph.add_edge("extract_structure", "analyze_assets")
graph.add_edge("analyze_assets", "decide_gap")
graph.add_conditional_edges("decide_gap", route_by_strategy, {...})
graph.add_edge("generate", "compose")
```

---

### L6 — 应用服务层

**技术栈**：
- **运行时**：Node.js 20 LTS（题目指定）
- **框架**：**NestJS**（推荐）或 Fastify
- **API 协议**：REST + SSE（流式输出）+ WebSocket（实时进度）
- **任务队列**：BullMQ（基于 Redis）
- **Python 桥接**：FastAPI 子服务（Agent 主体跑在 Python，Node 做 BFF）

**为什么是 Node + Python 混合**：
- 题目明确要求 Node.js
- 但 AI/多模态生态在 Python 更成熟
- 解决方案：Node 做前端 BFF + 任务编排，Python 做 Agent 核心，通过 HTTP/gRPC 通信

**API 设计示例**：
```
POST /api/samples           上传样例视频
GET  /api/samples/:id/structure   获取抽取的结构
POST /api/projects          创建新生成项目
POST /api/projects/:id/assets     上传用户素材
POST /api/projects/:id/generate   触发生成
GET  /api/projects/:id/progress   SSE 流式进度（含 Agent 中间产物）
POST /api/projects/:id/refine     自然语言改片
GET  /api/projects/:id/visualize  迁移过程可视化数据
```

---

### L7 — 前端展示层

**技术栈**：
- **React 18 + TypeScript**（题目要求）
- **构建**：Vite
- **UI 库**：shadcn/ui + Tailwind CSS（评分项里"视觉完成度"加分）
- **状态管理**：Zustand（轻量，比 Redux 适合比赛）
- **可视化**：
  - **结构图**：React Flow（画 StructureGraph 和 mapping）
  - **时间线编辑器**：自研 Canvas/SVG 或用 WaveSurfer.js
  - **数据图表**：Recharts（节奏分析图、消融对比图）
- **视频播放**：Video.js 或原生 HTML5

**核心页面**：

1. **首页 / 项目列表** — 列出已生成项目
2. **样例分析页** — 左侧视频播放器，右侧结构抽取的 timeline+槽位图+包装信息（评分10分关键页）
3. **素材上传页** — 拖拽上传，实时显示标签
4. **生成预览页**（最重要）：
   - 上半部分：**迁移过程可视化** —— 左侧样例结构 → 中间映射关系 → 右侧新方案
   - 下半部分：缺口报告 + 补全策略说明
   - 右侧：成片预览 + 多版本切换
5. **改片对话页** — 输入框接收自然语言，下面显示修改前后对比

---

## 三、数据流全景图

完整的数据流（从用户输入到最终成片）：

```
[用户上传样例视频]
        ↓
   Sample Parser (FFmpeg + PySceneDetect + ASR + VLM)
        ↓
   SampleArtifact { shots, asr_text, ocr, bgm_info }
        ↓
   Structure Extractor (LLM + VLM)
        ↓
   StructureGraph { slots, rhythm, packaging }  ←─── 存入 PG + Qdrant
        ↓
[用户输入主题 + 商品信息 + 用户素材]
        ↓
   Asset Analyzer (CLIP + VLM)
        ↓
   UserAssetGraph { tagged_clips, embeddings }
        ↓
   Gap Decision Agent (检索 + LLM 决策)
        ↓
   GapReport { matched_slots[], missing_slots[], strategies[] }  ←─── 这里要可视化
        ↓
   Generation Agent (按策略分发)
        ├── 脚本生成 (LLM, grounded)
        ├── 分镜生成 (LLM)
        ├── AIGC 补全 (T2I/T2V)
        ├── 包装生成 (LLM + 模板库)
        └── 重排/复用 (规则 + LLM)
        ↓
   GenerationPlan { timeline, scripts, packaging, assets[] }
        ↓
   Composer (Remotion / FFmpeg)
        ↓
   VideoOutput { mp4, storyboard.png, timeline.json, structure_diff.json }
        ↓
[前端展示：成片 + 迁移可视化 + 多版本]
        ↓
[用户自然语言改片] → 回到 Generation Agent 局部重生成
```

---

## 四、Schema 设计的三个关键产物（评分核心）

这三个 JSON 是你整个项目的**技术地基**，强烈建议优先把这三个 Schema 定下来再写代码。

### 1. StructureSchema（结构定义）
体现你"如何定义视频结构"的能力 —— 课题挑战明确说的核心问题。

### 2. GapReport（缺口报告）
体现你"如何识别缺口"的能力 —— P0 占 8分。每条 gap 必须包含：
```json
{
  "slot_id": "selling_point_2",
  "expected": {"shot_type": "comparison", "duration": 3.5},
  "available_candidates": [],
  "gap_reason": "no_comparison_footage",
  "chosen_strategy": "packaging_compensation",
  "strategy_details": "用对比卡片+数字动效替代"
}
```

### 3. MigrationTrace（迁移轨迹）
体现你"可解释性"的能力 —— 评分加分项明确写"对结构迁移有较强的可解释性展示"。每一次"样例槽位 → 新方案槽位"的映射都记录，前端用 React Flow 渲染。

---

## 五、部署架构（比赛 demo 用）

```
┌─────────────────────────────────────────┐
│  Vercel / 本地        (前端 React 静态)    │
└─────────────────────────────────────────┘
                   ↓ HTTPS
┌─────────────────────────────────────────┐
│  Node.js BFF (NestJS, Docker)            │
│  - 用户请求路由                            │
│  - SSE 实时进度                            │
│  - 文件上传                                │
└─────────────────────────────────────────┘
                   ↓ HTTP/gRPC
┌─────────────────────────────────────────┐
│  Python Agent Service (FastAPI, Docker) │
│  - LangGraph 编排                         │
│  - 六大 Agent                              │
└─────────────────────────────────────────┘
        ↓                ↓             ↓
┌──────────┐  ┌──────────┐   ┌──────────────────┐
│PostgreSQL│  │  Redis   │   │  Qdrant + MinIO  │
└──────────┘  └──────────┘   └──────────────────┘

外部模型 API:
  - 火山方舟 Doubao（比赛资源）
  - 即梦 T2I/T2V API
  - OpenAI（可选 fallback）
```

**Docker Compose 一键启动**：
```yaml
services:
  frontend:        # Vite + React
  bff:             # NestJS
  agent-service:   # FastAPI + LangGraph
  postgres:
  redis:
  qdrant:
  minio:
```

比赛 demo 在本地跑 docker-compose up 就能起所有服务，评委 review 时极其方便。

---

## 六、技术栈一览表（答辩用）

| 层 | 技术栈 |
|---|---|
| 前端 | React 18 + TS + Vite + Tailwind + shadcn/ui + React Flow + Zustand |
| BFF | Node.js 20 + NestJS + BullMQ + SSE |
| Agent | Python 3.11 + FastAPI + LangGraph + Pydantic |
| LLM | Doubao-Seed-2.0-lite（主）+ GPT-4o/Claude（fallback） |
| 多模态 | Qwen2.5-VL + CLIP + Whisper + edge-tts |
| AIGC | 即梦 / Runway / SDXL |
| 视频处理 | FFmpeg + PySceneDetect + OpenCV + MoviePy + Remotion |
| 数据 | PostgreSQL + Redis + Qdrant + MinIO |
| 部署 | Docker Compose + Vercel（前端可选） |
| 监控 | LangSmith（Agent trace）或自建 OpenTelemetry |

---

## 七、开发优先级建议（按比赛交付时间）

如果你只有 4-6 周，建议这样安排：

**Week 1-2：地基**
- 三大 Schema 定义（Structure / Gap / Trace）
- ModelGateway 封装
- 样例解析 Agent（任务1）
- 结构抽取 Agent v1（任务2 拿到 8 分以上）

**Week 3：核心**
- 素材理解 Agent（任务11）
- 缺口决策 Agent（任务5 + 6）
- 生成补全 Agent v1（任务4）

**Week 4：闭环**
- 成片合成（任务8）
- 前端三个核心页面
- 迁移过程可视化（任务7，10分关键）

**Week 5：进阶**
- 多版本生成（任务10）
- 画面包装（任务9）
- 自然语言改片（任务13，加分项）

**Week 6：打磨**
- Demo 视频录制
- 文档撰写
- 答辩 PPT
- Case 集准备（至少 5 个跨品类成功案例）

---
