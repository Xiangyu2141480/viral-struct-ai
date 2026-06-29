# Viral Struct AI · 项目技术总览(供 Claude Design 理解项目)

> 用途:把这份文档喂给 Claude Design,让它**完整理解项目**,以便生成准确、专业、on-brand 的答辩 PPT / 可视化。
> 所有技术名词、函数名、契约名、模型名、阈值均对照 main 仓库真实代码(`Xiangyu2141480/viral-struct-ai`)核实。
> 阅读顺序:先读「一、定位」与「二、端到端数据流」建立全局观,再按「四、逐 Agent 详解」看每个 agent 的 pipeline。

---

## 一、一句话定位与核心理念

**Viral Struct AI = 爆款短视频「结构迁移」引擎。** 它不复制爆款的画面,而是把一条爆款视频的**抽象创作结构**(开场怎么抓人、卖点怎么递进、镜头怎么动、怎么收口)编译成可计算协议,再迁移到**新商品 + 真实素材**上,产出**可解释、可编辑、可补全**的视频时间线方案。

三个关键词贯穿全程:
1. **结构迁移**:迁移的是创作结构(role × subtype × motionToken × packaging),不是源画面/品牌/人物。
2. **素材诚实诊断**:判断真实素材是否真支撑结构槽位的功能核心(不是关键词相关);缺口诚实标注,不悄悄编造。
3. **Agent 编排 + 工程可验证**:多个结构化 Agent 各负责一类决策,全程 Zod 契约驱动,typecheck/test/build/secret-scan 守门,plan-only 边界不夸大。

**与普通 prompt-to-video 的区别**:普通工具是 `Prompt → Video` 黑盒;我们在中间插入一整条**结构中间层**,每一步都可见、可校验、可干预。

---

## 二、端到端数据流(protocol-first 的"数据脊柱")

整条链路是一组 **versioned Zod 契约**的流转(每个箭头都是一份严格校验的中间产物):

```
用户产品描述 ──▶ ContentBrief ──▶ ProductIntelligence
源爆款视频   ──▶ VideoAnalysis(rough+fine scan) ──▶ ViralStructureGraph
用户素材     ──▶ AssetCard[] ──▶ AssetSupplyContext(asset-supply-v1)
                                   │
        ViralStructureGraph × AssetCard[] ──▶ SlotMatch[](matched|partial|missing)
                                   │
        + CategoryEquivalentVocabulary(品类等价词汇表) + 源身份禁忌词
                                   ▼
                         OrchestratedTimeline(planOnly:true)   ← Director Agent 交付物
                                   ▼
                         AuthoredTimeline(v1.0)                ← Video Agent 授权
                                   ▼
              ┌──────────────┼───────────────┐
       Wan2.7(DashScope)  HyperFrames     ffmpeg 合成        ← 三渲染通道(produce 时才真跑)
                                   ▼
                    QualityReport / SafetyStatus            ← 离线评估 + 安全把关
```

**三段式分层**(用于宏观叙事):
- **感知(Perception)**:VideoAnalysis → ViralStructureGraph
- **多 Agent 迁移编排(Transfer-Orchestration)**:AssetCard[] → SlotMatch[] → Diagnosis → OrchestratedTimeline
- **生成成片(Authoring & Render)**:AuthoredTimeline → 渲染 → QualityReport/SafetyStatus

---

## 三、技术栈总览(Claude Design 作图时可据此标注真实技术)

