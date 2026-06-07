# 视频剪辑 Agent 开源生态调研报告

> 调研日期：2026-06-05 · 方法：4 个并行调研 Agent（GitHub `gh` 元数据优先 + Web + 官方文档）
> 视角：为 **viral-struct-ai** 服务——已有 `packages/remotion-video`（Remotion）、共享 `TimelineItem[]` 协议、`timelineGenerator`、`timelineEditor.ts`（LLM 解析自然语言→结构化 `EditOperation[]`→确定性应用，规则兜底）、以及每个 shot-slot 的 `migrationContract`（intent/sourceInstance/acceptanceCriteria）。
> 所有 star/日期为 2026-06-05 经 `gh` 抓取的快照；许可证一栏务必先核对再复用代码。

---

## 0. TL;DR（先看这段）

1. **"Hyperframes" = HeyGen 的 HyperFrames**：开源（Apache-2.0）、面向 Agent 的「写 HTML → 渲染视频」框架，是 **Remotion 的正面竞品**，极其活跃（24.6k★，今日仍在提交）。它**刻意不设独立的 timeline/edit 协议**（"DOM 即时间线"），这与你的 `TimelineItem[]` 路线**正好相反**。
2. **整个领域收敛到一条主线**：`LLM 产出"受约束的数据结构" → 代码确定性地应用`。你的 `timelineEditor.ts`（"模型管语义、代码管确定性变换"）正是这条主线的标准答案——**field 验证了你的架构选择是对的**。
3. **三个北极星参考仓**（都可安全借鉴/移植）：
   - `gyoridavid/short-video-maker`（MIT）= "LLM 出 JSON props → Remotion 模板渲染" 的最佳样板，和你的 `TimelineItem[]` 几乎同构。
   - `FireRedTeam/FireRed-OpenStoryline`（Apache-2.0，2.9k★）= **最对齐你"结构迁移"主题的项目**：它的 "Editing Skill"（把一套剪辑风格存下来 → 换素材 → 一键复刻）本质就是你的结构迁移引擎；且有清晰的 `plan_timeline → render_video` 工具边界。
   - `KyaniteLabs/mcp-video`（Apache-2.0）= 和 `timelineEditor.ts` 最像的"编辑算子层"：`{"op": "trim", ...}` 结构化算子 + 预检 guardrails，且**架在 FFmpeg/HyperFrames 之上**（证明编辑层可与渲染层解耦）。
4. **战略岔路口**：HeyGen 公开主张「LLM 写 HTML+GSAP 比写 React/Remotion 需要更少 guardrails、更有创意」。但 HyperFrames **没有编辑协议**——你的结构化编辑 + 可解释协议在"编辑/迁移"维度更强。建议：**编辑/可解释核心继续用 Remotion + `TimelineItem[]`；把 HyperFrames 作为可选的"渲染/生成后端"在同一 `TimelineItem[]` 契约后面评估**。

---

## 1. "Hyperframes" 到底是什么（置信度：高）

**HeyGen HyperFrames** — `https://github.com/heygen-com/hyperframes`（Apache-2.0 · TypeScript · 24,634★ · 2026-03-10 创建 · 2026-06-05 仍在提交）。

- **定位**：*"Write HTML. Render video. Built for agents."* 用纯 HTML/CSS/JS + 媒体写"合成"，用 **headless Chrome/Puppeteer 逐帧 seek**（`frame/fps`，把 GSAP/Anime.js/Lottie/Three.js 的时钟暂停并定位以保证确定性），再用 **FFmpeg** 编码 + 混音。核心包 `@hyperframes/engine`、`@hyperframes/producer`。
- **时间信息**靠 HTML data-attributes（`data-composition-id/-start/-duration/-track-index/-volume`）+ GSAP `window.__timelines[...]`，**没有可移植的 JSON 编辑协议**——官方原话："HTML-native… no proprietary timeline format / no separate timeline or edit-list model / 渲染器与编辑器共享同一个 DOM"。
- **Agent 集成**：装成 Claude Code/Cursor/Codex/Gemini-CLI skill（`npx skills add heygen-com/hyperframes`），非交互 CLI（`preview/render/lint`），仓库 topic 含 `mcp`。
- **官方对位 Remotion**：有官方 head-to-head 文档 `https://hyperframes.mintlify.app/guides/hyperframes-vs-remotion`。HeyGen 的理由是「LLM 直接写 HTML+GSAP 比写 Remotion 合成更有创意、需要的 guardrails 更少」。

