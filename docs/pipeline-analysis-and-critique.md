# 全链路技术详解与问题诊断：素材提取 → 匹配 → 时间线（现状）

> 本文描述**当前真实在跑**的完整链路：新的原生视频 AssetCard 提取器 + 队友的 transfer-safe 匹配/源抽象 + 新的渠道作者。每个环节按「大白话 → 技术细节 → 注意点」写，不需要预先熟悉代码。
> 配套：素材提取器的更细拆解见 [docs/asset-card-extraction-pipeline.md](docs/asset-card-extraction-pipeline.md)。

---

## 0. 一分钟结论（TL;DR）

整条链路把「一条爆款源片 + 一批新商品素材」变成一条**纯计划**的可执行时间线（plan-only：不渲染、不调外部生成、不出音频）。六个阶段：

```
① 源片结构分析(Python)        M1 素材提取(原生视频多模态)
                  └────────────┬────────────┘
        M2 Asset Manager ② → M3 匹配 → M4 Director ③ → M5 渠道作者 → M6 交接给 Video Agent
```

**当前状态**：
- ✅ **素材是真分析**：原生视频喂多模态模型，产出真实画面描述、逐维度画质、带 caption 的关键帧（不再是文件名糊出来的）。
- ✅ **匹配用上了真实素材**：27 个槽位全部匹配到可用素材（quality 0.45–0.82），不再"全判无素材"。
- ✅ **源专属硬门槛被软化**：源片里"产品形态固定无开合结构"这类约束不再当作毙掉饮料素材的硬门槛。
- ✅ **三渠道按能力分工**：reshoot 只给真实可拍、hyperframes 只给剪辑指令、aigc 才给超现实迁移（校验器把关）。
- ⚠️ **仍待决（见 §8）**：匹配几乎不出 gap —— 故意上传的不全素材没被暴露成缺口，aigc 也因此没机会展示超现实迁移。

---

## 1. 全链路总览

```
源片视频(MacBook广告)                         用户素材(6个康师傅手机片)
   │ ① 结构分析(Python,既有)                      │ M1 素材提取(原生视频多模态)
   ▼                                              ▼
structure_graph.json                          asset_cards.json (full 卡)
   · segments / shotSlots                         · 真 caption + 逐维度质量 + 关键帧
   · migrationContract(intent/acceptanceCriteria) │
   └───────────────────────┬───────────────────────┘
                           ▼  M2 Asset Manager ②  buildAssetSupplyContext
                  覆盖分析 + roleAffordance + missingMaterialBriefs
                  + transfer-safe acceptance(源专属 rejectIf → 源品类证据,不当目标硬门槛)
                           ▼  M3 匹配 slotMatcher(LLM 裁判)
                  槽位(意图+软化后的接受标准) × 素材(真visualContent+真keyframe caption) → quality 0..1
                           ▼  M4 Director ③ buildOrchestratedTimeline (plan-only)
                  decideFillStatus(5态) → tier → buildFill → 转场 → reusableAssetPacks
                  + 源专属抽象(MacBook意图→饮料等价物) ; gap options 确定性兜底(aigc 门控到 gap)
                           ▼  M5 渠道作者(opt-in: AUTHOR_OPTIONS=true)
                  一份中性抽象 → 三套能力边界 prompt → LLM → 校验器
                  reshoot=真实可拍 / hyperframes=剪辑已有素材 / aigc=超现实迁移
                           ▼  M6 交接
                  orchestratedToAuthored → AuthoredTimeline → Video Agent(执行/渲染,另做)
```

边界：① 与 M1 是 Python；②③M5 是 TypeScript。Director 全程 **plan-only**（不渲染、不执行外部生成；aigc 只是 job card）。M3 与 M5 会调 LLM（同"裁判/作者"一类的文本调用），不破坏 plan-only。

---

## 2. M1 · 素材 → AssetCard（原生视频多模态提取器）

**大白话**：把每个用户素材**原样**喂给多模态大模型（视频按服务端 fps 抽帧），让模型真正"看"画面，产出带真实描述、逐维度画质、关键帧 caption 的完整卡片。