| 层 | 真实技术 / 模型 / 库 |
|---|---|
| 感知-VLM | Files API 上传 + Responses API(VLM);粗扫 5fps 预览;prompt 版本化 v0/v1 |
| 感知-CV(code-owned,无 VLM) | PyAV 11+ 解码、OpenCV 4.8+(`cv2.DISOpticalFlow` 光流、MOG2 前景)、`scipy.signal.find_peaks` 峰值、`ruptures` PELT(RBF) 变点、ffmpeg scene-detect 硬切 |
| 迁移-规则引擎 | 正则推导 8 子类型、`motifTaxonomy.scoreMotifDefinition`(22 个 motionToken 打分) |
| 迁移-LLM | OpenAI-compatible 协议 → 火山引擎 Ark / Doubao-Seed;`response_format=json_object`;Zod 校验;temperature 0.2 |
| 生成-AIGC 视频 | 阿里 **Wan2.7**(DashScope)多模型路由 `wan2.7-r2v / i2v / videoedit / t2v` |
| 生成-动效卡 | **HyperFrames**:Doubao 作者 LLM 生成 HTML + GSAP,headless Chrome 经 HyperFrames CLI 渲染 |
| 生成-合成 | ffmpeg(H.264)+ libass(`.ass` 字幕烧制)+ concat demuxer |
| 契约/类型 | Zod + TypeScript,前后端 monorepo 共享 schema |
| 工程 | pnpm + turbo monorepo(5 包);Express 异步 job;Node child_process spawn + SIGKILL;GitHub Actions CI |

---

## 四、逐 Agent / 阶段详解(每个含 Pipeline + 技术细节 + Guardrail)

> 说明:产品对外叙事用「7 个 Agent」(感知/抽象/素材/匹配/缺口/导演/安全);代码层由若干真实函数与服务实现。下面按真实实现组织,并标出对应叙事角色。

### 阶段 A · 感知层 —— 看懂源爆款视频(Video Understanding + Structure Abstraction)

#### A1. 粗扫 Rough Scan(Stage 1,VLM)
- **Input**:源视频 → ffmpeg 降为 **5fps 预览**(`roughScanRunner.ts`)。
- **Process**:Files API 上传 → **Responses API(VLM)**分析;prompt 版本化(v0=广告框架 / v1=genre-neutral)。
- **Output**:`rough_content_blocks_v1` JSON =
  - `contentBlocks[]`(最小单位:`id / timeRange / coarseRoleGuess / boundaryReason / observableSummary / visualSignals / textSignals / fineScanFocusQuestions`)
  - `boundaryCandidates[]`(`roughBoundaryTime / canonicalBoundaryTime / inspectionWindow`(边界前后 2.5s)/ `visibleBoundaryCue`)
- **进程**:单 python 进程;`runScanCommand` spawn + 硬超时 + SIGKILL(ffmpeg 预处理 120s)。
- **Guardrail**:不逐帧硬扫,用粗粒度内容块 + 边界候选提高信噪比;跨品类化处理(把 `likelyProductFirstSeenAt` 改名 `likelySubjectFirstSeenAt`)。

#### A2. 精扫 Fine Scan(Stage 2,per-block,**4 并行通道**)
- **Input**:粗扫每个 `contentBlock` 对应的**原画质源视频切片**(ffmpeg copy mode)。
- **4 通道**:
  1. **块级语义**(VLM,`fine_structure_scan v0.3`):输出 `roleConfirmation / productPresentation / textOverlayBehavior / transferableMotifs / claimVisualizationPattern / dominantTone` 等约 13 字段(v1 增 `migrationContract`)。
  2. **视觉峰值检测**(**code-owned,无 VLM** ■):per-frame 计算 4 通道 `motionScore` = `hist_delta`(HSV 直方图)+ `frame_diff`(灰度差)+ `flow_mag`(**DIS 光流**)+ `area_delta`(MOG2 前景面积);`scipy.signal.find_peaks` 出峰值。
  3. **per-peak 微观 VLM**(`peak_micro_scan v0.3`):对每个峰值窗口出 `semanticAction / actionType / beforeState / afterState / confidence`。
  4. **硬切检测**(ffmpeg scene-detect):出 `cut_times`;另有 **`ruptures` PELT(RBF) 变点**检测 `motion_start / motion_end`(补峰值抓不到的 settling/placement)。