**需要排除的同名物**（均与视频无关，置信度高）：`python-hyper/hyperframe`（HTTP/2 framing 库）、`hyperframework`（旧 PHP/前端框架）、`aeTunga/HyperFrame`（Flutter）、TmaxSoft "HyperFrame"（中间件）。
**容易混淆但不是它**：`nexu-io/html-video`（独立的 HTML→MP4 引擎，1.25k★，竞品而非同源）。

### 建在 HyperFrames 上的"剪辑 Agent"（确实存在）
| 仓库 | URL | 与你最相关之处 |
|---|---|---|
| **KyaniteLabs/mcp-video**（Apache-2.0, Py, ~32★, 6-04 活跃）| github.com/KyaniteLabs/mcp-video | **和 `timelineEditor.ts` 最像**：~119 个 MCP 工具，agent 产出 `{"op":"trim","input":...,"start":...,"duration":...}` 结构化算子，`pipeline()` 串联后由 FFmpeg 执行；带预检 guardrails（边界/合并兼容/混音/叠加透明度/文字溢出）+ inspect→edit→verify→review 闭环。架在 FFmpeg/HyperFrames 之上。|
| agno-agi/vibe-video（Apache-2.0, Py, 91★）| github.com/agno-agi/vibe-video | 多 Agent（Animator/CodeExplorer/Researcher）；Animator 写 HyperFrames HTML+GSAP、lint、渲染、失败自愈。无正式 edit-op IR。|
| coleam00/hyperframes-ai-video-generation（80★，Cole Medin）| github.com/coleam00/hyperframes-ai-video-generation | URL→Short；SSML 旁白→TTS→按词级时间戳算转场锚点→注入 HTML 模板。无 JSON storyboard。|
| feicaiclub/video-spec-builder（MIT, 296★）| github.com/feicaiclub/video-spec-builder | NL → **秒级精度 storyboard `video-spec.md`** → HyperFrames 渲染（少见的"先出结构化 spec 再渲染"）。|

---

## 2. 三大架构范式（决定你怎么接 LLM）

| 范式 | 代表 | 机制 | 取舍 | 对你 |
|---|---|---|---|---|
| **A. Agent 写代码（TSX/HTML）** | claude-code-video-toolkit、OpenMontage、editor-pro-max、HyperFrames、官方 remotion-dev/skills | LLM 直接生成 React/Remotion TSX 或 HTML+GSAP；靠 Skills（Markdown 最佳实践）+ 组件库引导 | 表达力最强；但**不可校验、需沙箱 + 报错回灌迭代、难 diff** | 仅作"逃生舱"，别让模型直接产 TSX |
| **B. Agent 出结构化 JSON props → 固定模板渲染** | **short-video-maker**、remotion-claw、Revideo/Midrender、你自己 | LLM 产出经校验的 scene/props JSON，确定性合成消费 | 确定性、可校验、安全；灵活性略低 | **你已选 B**——研究强烈支持该选择 |
| **C. 编辑算子层（NL→typed edit-ops→确定性 apply）** | **你的 timelineEditor**、KyaniteLabs/mcp-video、IAmTomShaw/video-editing-agent、FireRed | 把"编辑"建成一组带 schema 的算子，校验后由代码 apply，产出 before/after diff | 最稳；算子可审计/可回放；架在任意渲染器之上 | **你已选 C**——继续夯实即可 |

> B 管"从结构生成时间线"，C 管"对时间线做自然语言编辑"——你两者都已具备（`timelineGenerator` + `timelineEditor`），方向正确。

---

## 3. 重点仓库 shortlist（按"可直接借鉴度"排序，已标许可证）