**技术细节**（[scripts/analyze_asset_library.py](scripts/analyze_asset_library.py)，逐步）：
1. **S1 摄入分类** `discover_clips` / `classify_media_type`（视频/图片）。
2. **S2 客观元数据**：本地 `ffprobe`（复用 [scripts/extract_media_technical.py](scripts/extract_media_technical.py)）→ 分辨率/时长/帧率/比例/音频。
3. **S3 原生上传（=切分）**：`llm_client.upload_file(fps)` 整片上传，**供应商服务端按 fps 抽帧**喂模型。fps 自适应：默认 4，短片(<8s)升到 4.9，**钳在供应商允许的 (0.20, 5.00) 内**（早期升到 8/10 会被 400 拒绝）。
4. **S4 多模态理解**：`create_response(input_video + asset_card_v2 prompt)`（[prompts/asset_library/asset_card_v2.md](prompts/asset_library/asset_card_v2.md)）。模型返回 `shortCaption / temporalDescription / keyMoments[{timeSec,caption,action}] / detectedObjects / humanPresence / visualContent / motionPotential / qualityCues / suitableSlots / candidateSlotRoles / risks`。
5. **S5 关键帧**：对模型给的 `keyMoments[].timeSec` 用 ffmpeg 本地抽缩略图，`description` = 模型 caption（来自看过整片的模型，非盲采占位）。
6. **S6 真实质量**：分辨率走 ffprobe 客观分桶；锐度/亮度/对比度/构图/主体突出/产品聚焦 = 模型 `qualityCues`（逐维度真值，非写死常数）。
7. **S7 枚举映射 + 安全过滤**：模型自由文本 → 严格枚举（suitableSlots / detectedIngredients / humanPresence.actions）；镜像 TS 的 `detectUnsupportedClaims` 剔除功效/夸大类宣称。
8. **S8 full normalize**：组装完整 `analysis` 块，`analysisSource:'llm_multimodal'`，**自带分析块，不再依赖加载期合成**。**诚实兜底**：调用失败时产低置信瘦卡 + warning，绝不伪造语义。

**注意点**：
- 这是「服务端 fps 采样」式切分，不是镜头检测；关键帧只在模型标注的关键时刻抽。
- 输出库文件 `asset_cards.json` 加载时仍过 `normalizeAssetCards`，但因为卡已是 full，归一化只做兼容补全。
- 实测：6 张卡 `0 fallback`，质量分有区分度（0.68–0.88），每卡 4–5 个带真 caption 的关键帧（如「手旋开瓶盖→倒入杯中→重新拧紧」逐帧叙事）。

---

## 3. M2 · Asset Manager ②（buildAssetSupplyContext）

**大白话**：把"源片要什么"和"素材有什么"对照，算出每个槽位的覆盖度、缺什么料，并把源片里"产品专属"的硬要求转成"可迁移的品类要求"。

**技术细节**（[apps/api/src/services/assetManager/](apps/api/src/services/assetManager/)）：
- `assetCoverageAnalyzer` + `slotAffordanceScorer`：为每个素材按"资产管理角色"打 `roleAffordance` 分（语义 / 视觉信号 / 产品可见性 / 画质 / 格式 / 可编辑 / 安全 7 个分量），产出每槽 `ContextualSlotCoverage`（`coverageStatus: covered / weak / insufficient` + matched / missing / weak ingredients）。
- `missingMaterialBriefBuilder` / `motifAwareBriefBuilder`：为弱/缺槽位产出补料简报（含 channelEligibility）。
- `materialScenarioClassifier`：素材场景分类。
- **transfer-safe acceptance** [packages/shared/src/transferSafeAcceptance.ts](packages/shared/src/transferSafeAcceptance.ts) 的 `splitRejectIfForTransfer`：把源片 `acceptanceCriteria.rejectIf`（如「产品形态固定无开合结构」）拆成"源品类专属约束"而非目标硬门槛 —— 否则它会被原样发给裁判去毙掉饮料素材。

**注意点**：报告"RejectIf Transfer Filtering"显示每槽 hard reject = 0、源专属 reject 作为"源品类证据"保留。`roleAffordance` 是 ② 在此现算的，不是提取器产出的。

---

## 4. M3 · 匹配（slotMatcher，LLM 裁判）

**大白话**：给每个源片槽位从素材里挑最合适的，打 0–1 分。≥0.85 matched / 0.45–0.85 partial / <0.45 gap。

**技术细节**（[apps/api/src/services/slotMatcher.ts](apps/api/src/services/slotMatcher.ts)，`matchSlotsWithFallback` → `matchSlotsLLM`，失败回退到规则打分）：
- 裁判 prompt 原则：「只看意图 + 接受标准，别被 sourceInstance 带跑」「质量 < 0.45 才允许 assetId=null」。
- 发给模型：`summarizeSlot`（intent / acceptanceCriteria（经 transfer-safe 处理）/ sourceInstance）+ `summarizeAsset`（visualContent / motionPotential / candidateSlotRoles / **analysisEvidence 含真实 keyframe caption**）。
- 健壮性：`response_format: json_object` 不支持时重试；`max_tokens`（默认 8192，env `LLM_MAX_TOKENS` 可调）防长输出截断。