- **Output**:`fine_content_block_semantic_v0_3` per-block JSON,核心是 **`actionBeats[]`**(`beatId / semanticAction / anchorMs / timeRangeMs / nearestAudioBeatMs / isBeatAligned`)——聚合 code-owned 峰值 + model-owned 语义 + 音频节拍对齐。
- **进程**:`ThreadPoolExecutor`(block_workers≈8 / candidate_workers≈10),全局 HTTP semaphore 25 + upload semaphore 20;`FINE_SCAN_MAX_CONCURRENCY=1`(序列化,防 OOM,因 PyAV+OpenCV 解码 CPU 密集);单 block 300s / 批 900s 超时 + SIGKILL;文件 best-effort 清理(释放 Ark quota)。
- **适配**:`fineScanMotifAdapter` 把 `transferableMotifs` 转为 `kinetic_assembly_reveal` 的 **ViralMotifAnnotation**(`motifType / motionTokens / transferVariables / bannedSourceTerms`)供下游 Director 使用。

#### A3. 结构抽象 —— ViralStructureGraph
- **核心字段**:`segments / shotSlots / rhythm / packaging / creativeIngredients / boundaries / edges`(+ `motifAnnotations`)。
  - `segments`:`SegmentRole`、时间戳、文案、字幕、`transferRule`。
  - `shotSlots`:`requiredAsset`、`humanRequirement`、`visualIngredientRequirements`、`acceptanceCriteria`。
  - `rhythm`:平均镜头时长、切割频率(low/medium/high)、顶点位置。
  - `boundaries`:过渡类型(cut/fade/morph/wipe/dissolve)、强度、节拍对齐。
- **结构词表**(均与品类解耦):
  - **功能角色 FunctionalRole**:`hook / pain_point / selling_point / proof / usage / comparison / cta`(另有 instructional 品类的 explanation / demonstration / technique_step / context)。
  - **源结构子类型 SourceSpecificTransferSubtype(8 个)**:`opening_transform / interface_detail / assembly_detail / ui_sequence / device_handoff / cta_lockup / kinetic_assembly_reveal / generic_source_specific`。
  - **运动语法 motionToken(22 个)**:`dynamic_entry, component_cascade, chaos_to_order, assembly_completion, interaction_activation, spectacle_burst, cta_reveal, falling_object, impact_beat, snap_open, assembly_reveal, activation_moment, flow_motion, consume_action, object_rotation, lineup_sweep, card_drop, clean_hold, quick_cut, push_in, match_cut, morph`。
  - **病毒母题 MotifType**:如 `kinetic_assembly_reveal / surreal_assembly / ingredient_transformation / kinetic_product_reveal / lineup_lockup / impact_activation / dynamic_entry / benefit_card_motion / category_usage_moment`。
- **两层抽象引擎**:
  - ① **规则驱动**:`inferSourceSpecificTransferSubtype`(正则匹配 slot 文案 → 8 子类型);`motifTaxonomy.scoreMotifDefinition`(motionToken 匹配度打分 → MotifType,公式 `tokenScore=(命中/总)×0.8 + pairBonus=强对×0.1`,clamp[0,1])。
  - ② **LLM 驱动**:`translateCategoryEquivalents`(强制 LLM,见阶段 B)。
- **Guardrail**:抽取**可迁移结构**,不保留源表层元素(如"键盘碎片飞向电脑"抽象为 `kinetic_assembly / chaos_to_order`,不保留"键盘")。

---

### 阶段 B · 多 Agent 迁移编排 —— 把结构迁到新商品(Director 链路)

> 这是项目最核心的"迁移能力"。中心编排器把上一个 Agent 的结构化产物接给下一个,全程 Zod 校验。**形态是固定依赖的 DAG,不是自治 swarm。**

**5 个 Director-side Agent(真实函数)**:

| Agent | 职责 | LLM 策略 | 输入 → 输出 |
|---|---|---|---|
| `parseContentBrief` | 解析自由文本产品描述 | LLM + **确定性兜底** | 产品段落 → `ContentBrief` |
| `analyzeProductIntelligence` | 产品语义锚 | LLM + **确定性兜底** | `ContentBrief` → `ProductIntelligence`(complexity/proofRegime/coreBenefits/sensoryCues/forbiddenClaims/targetDuration);`groundAgainstAssets` 用素材印证 |
| `translateCategoryEquivalents` | **品类等价翻译**(迁移核心) | **强制 LLM,无兜底** | 抽象语法 → `CategoryEquivalentVocabulary`(`bySubtype`×8 / `byRole`×7 / `tokenActions`×22 / `connective`) |
| `deriveSourceIdentityBanlist` | 源专属禁忌词(防泄漏) | **强制 LLM,无兜底** | `ViralStructureGraph` → 禁忌词 `terms[]` |
| `runDirectorAgent` | 总编排 | 组合上游 | 全部产物 → `OrchestratedTimeline`(planOnly) |