| 项目 | URL | ★ | License | 一句话 | 你能拿走什么 |
|---|---|---|---|---|---|
| **short-video-maker** | gyoridavid/short-video-maker | 1.2k | **MIT** | LLM 出 `{scenes:[{text,searchTerms}],config}` → Remotion 渲染短视频；MCP+REST | JSON-props→Remotion 样板；**音频时长决定 scene 时长**；**searchTerms→assetId 间接绑定**；把合成 fork 进 `packages/remotion-video` 吃 `TimelineItem[]` |
| **FireRed-OpenStoryline** | FireRedTeam/FireRed-OpenStoryline | 2.9k | **Apache-2.0** | 对话式剪辑 Agent（Skill+MCP+FastAPI）| **"Editing Skill = 结构迁移"**；`plan_timeline/render_video` 工具边界；`filter_clips/group_clips` 的"带硬约束的 JSON 选择"；任务拆解 prompt 布局 |
| **KyaniteLabs/mcp-video** | KyaniteLabs/mcp-video | ~32 | **Apache-2.0** | guardrailed 视频编辑 MCP（119 工具）| `{"op":...}` 算子 + pipeline + 预检 guardrails；编辑层与渲染层解耦的范例 |
| **claude-code-video-toolkit** | digitalsamba/claude-code-video-toolkit | 1.3k | **MIT** | Claude Code 产 Remotion TSX + 链 Python AI 工具 | **`project.json` 任务生命周期状态机**（plan→assets→review→audio→edit→render）；`brands/*.json` 主题 ≈ 你的 `packaging` |
| **AI-Youtube-Shorts-Generator** | SamurAIGPT/AI-Youtube-Shorts-Generator | 3.8k | ⚠️无声明 | 长→短，OpusClip OSS 替代 | **爆款度=显式加权 rubric**；严格 JSON 契约 `{title,start,end,score,hook_sentence,virality_reason}` + 松解析兜底 + 确定性去重 |
| **IAmTomShaw/video-editing-agent** | IAmTomShaw/video-editing-agent | 29 | ⚠️无声明 | 脚本对齐的最佳镜次裁剪 | **最干净的"typed edit object"**：OpenAI Agents SDK `output_type=list[VideoEdit]`（Pydantic）→ MoviePy apply；`targeted_script_snippet` 溯源字段 |
| **editor-pro-max** | Hainrixz/editor-pro-max | 173 | ⚠️Other | NL→视频；Claude 从 25 组件库写 TSX；含"改片"模式 | **25 组件 + 10 模板 + presets** 正好实现你的 `packaging`（captionStyle/cardType/transition/motion）|
| **OpenMontage** | calesthio/OpenMontage | 4.4k | ⚠️**AGPL-3.0** | 极致 agentic 流水线 | **仅学模式**：JSON scene-plan + schema 校验、按 7 维打分选 provider/素材、**渲染前 QA 门**（"slideshow risk"/"delivery-promise"）、决策审计 |
| video-creator/ffmpeg-mcp | video-creator/ffmpeg-mcp | 134 | MIT | 最主流 FFmpeg MCP | 把你的算子暴露成 MCP 时的**命名/参数参考**（注意它是无状态命令式，你的"持久时间线"更强）|
| redotvideo/revideo | redotvideo/revideo | 3.8k | MIT | Remotion 表亲（Motion-Canvas 派生），无头渲染/serverless | 备选渲染后端；Midrender 托管版"会说 MCP" |
| ClipsAI/clipsai | ClipsAI/clipsai | 497 | MIT | 长视频→片段 + 9:16 重构图（**无 LLM**）| WhisperX+pyannote+TextTiling 的确定性底座；`Clip{start,end}` 极简原子 |
| WyattBlue/auto-editor | WyattBlue/auto-editor | 4.4k | Unlicense | 静音/场景自动剪（**无 LLM**）| 成熟的"删废段"引擎，可作 apply 层组件 |

**生成型（非编辑/迁移，仅作背景）**：MoneyPrinterTurbo（79.8k★, MIT）、ShortGPT（7.4k★, MIT）、brainrot.js（955★, MIT）——它们"从脚本生成"而非"从源视频迁移结构"，相关度低。

---

## 4. 跨项目收敛模式（4 条车道共同结论）