**注意点**：素材侧有真证据 + rejectIf 软化 → 实测 27 槽 quality 全落在 **0.45–0.82**。**这也意味着几乎不出 gap**（见 §8 待决项）。

---

## 5. M4 · Director ③（buildOrchestratedTimeline，plan-only）

**大白话**：拿匹配结果 + ② 证据，编排成一条纯计划时间线：每槽定档、给方案、算转场、归并复用素材包；全程不渲染、不调外部生成。

**技术细节**（[apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts)）：
- **`decideFillStatus` 5 态**：`matched` / `partial_asset_support` / `needs_hyperframes_enhancement` / `source_specific_not_transferable` / `missing_generation_required`；`fillStatusToTier` 折回 matched/partial/gap。**设计哲学：有可用素材就放入 + 增强（partial），只有无素材 / 质量<0.45 才 gap。**
- **时长压缩**：`targetDurationMode`（source_preserve / high_click_15s / high_conversion_20s(默认) / full_story_30s），每槽按比例从源时间轴重映射到目标时间轴。
- **源专属抽象** [sourceSpecificAbstraction.ts](apps/api/src/services/directorAgent/sourceSpecificAbstraction.ts)：把 MacBook 专属意图抽象成饮料等价物（"侧边接口展示"→"瓶身标签/冷凝水"），并防源词泄漏。
- **gap options（确定性兜底）** [gapResolutionOptionsBuilder.ts](apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts)：每个 partial/gap 槽产出 reshoot/hyperframes；**aigc 门控到 `tier==='gap'`**（有真实素材就不该用 aigc 从零生成）。这是 M5 未启用时的默认文本。
- **转场** `transitionOrchestrator`：按相邻槽角色/motif 推断转场函数（opening_to_product / product_to_usage / motif_assembly_bridge…）。
- **reusableAssetPacks**：把同类槽位归并成共享拍摄/生成包。

**注意点**：实测 27 槽 → 全 partial（real media 27/27），转场全 hyperframes。M5 未开时，这里的三渠道文本是确定性模板（机械、且会把超现实塞进 reshoot —— 这正是 M5 要修的）。

---

## 6. M5 · 渠道作者（opt-in：`AUTHOR_OPTIONS=true`）

**大白话**：Director 给的三渠道文本是确定性模板，机械且会把"超现实"塞进 reshoot。这一步用 LLM 按**每个渠道实际能做什么**重写它们 —— 同一份中性抽象，三种不同渲染。

**技术细节**：
- [authorTimelineOptions.ts](apps/api/src/services/directorAgent/authorTimelineOptions.ts)（Director **之外**的 post-stage，保 plan-only）：逐槽取中性抽象（role / motionTokens / transferableIntent / 参考素材证据）→ 调作者 → **只替换 option 的文本字段**，结构字段（时长 / aspectRatio / providerHint / 引用 id / 推荐项）全保留 → 重新 `OrchestratedTimelineSchema.parse`。
- [channelBriefAuthor.ts](apps/api/src/services/directorAgent/channelBriefAuthor.ts)：**三套能力边界 system prompt** + LLM(json_object 重试) + **硬校验器**：
  - **reshoot**：只许真实可拍动作/构图；命中超现实词表（悬浮/级联/汇聚/爆发/形变/冷雾/morph…）→ 打回。
  - **hyperframes**：只许对已有素材的剪辑 + 2D 卡片/文字；命中生成式/超现实词 → 打回。
  - **aigc**：允许超现实迁移；仅查源产品词泄漏。
  - 单渠道失败/不过 → 只丢该渠道，保留确定性兜底（永不抛给调用方）。
- 7 个 mock 单测覆盖各边界。

**注意点**：实测 26/26 槽重新生成、**0 拦截**。同一"由乱到序/组装"抽象的三种渲染：
- **reshoot**：「把杂乱多瓶用手摆成一排、开盖、倒入杯中」（真实可拍）
- **hyperframes**：「对现有素材分段裁切逐段滑入、推近定格、叠加高亮箭头、擦除转场 + 卖点卡」（纯剪辑）
- **aigc**：超现实级联爆发（本次无 gap 槽，故未出现）

---

## 7. M6 · 交接

[orchestratedToAuthored.ts](apps/api/src/services/videoAgent/orchestratedToAuthored.ts)：OrchestratedTimeline → AuthoredTimeline（matched → 媒体 beat，gap → 诚实占位，转场 → beat.transitionOut），交 Video Agent 执行/渲染（另做，不在本链路）。

---

## 8. 当前仍存在的问题诊断

### 8.1 ⚠️ 几乎不出 gap，真实缺口被掩盖（最主要）

**现象**：故意上传质量低、相比源片不全的素材，期望出现一些 gap（需补拍/生成），但实测 27 槽全 partial、0 gap。