- **并行点**:`translateCategoryEquivalents` 与 `deriveSourceIdentityBanlist` **数据独立、无依赖**(前者吃 brief/assets,后者只吃 structureGraph);当前实现是顺序 `await`,**可优化为 `Promise.all` 并行**(诚实的优化点,不要说成已并行)。
- **LLM Provider**:`createOpenAICompatibleClient` → 火山 Ark / Doubao-Seed;`LLM_BASE_URL / LLM_TIMEOUT_MS=90s / LLM_MAX_RETRIES=1`;`response_format=json_object`(端点不支持时 graceful 退回纯 JSON);所有输出经 Zod `.parse()` + `assertComplete`(强制覆盖全部 subtype/role);`clientFactory` 可注入 mock 做单测(不连真实 LLM)。

**编排器 `orchestratedTimelineBuilder` 的关键步骤**:
- `evaluateSourceSpecificGate`:源泄漏门(`detectRawSourceSpecificSemantics` + `motif.bannedSourceTerms` + `hardRejectIf`),命中 → `source_specific_not_transferable`。
- `planStructuralCompression`(P0-B,可选):把源 27+ 槽位重预算为 K 个 canonical **~6-8 beats**(`StructuralCompressionBeat`,保留结构功能 + 时长映射)。
- 防泄漏清洗:`containsSourceSpecificTerm`(子串匹配禁忌词)、`sanitizeMotionGrammarText`、`transferableIntent` vs `sourceIntent`。
- `decideFillStatus`:综合 quality/coverage/gate/motif;阈值 `MATCHED_THRESHOLD=0.85` / `PARTIAL_THRESHOLD=0.45`。

**缺口三通道(`gapResolutionOptionsBuilder`)**——每个 beat 都给 3 条诚实通道:
- `reshoot`(补拍)/ `hyperframes`(增强真素材)/ `aigc`(生成 job-card)。
- **降级阶梯**:`matched`/`partial` → 推荐 **hyperframes**(在真素材上增强,IP 安全,**永不自动替换**);`gap` → 合格则 **aigc** 否则 hyperframes;`reshoot` 永远**提供但从不自动选**。
- AIGC 始终标 `ownership='external_generation_job_card_only'`(仅 job-card)。

**Director 交付物 `OrchestratedTimeline`**(`meta.planOnly === true`,Zod `z.literal(true)` 硬边界):
- `slots[]`:每槽带 `fillStatus`(5 态:`matched / partial / source_specific_not_transferable / missing_generation_required / needs_hyperframes_enhancement`)、`sourceIntent` vs `transferableIntent`(防泄漏)、`sourceAbstraction`、`motionTokens`、`options[]` + `recommendedOptionId`。
- `transitions[]`:相邻槽过渡(`hyperframes / aigc_frame_bridge / cut / match_cut`,AIGC 转场亦 job-card only)。
- `reusableAssetPacks[]`:预定义可复用素材包(`director_handoff_plan_only`)。

#### 槽位匹配 Agent(`SlotMatcher`)—— 上表 SlotMatch 的来源
> 对外叙事的"素材诚实诊断"核心。判断的是**功能支撑**,不是关键词相关。

- **入口 `matchSlotsWithFallback`**:先试 LLM judge,任何异常自动降级规则法;每条 match 记 `alignmentSource`(`llm_judge` / `rule_based`)。
- **LLM judge `matchSlotsLLM`(主路径)**:
  - 输入:槽位(`intent / acceptanceCriteria.anyOf / hardRejectIf / sourceSpecificRejectIf`,**忽略 `sourceInstance`**)+ 资产卡。
  - 输出:`{ assetId, quality(0-1), matchedCriteria[], missing, treatmentSpec }`(Zod 严格校验)。
  - 阈值(`statusFromQualityWithEvidence`):`quality≥0.85 → matched`;`0.45-0.84 → partial`;`<0.4 但 assetEvidenceStrength≠none → partial`;否则 `missing`。
  - Client:`response_format=json_object`、`temperature=0.2`、`max_tokens=8192`。