1. **LLM 提议、确定性代码执行**——领域第一铁律，正是你 `timelineEditor.ts` 的论点。
2. **严格 JSON 契约 + 松解析兜底**：system prompt 里钉死 schema（"Respond ONLY with valid JSON: {…}"），解析端剥 markdown 围栏 / 首`{`末`}`切片 / 安全默认（见 AYS 的 `_parse_json_loose`）。配合你的 Zod + 规则兜底。
3. **音频时长决定时长**：scene/`TimelineItem` 的 `start/end` 由 TTS 音频长度推导，而非模型瞎猜时间戳——消灭一整类幻觉。
4. **素材按 searchTerms/ID 间接绑定**，而非让模型吐二进制；后端再解析 `assetId`，与 `assetAnalyzer`/素材库解耦。
5. **编辑锚定到稳定 ID / 转写词级范围，禁用裸帧号**（Descript / video-use / LAVE）——去掉 off-by-frame 错误，且 token 省几个数量级（video-use：12KB 文本 vs ~45M token 的逐帧）。
6. **validate→apply→≤3 次自愈→兜底**：校验失败把错误回灌模型重试，封顶 3 次，再退回规则解析。
7. **planner/executor + 可批准计划**（LAVE plan-and-execute）：把解析出的 `EditOperation[]` 当"计划"先给用户预览 diff 再提交——天然契合你的"可解释"卖点。
8. **data-gen 而非 code-gen**：渲染层吃 `TimelineItem[]` props，别让模型产 Remotion TSX（code-gen 不可校验/难 diff，仅作沙箱逃生舱）。
9. **"风格 Skill = 可复用结构模板"**（FireRed 唯一显式做"抓一次风格→换素材复刻"的 OSS）= 你的结构迁移核心。
10. **MCP 是新兴交付层**：把 `timelineGenerator/timelineEditor` 包成 MCP server，你的差异化是"工具说的是 segmentRole/结构"，而非通用的 geometry。
11. **学术背书**：L-Storyboard《From Shots to Stories》(arXiv 2505.12237) 的"统一语言表示 + 角色标签上重排"= 你的 `segmentRole` + `reorder_selling_points`/`move_product_info_earlier`，证明"可解释结构时间线"路线成立。

---

## 5. 对 viral-struct-ai 的具体建议（按优先级）

**P0（直接强化现有核心）**
1. **保持 `TimelineItem[]` + `timelineEditor` 路线**——全行业验证你方向正确；以下都是夯实而非重写。
2. **`EditOperation` 改成"strict structured-output 兼容"并启用约束解码**：`additionalProperties:false`、所有字段进 `required`、可选用 `T|null`；然后以 strict/grammar 解码 `EditOperation[]`，把"尽力 JSON"升级为"schema 保证"。
3. **加 validate→apply→≤3 自愈循环**：Zod/语义校验失败 → 回灌错误重试 ≤3 → 退回你现有规则解析；apply 先 dry-run 出 before/after diff，校验过了才提交。
4. **算子一律锚定 `id`/`sourceSegmentId`/字幕范围，禁裸帧号**（你本就 key 在这些上）。
5. **把 `migrationContract.acceptanceCriteria` 接进校验器做"应用后断言"**（如"hook 仍在 slot 0""商品信息在对比之前"），违反则触发自愈——让契约从文档变成可执行门禁。

**P1（补齐渲染/生成闭环）**
6. **以 `short-video-maker`（MIT）为样板**：把它的 Remotion 合成 fork 进 `packages/remotion-video` 让其消费 `TimelineItem[]`；引入**音频推时长** + **searchTerms→assetId**。
7. **用 `editor-pro-max` 的 25 组件/presets** 把 `packaging`（captionStyle/cardType/transition/motion）在 `packages/remotion-video` 落地成可渲染契约。
8. **Remotion 侧用 Zod props + `calculateMetadata()`**：`TimelineItem[]` 直接作 input-prop，一个 `<Sequence>` 一个 item，总帧数由 item 范围计算（别手存时长）；人工微调走 Studio 可视化编辑。