**根因（两层叠加）**：
1. **裁判把一切打到 0.45+**：[slotMatcher.ts](apps/api/src/services/slotMatcher.ts) 的裁判 prompt 写「质量<0.45 才允许 null」，加上 transfer-safe 把匹配锚点抽象成 motionType，于是任何"手+瓶"片段都能松散命中任何槽位 → 普遍 0.6+。
2. **"有弱素材就 partial"的设计哲学**：`fillStatusToTier` 只在无素材 / 质量<0.45 才判 gap；`degradation-ladder` 测试 + 队友的 `source_specific`/`kinetic` 测试都背书"弱覆盖 + 有匹配素材 = partial"。

**后果**：真实缺口（如多设备协同、对比陈列、CTA 尾帧——素材库根本没有）被一个松散匹配的饮料片"覆盖"成 partial；aigc 因门控到 gap 而从不出现，超现实迁移无从展示。

**两条解法（都会动既有设计，需与队友协调）**：
- **(b1) 校准 LLM 裁判**：对"只是抽象相关、当不了实拍画面"的素材打 <0.45 → 走现有 gap 路。风险：可能又荡回"全 gap"。
- **(b2) 改 tier 哲学**：让 `source_specific_not_transferable` / 真正无覆盖 → gap。代价：改队友刚合并的设计与一批测试。

### 8.2 模板重复（仅在 M5 未启用时）

M4 的确定性 gap options 对同 role/motif 槽位用同一份模板，会重复。**开启 M5（AUTHOR_OPTIONS=true）后由 LLM 逐槽重写，实测 26/26 重新生成、去重明显改善。** 即重复问题在 M5 路径已解决，确定性兜底路径仍存在。

### 8.3 aigc 门控的副作用

aigc 只在 `tier==='gap'` 提供。当前无 gap → aigc 永不出现，超现实迁移这条能力线**没被实际验证**。修好 8.1 后此项自然解除。

---

## 9. 附：关键代码速查

| 环节 | 文件 | 关键符号 |
|------|------|---------|
| 素材提取器 | [scripts/analyze_asset_library.py](scripts/analyze_asset_library.py) | `process_clip` / `build_full_card` / `resolve_upload_fps` |
| 提取器 prompt | [prompts/asset_library/asset_card_v2.md](prompts/asset_library/asset_card_v2.md) | System/User（含 keyMoments / qualityCues） |
| 客观元数据 | [scripts/extract_media_technical.py](scripts/extract_media_technical.py) | `run_ffprobe` / `classify_aspect_ratio` |
| ② 供给上下文 | [assetSupplyContextBuilder.ts](apps/api/src/services/assetManager/assetSupplyContextBuilder.ts) | `buildAssetSupplyContext` |
| roleAffordance | [slotAffordanceScorer.ts](apps/api/src/services/assetManager/slotAffordanceScorer.ts) | `slotAffordanceScorer` |
| transfer-safe 接受 | [transferSafeAcceptance.ts](packages/shared/src/transferSafeAcceptance.ts) | `splitRejectIfForTransfer` |
| 匹配裁判 | [slotMatcher.ts](apps/api/src/services/slotMatcher.ts) | `matchSlotsLLM` / `summarizeSlot` / `summarizeAsset` |
| 5 态定档 | [orchestratedTimelineBuilder.ts](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts) | `decideFillStatus` / `fillStatusToTier` |
| 源专属抽象 | [sourceSpecificAbstraction.ts](apps/api/src/services/directorAgent/sourceSpecificAbstraction.ts) | — |
| gap options + aigc 门控 | [gapResolutionOptionsBuilder.ts](apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts) | `buildGapResolutionOptions` / `shouldOfferAigc` |
| 渠道作者(三 prompt + 校验) | [channelBriefAuthor.ts](apps/api/src/services/directorAgent/channelBriefAuthor.ts) | `authorChannelBriefs` |
| 作者 post-stage | [authorTimelineOptions.ts](apps/api/src/services/directorAgent/authorTimelineOptions.ts) | `authorTimelineOptions` |
| 交接映射 | [orchestratedToAuthored.ts](apps/api/src/services/videoAgent/orchestratedToAuthored.ts) | `orchestratedToAuthored` |
| 手测入口 | [scripts/manual_test_director_agent_timeline.ts](scripts/manual_test_director_agent_timeline.ts) | `AUTHOR_OPTIONS=true` |

---

*生成时间：2026-06-09 ｜ 描述修改后现状。实测：tmp/director-agent-orchestrated-timeline-report.md（27 槽 / 27 用真实素材 / 渠道作者 26 槽 0 拦截 / source leakage PASS）。*