- **规则法 `matchSlots`(确定性兜底)**:`score = semanticMatch(0.35) + typeMatch(0.2/0.12/0) + ingredientMatch×0.2 + motionMatch(0.15/0.1/0) + quality×0.1 + affordanceFit×0.15 + boundaryBonus(0.05) − penalty`,`clamp[0,0.99]`;阈值 `≥0.75 matched / ≥0.45 partial / else missing`。
- **关键设计**:`anyOf` 是 OR;`sourceSpecificReject ≠ hardReject`(源专属限制只当迁移提示,不直接否决跨品类素材);`splitRejectIfForTransfer` 用 `sourceBannedTerms` 把 `rejectIf` 分成"真拒绝"与"可迁移";`estimateAssetEvidenceStrength` 让信息多的素材在边界分也能判 partial(防误杀)。

---

### 阶段 C · 生成成片 —— 从计划到可执行视频(Video Agent + Render)

#### C1. 授权 handoff
`runDirectorAgent` → `OrchestratedTimeline`(planOnly)→ **`orchestratedToAuthored`**(只重塑计划,不做 IO)→ `AuthoredTimeline`(`schemaVersion:'1.0'`)→ `renderAuthoredTimeline`(在 Video Agent 中调 `AuthoredFfmpegExecutor`)。
- 授权 `authorTimeline`:`buildAuthoringPrompt` → LLM `complete` → `canonicalizeAuthoredTimeline`(修复+校验);**失败回退 `deterministicMockAuthor`**(无 LLM 时始终 mock)。