**P2（迁移引擎 + 工程化）**
9. **把"抽取出的爆款结构"序列化成可复用模板**（学 FireRed 的 "Editing Skill"）：换商品/素材即可对新 `TimelineItem[]` 复刻；研究其 `plan_timeline/render_video` 边界与任务拆解 prompt（Apache-2.0 可移植）。
10. **引入 `project.json` 式任务状态机**（学 claude-code-video-toolkit）跟踪 generate→edit→preview→render。
11. **渲染前 QA 门**（学 OpenMontage 的 "slideshow risk"/"delivery-promise"，仅学模式，AGPL）。
12. **给 `ViralStructureGraph`/时间线信封补 `schemaVersion` + 升级函数**（OTIO 模式；你 graph 已有 v0/v1，延伸到时间线即可）。
13. **（可选）把 `timelineEditor` 算子包成 MCP server**，差异化为"说结构的工具"。
14. **爆款度做成显式加权 rubric**（学 AYS）来给"该迁移哪些结构 beat"打分，配严格 JSON + 松解析。

---

## 6. 战略岔路口：Remotion vs HyperFrames

- HeyGen 主张 HTML+GSAP 对 LLM **生成**更友好（更少 guardrails、更有创意）；但 HyperFrames **无编辑协议**（DOM 即时间线），不利于"可控编辑 + 可解释迁移"。
- 你的 `TimelineItem[]` + 结构化算子在**编辑/迁移**维度明显更强；`KyaniteLabs/mcp-video` 证明**编辑算子层可架在 FFmpeg/HyperFrames/Remotion 任意渲染器之上**。
- **建议**：编辑/可解释核心保持 Remotion + `TimelineItem[]`（data-gen 边界）；若想要更强的视觉生成，把 **HyperFrames 当一个可替换的"渲染后端"** 放在同一 `TimelineItem[]` 契约后做 A/B，而不是迁就它放弃你的协议。

---

## 7. 许可证地图（复用前必读）
- ✅ **可移植（MIT/Apache-2.0）**：short-video-maker、FireRed-OpenStoryline、claude-code-video-toolkit、HyperFrames、KyaniteLabs/mcp-video、video-creator/ffmpeg-mcp、revideo、ClipsAI、video-spec-builder、vibe-video。
- ⚠️ **仅学模式（copyleft）**：OpenMontage（AGPL-3.0）、supoclip（AGPL-3.0）、MeiGen-AI/X-Cut（AGPL-3.0，且代码尚未发布）。
- ⚠️ **无 License 声明 = 默认保留所有权利**（可读思路、勿抄代码）：AI-Youtube-Shorts-Generator、IAmTomShaw/video-editing-agent、editor-pro-max（"Other"）、若干无声明 skill。

## 8. 未验证 / 缺口
- **没有任何 OSS Agent 产出 OTIO/EDL 交换格式**——大家都用 bespoke JSON；采用 OTIO 可成差异化，但无现成 OSS Agent 先例可移植。
- `MeiGen-AI/X-Cut`（AGPL，含 `apply-timeline-strategy` 工具名、Remotion 实时预览）**仅落地页、代码 "coming soon"**——架构来自 README，置信度中，值得回访。
- `trykimu/videoeditor`（Kimu, 2k★）/`designcombo/react-video-editor`（1.6k★）是 Remotion 多轨编辑器，但 LLM→timeline 接口未文档化/疑似无 LLM 层——需读源码确认。
- 官方 `remotion-dev/skills` 确认存在与安装路径，但单个 skill 文件内容未枚举；`remotion-dev/codex-plugin` 自述"内部包、无文档"。
- 检索偏英文，CN 生态（FireRed/X-Cut/MoneyPrinter）已覆盖部分，可能仍有非英文关键词下的 CN agent 编辑器未尽。

---

### 附：可直接动手的"最小第一步"
克隆研究 **`gyoridavid/short-video-maker`**（MIT）→ 把其 Remotion 合成 fork 进 `packages/remotion-video` 消费你的 `TimelineItem[]` → 接 **音频推时长** + **searchTerms→assetId** → 把 `timelineGenerator/timelineEditor` 包到一个 MCP `create/edit-video` 工具后面；同时按 **§5 P0** 给 `EditOperation` 上 strict 解码 + validate→自愈→兜底。结构迁移层对照 **`FireRed-OpenStoryline`** 的 "Editing Skill" 思路落地。