#### C2. 三条真实渲染通道
1. **Wan2.7(阿里 DashScope)多模型路由**:`routeModel` 按 `fillStatus` + matched 资产类型选 `wan2.7-r2v`(参考重绘)/ `wan2.7-i2v`(图转视频)/ `wan2.7-videoedit`(视频修改)/ `wan2.7-t2v`(纯文生兜底)。`generateClip → resolveMedia`(本地图→base64 / 视频→上传 oss://)`→ POST video-synthesis → 轮询 tasks/{taskId}` 直到 SUCCEEDED → `downloadVideo`。
2. **HyperFrames(动效卡)**:`createDoubaoHyperframesAuthor`(Doubao LLM 生成完整 `index.html`,系统提示**强制** GSAP `paused:true`、frame-seek 确定性(禁 `Math.random`)、`.clip` 选择器 + `data-start/duration`、`fromTo` 补间、本地 `./assets/*` 引用)→ `hyperframes lint --json` 校验 → 失败则 self-heal(`≤maxHealAttempts`)→ `hyperframes render`(headless Chrome via CLI)出 MP4;可选 Doubao critic 美学评分+修复。
3. **ffmpeg 合成(`AuthoredFfmpegExecutor`)**:逐 beat `renderBeat`——matched 走 `-i` 输入 + scale/crop +(可选)Ken-Burns `zoompan`;unresolved 走 `-f lavfi color` 替代卡背景;文本经 `buildAuthoredAss` 生成 libass `.ass` 烧制;所有 beat MP4 经 **concat demuxer** 拼接;输出 manifest 记录每 beat 帧数/是否 unresolved/内容哈希。

#### C3. 诚实强制(honesty enforcement)
- `beatIsUnresolved` 命中(`unresolvedReason` 或任一 `layer.evidence.tier=='unresolved'`)→ 渲染器**强制画 HONEST_SUBSTITUTE 替代卡**(teal 背景 `0x1b4965` + 黄字「替代卡片 · 素材缺失」`0xffd400`,样式不可覆盖)。
- AIGC 图生视频在 `proof`/`comparison` 语义上**自动标 unresolved**(canonicalizer)。
- **plan-only 边界**:`OrchestratedTimeline.meta.planOnly===true`;`/export` 是 plan-only(asset-stripped,不产真 MP4);只有 **`/produce`** 经 HONEST-GATE 检查 `DASHSCOPE_API_KEY` 后才真调 Wan2.7 生成成片。

#### C4. 质量与安全把关
- `evaluateQuality` → `QualityReport`(**离线启发式**):structureMatch / slotCoverage / visualScriptAlignment / factuality / coherence / transitionFidelity。
- `checkBrandSafety` → `SafetyStatus`:`passed / needs_review / blocked`,含 ipRisk / brandRisk / claimRisk(无未授权品牌/明星/价格/医疗宣称)。
- `EvidenceMetadata.tier`:`real / attributed / derivative / unresolved`,贯穿每个媒体层与文本元素,作为诚实性的结构化底座。

---

## 五、核心数据契约清单(protocol-first 的"类型契约链")

**主链路契约**(每个都是 Zod schema,前后端 monorepo 共享):

| 契约 | 角色 | 关键标识 |
|---|---|---|
| `ContentBrief` | 输入约束 | productName/targetAudience/scenario/sellingPoints/cta(+category) |
| `ProductIntelligence` | 产品语义锚 | complexity/proofRegime/coreBenefits/sensoryCues/forbiddenClaims |
| `ViralStructureGraph` | 结构脊柱起点 | segments/shotSlots/rhythm/packaging/creativeIngredients/boundaries |
| `AssetCard` | 素材核心 | media/semantic/quality/slotAffordance/roleAffordance/videoSegments |
| `AssetSupplyContext` | 素材库聚合 | `protocolVersion:'asset-supply-v1'` |
| `CategoryEquivalentVocabulary` | 品类等价表 | bySubtype×8 / byRole×7 / tokenActions×22 / connective |
| `SlotMatch` | 匹配结果 | status: matched\|partial\|missing + score + matchedCriteria |
| `OrchestratedTimeline` | Director 交付 | **`meta.planOnly: z.literal(true)`** + slots/transitions/reusableAssetPacks |
| `AuthoredTimeline` | 授权渲染计划 | `schemaVersion:'1.0'` + beats(AuthoredComposition) |
| `QualityReport` / `SafetyStatus` | 评估/安全 | 离线启发式 + pass/needs_review/blocked |

**隐藏中间契约**(不在主轨道上,但是技术深度所在):`ViralMotifAnnotation`、`SourceAbstraction`、`StructuralCompressionBeat`、`MissingMaterialBrief`、`MaterialGap/GapRepair`、`WanJob`、`AigcBeatPlan`、`EvidenceMetadata`、`MotionSpec`(frame-indexed)、`MediaLayer`(≤8 层)、`TextElement`、`TransitionMotionGrammarHandoff(transition-handoff-v1)`、`TransitionAudioPlanBundle(transition-audio-plan-v1)`、`PackagingCardSpec`(闭合包装词汇)。

---

## 六、工程底座(异步 job harness + monorepo)

- **异步 job 模式**:`POST → 202 + jobId`,`GET 轮询 status/stage/elapsedSec`;`stage` 回调实时报进度("预处理视频(5fps 预览)"→"粗扫描中 · VLM 解析"…)。
- **6 类 job Map**:scan / fine / fineAll / boundary / hyperframes / produce,各自独立 + 定时 sweep。
- **防泄漏 sweep TTL**:scan 30min、artifacts(视频+rough.json)60min、asset session dir 2h;库拥有文件 `keepFiles=true` 时 sweep 不删。
- **并发槽 + 等待队列防 OOM**:`FINE_SCAN_MAX_CONCURRENCY=1`,`acquireFineScanSlot/releaseFineScanSlot` 信号量。
- **硬超时杀进程**:`runScanCommand` = spawn + `setTimeout` + `SIGKILL`(粗扫 120s / 精扫 300s / 批 900s / 转场 300s)。
- **断点续跑**:fine/boundary 复用粗扫已落盘的 `videoPath/roughScanPath/workDir`。
- **monorepo(pnpm + turbo,5 包)**:`@viral-struct/shared`(所有 Zod schema/types)、`@viral-struct/api`(Express 后端 + Agent 编排)、`@viral-struct/web`(Next.js 前端)、`@viral-struct/video-agent`(AIGC 编排/授权)、`@viral-struct/render-executor`(ffmpeg 渲染)。
- **CI**:`pnpm install → shared build → typecheck → build` + `python -m unittest discover`(Python 单测)。

---

## 七、主 Demo 案例(跨品类反差,最有说服力)

**MacBook Neo(科技硬件)→ 康师傅冰红茶(饮料)** —— 表层画面几乎零重合,只有真懂结构才能做等价映射:

| 抽象结构 | 源(MacBook,**不复制**) | 目标(冰红茶,等价表达) |
|---|---|---|
| 由散到聚 kinetic assembly | 键盘碎片组装 | 冰块 / 柠檬 / 茶滴汇聚 |
| 产品揭示 | 机身亮相 | 瓶身标签锁定 |
| 卖点递进 | 硬件功能展示 | 冰爽 / 茶香 / 解腻 / 分享 |
| CTA 收口 | 购买按钮 | 产品定格 + 行动号召 |

> 也准备了耳机、香水等多品类素材验证泛化(结构协议不绑品类)。

---

## 八、给 Claude Design 的视觉指引(沿用现有答辩 deck 设计系统)

**设计系统(现有 `.dc.html` deck,1920×1080)**:
- 背景 `#05070D`(deck 径向渐变 `#0C1426→#070A12→#05070D`)。
- 字体:**Manrope**(标题/正文)/ **JetBrains Mono**(英文标签与代码,大写 + letter-spacing)/ **Noto Sans SC**(中文)。
- 强调色:青 `#22D3EE`、紫 `#A78BFA`、绿 `#34D399`、琥珀 `#FBBF24`、红 `#FF4D6D`。文字 `#F1F5FE / #C8D2E2 / #9AA6BD / #7C8AA3 / #6B7689`。
- 卡片:`1px rgba(accent,.22)` 边框,`radius 14-16`,`bg rgba(accent,.05)`;可用 GSAP。
- **三段配色约定**:感知=紫 `#A78BFA`,迁移编排=青 `#22D3EE`,生成成片=绿 `#34D399`。

**视觉上要强调的技术深度**:
1. 三段式分层(感知/迁移/生成)+ 7 节点数据脊柱。
2. 节点连线 = versioned Zod 契约(protocol-first 可视化)。
3. 感知层的"VLM 语义 + 经典 CV 信号工程"混合(峰值/变点是 code-owned 无 token 消耗)。
4. 迁移层的"规则托底 + 强制 LLM"双引擎,以及防泄漏护栏(禁忌词 / source gate)。
5. 生成层的三渲染通道 + plan-only / HONEST_SUBSTITUTE 诚实边界。
6. 底部工程底座(并发槽 / SIGKILL / sweep / 断点续跑)。

**诚实边界(Claude Design 切勿夸大)**:
- 不要把项目说成"全自动生成爆款视频";核心是**结构迁移 + 可解释工作流**。
- `QualityReport` / demo 数据是**离线启发式估算**,**没有真实投放 CTR / 转化**,不可标成实测。
- AIGC 是缺口补全的可选路径;无 key / 未生成时是 **plan-only**,不能画成"已出成片"。
- 「可并行」只能作为优化点呈现(代码当前顺序 `await`)。

---

## 九、一页速记(电梯版)

> Viral Struct AI 把一条爆款视频拆成**与品类解耦的结构协议**(role×subtype×motionToken×packaging),用**感知(VLM+经典 CV 混合扫描)→ 多 Agent 迁移编排(规则托底 + 强制 LLM,带防泄漏护栏)→ 生成成片(Wan2.7 / HyperFrames / ffmpeg 三通道,plan-only 诚实边界)** 三段式流水线,把爆款的"创作方法"可解释地迁移到新商品上。全程 Zod 契约驱动、异步 job harness 支撑、typecheck/test/CI 守门。
