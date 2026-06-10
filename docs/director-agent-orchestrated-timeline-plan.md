# Director Agent — 编排时间线（Orchestrated Timeline）实施计划

> 状态:**规划文档(只读审计,未动代码)**。
> 背景:组会重新划定边界 —— **Asset Manager 只产 AssetCard 与素材供给证据;新增独立模块 Director Agent 负责素材匹配 / 缺口补全建议 / 转场编排,产出 `OrchestratedTimeline` 交给 Video Agent 执行。**
> 综合来源:本仓库真实代码审计 + `docs/gpt_plan.md`。
> 术语:② = Asset Manager;**Director Agent = 编导大脑(新)**;③ = Video Agent 执行/渲染。

---

## 1. 三角色边界(组会结论)

```text
Asset Manager  ─►  Director Agent  ─►  Video Agent
 (产证据)          (编排成时间线)        (执行/渲染)
```

| 模块 | 负责 | 不负责 |
|---|---|---|
| **② Asset Manager** | 解析素材为 `AssetCard`;评估可用性;输出 `AssetSupplyContext`(coverage / weak / insufficient / observations / candidate / missing ingredients / channel eligibility / missingMaterialBriefs) | **不做**最终时间线编排 |
| **Director Agent(新)** | 按每个 slot 编排 timeline;逐 slot 匹配并填素材;弱/未命中给**多种解决方式**;编排 slot 间转场;输出 `OrchestratedTimeline` | 不解析素材,不真实渲染 |
| **③ Video Agent** | 消费 `OrchestratedTimeline`;执行 HyperFrames 剪辑;渲染;(未来)导出 MP4 | 不决定每个 slot 怎么补 |

> 这不是重写 ② 或 ③,只是把"编排大脑"从 ② 抽出来成为独立模块。

---

## 2. 现状审计(基于真实代码,可复用 vs 缺失)

| 能力 | 现状(真实代码位置) | 处理 |
|---|---|---|
| LLM slot 匹配 | ✅ `matchSlotsWithFallback` / `matchSlotsLLM`(`apps/api/src/services/slotMatcher.ts`):素材对齐裁判,per-slot 返回 `assetId/quality/matchedCriteria/missing/treatmentSpec`,失败回退规则版 | **复用**为 Director Agent 匹配引擎 |
| AssetCard / AssetSupplyContext | ✅ `assetManager/*`(`buildAssetSupplyContext`、`assetCoverageAnalyzer`) | **作为 Director Agent 输入** |
| 补拍简报 | ✅ `manualShootBrief`(`assetManager/missingMaterialBriefBuilder.ts`) | 映射为 `ReshootOption` |
| AIGC prompt | ✅ `aigcGenerationBrief`(同上,role×motif×品类、leak-safe) | 映射为 `AigcOption` |
| HyperFrames 简报 | ⚠️ `hyperframesBrief`(卡片输入,非给③的剪辑指令) | 合成 `editingGuidanceNL` |
| 转场配方 | ✅ `transitionRecipeGenerator`(`transitions/*`,含 `'hyperframes'` 模式、`storyboardPrompt/videoPrompt`、motif 感知) | **复用/迁入** Director Agent |
| 帧桥接转场(抽帧) | ❌ 不存在 | 新增**计划层**,真实抽帧后置 |
| `OrchestratedTimeline` 契约 | ❌ 不存在 | 新增(§3) |
| ③ 消费编排时间线 | ❌ 不存在 | 新增 adapter / handoff(§8) |
| 可迁移性 / 源片专属判定 | ⚠️ 部分:`IngredientTransferability`(`shared/types.ts`)、motif `bannedSourceTerms` | 组装成"source-specific 闸门"(§5.4) |

**结论**:LLM 匹配、三种补全内容、转场配方都已有 ~70%;真正新增的是 **`OrchestratedTimeline` 契约、Director Agent 模块这层编排壳、转场帧桥接(计划层)、③ 的 handoff**。

> 注意(沿用 PR-A/PR-B):③ 已是可跑的执行引擎(`runVideoAgentPipeline` + `AuthoredFfmpegExecutor`,PR #65)。Director Agent 的 handoff 优先映射到 ③ 现有的 `AuthoredTimeline` 渲染路径。

---

## 2.1 可复用能力的具体实现逻辑(逐个拆)

> 下面是 §2 表里每项"可复用"能力的**真实实现逻辑**(入口 / 输入输出 / 核心算法 / 文件位置 / 给 Director Agent 的复用要点),按代码核对。

### A. LLM 素材匹配 — `matchSlotsLLM` / `matchSlotsWithFallback`
- **文件**:`apps/api/src/services/slotMatcher.ts`
- **入口**:`matchSlotsWithFallback(opts)` → 先试 `matchSlotsLLM`,**任何异常回退** `matchSlots`(规则版),返回 `{ matches, gaps, alignmentSource: 'llm_judge'|'rule_based', warning? }`。
- **`matchSlotsLLM` 核心流程**:
  1. `summarizeSlot`:每个 shotSlot → `{ id, segmentId, role, intent, acceptanceCriteria, sourceInstance, fallbackStrategies }`。
  2. `summarizeAsset`:每个 AssetCard → `{ id, type, visualContent, motionPotential, candidateSlotRoles, detectedObjects, suitableSlots, analysisEvidence(top3 roleAffordance + quality + keyframes + warnings) }`。
  3. **system prompt =「素材对齐裁判」**:只看 intent + acceptanceCriteria(不被 sourceInstance 带跑);`anyOf` 是 OR;即使无 ≥0.85 也要给最佳匹配 + `treatmentSpec`;质量 <0.45 才允许 `assetId=null`;不许编造 assetId;只输出 JSON。
  4. 调 LLM(`temperature 0.2`, `response_format: json_object`)→ `stripJsonFence` → Zod 校验 `record<slotId, { assetId|null, quality 0..1, matchedCriteria[], missing, treatmentSpec{motion,durationMs,syncPoint,captionOverlay} }>`。
  5. **硬校验**:每个 slotId 必须出现;assetId 必须在候选集中或为 null —— 否则抛错 → 回退规则版。
  6. `statusFromQuality`:`assetId && q≥0.85 → matched`;`assetId && q≥0.45 → partial`;else `missing`。
  7. `gaps` = 非 matched 的 slot(`buildLLMGap`,带 `motifContext`)。
- **复用要点**:Director **直接调 `matchSlotsWithFallback`** 拿 per-slot 匹配 + `treatmentSpec`;`alignmentSource` 填 `meta.matchSource`。这就是组会要的"匹配交给 LLM",已成型。

### B. 规则版匹配(回退)— `matchSlots`
- **同文件**。逐 slot 对每个 asset 线性打分:
  `score = clamp( semanticMatch + typeMatch + ingredientMatchScore*0.2 + motionMatch + quality*0.1 + analysisFit*0.15 + boundaryBonus − analysisPenalty )`
  - `semanticMatch`:asset.suitableSlots / analysis.suitableSlots 含该 role,或 targetAffordance ≥75 → 0.35,否则 0。
  - `typeMatch`:generated 0.12 / 同类型 0.2 / 否则 0。`motionMatch`:hand_operation 需 asset 有对应动作 → 0.15;video → 0.1。
  - `analysisPenalty`:warnings 数 / 低质 / safety needs_review(0.08)/blocked(0.2)。`boundaryBonus`:段落处于 strong morph|wipe 边界 +0.05。
  - **阈值**:`≥0.75` matched(且无 humanBlocked、关键要素满足);`≥0.45` partial;else missing。
- **复用要点**:LLM 不可用时的确定性兜底,Director 不用改。

### C. AssetCard 富化 + 覆盖打分 — `analyzeAssetCoverage`
- **文件**:`apps/api/src/services/assetManager/assetCoverageAnalyzer.ts`
- `enrichAssetsWithAffordance`:`normalizeAssetCard` + `scoreSlotAffordance` → 把 `roleAffordance / candidateSlotRoles / slotAffordance` 注入 `AssetCard.analysis`。
- **候选打分** `buildSlotCandidate`:
  `score = 0.30·roleAffordance + 0.25·intentSemanticMatch + 0.20·acceptanceCriteriaMatch + 0.15·assetQuality + 0.10·editabilityFit`,再 `applyHardRequirementPenalty`。
- **⚠️ 假覆盖捷径(已知缺陷)**:`scoreIntentSemanticMatch` 当 `asset.suitableSlots.includes(slot.role)` **直接 `return 86`**;`scoreAcceptanceCriteriaMatch` 同理 **`return 78`** —— 绕过关键词重叠语义,只凭"声明了这个 role"就拿高分。
- **`applyHardRequirementPenalty`(部分弥补)**:按角色硬封顶 —— usage_demo 无 drink/pour/open evidence 封 49/69;comparison 无对比 evidence 封 49;benefit_visual 封 64;opening 封 69;cta(hand_operation)封 49;低质封 49;humanRequirement 不满足封 49;类型不符封 48/55;safety blocked → 0。
- **状态**:`bestScore<50 → missing`;低质 / 角色 evidence 缺 → weak;否则 `coverageStatusFromScore`(covered/weak/missing)。
- **复用要点**:Director 把它当**旁证**填进 `OrchestratedSlot.evidence`(coverageStatus / candidates / gapReason);**匹配判定以 LLM(A)为准**,coverage 作辅助。§5.4 的 source-specific 闸门可借用这里"角色 evidence 缺失即封顶"的思路 + transferability。

### D. AssetSupplyContext 组装 — `buildAssetSupplyContext`
- **文件**:`apps/api/src/services/assetManager/assetSupplyContextBuilder.ts`
- 流程:归一化 assets → `contextualCoverage`(逐 slot `slotCoverages`,带 `motifContext`)→ `materialScenarioClassifier`(场景分类)→ `buildMissingMaterialBriefs`(对非 covered slot)→ 输出 `{ assets, contextualCoverage, missingMaterialBriefs, materialScenario, warnings }`。
- **复用要点**:Director 的 `assetSupplyContext` 输入直接来自这里;`contextualCoverage` + `missingMaterialBriefs` 是三选项的内容来源。

### E. 三种补全简报 — `missingMaterialBriefBuilder`
- **文件**:`apps/api/src/services/assetManager/missingMaterialBriefBuilder.ts`
- `manualShootBrief`:`roleCopy[role]` 模板(7 role)→ title/objective/shotDescription/durationSec/framing/requiredProps/mustCapture/avoid;motif 命中走 `buildMotifAwareBriefs`。
- `aigcGenerationBrief`:`prompt = [前缀 + "9:16 ordinary smartphone shot" + roleSpec.aigcPrompt + buildTransferableIntentLine(sanitize 后的 slotIntent) + 卖点 + 安全声明]`;`negativePrompt = SAFE_NEGATIVE_PROMPT`;`providerHint`(usage/opening→seedance,aigc_ready→gemini,else generic)。
- `hyperframesBrief`:cardType/copyIntent/visualElements/animationHints/durationSec(**卡片输入,非自然语言剪辑指令**)。
- `channelEligibility`:6+ 通道(manual_shoot / aigc_video_prompt / aigc_image_prompt / hyperframes_card_animation / reuse_crop_zoom / copy_packaging_card / video_agent_fallback)各带 eligible + confidence + ownership。
- **复用要点**:`reshoot` ← manualShootBrief(拼 NL);`aigc` ← aigcGenerationBrief(几乎现成);`hyperframes` ← hyperframesBrief + **新合成 editingGuidanceNL**;`recommendedOptionId` ← channelEligibility。

### F. 转场配方 — `transitionRecipeGenerator`
- **文件**:`apps/api/src/services/transitions/transitionRecipeGenerator.ts`,输入 `timeline: TimelineItem[]`。
- `buildShotPairs`:相邻 item 成对;`selectTransitionPreset(targetCategory)` → preset(recipeTemplates / objectMappings)。
- **motif 驱动**:kinetic/surreal 母题时优先 `chaos_to_order / ingredient_to_product / product_to_cta` 模板。
- `chooseImplementationMode`:`missingImportantAssets ? template.preferredImplementationModes.missingAssets : .withAssets`(模式枚举含 `hyperframes / css_motion / gsap / lottie / rive / threejs / remotion / cut_only`)。
- 每模板产 `TransitionRecipe`:beforeShotId/afterShotId、transitionFunction、motionGrammar、requiredAssets、missingAssetFallback、implementationMode、`storyboardPrompt`、`videoPrompt`、ipRiskNotes、`ownership='transition_plan_only_not_rendered'`。
- **复用要点(决策 2:整体迁入 Director Agent)**:把这套逻辑搬进 `directorAgent/transitionOrchestrator.ts`,用 storyboardPrompt/videoPrompt 作 hyperframes 分支的 `editingGuidanceNL` 来源;改成 **hyperframes 高权重默认** + 适配 `OrchestratedSlot`(而非 TimelineItem);① 不再持有转场。

### G. 可迁移性 / source-specific 信号
- `IngredientTransferability`(`shared/types.ts` 的 `CreativeIngredient.transferability`)。
- motif:`viralMotifExtractor` 产 `bannedSourceTerms / transferVariables / sanitizedIntent`;`sanitizeMotionGrammarText` 把源文本 → tokens 并清洗源片专属词。
- **复用要点**:组装 §5.4 闸门 —— 命中 `bannedSourceTerms` 或要素不可迁移 → 禁止 matched(防"MacBook 屏幕交互"被误判覆盖)。

---

## 3. 新增共享契约:`OrchestratedTimeline`

新增到 `packages/shared/src/types.ts` + `schemas.ts`(Zod)+ 测试。采用 `gpt_plan.md` 的契约(比初版更完整:带 `videoEngineInstruction`、`evidence`、`ownership`、`planOnly`、`warnings`)。

```ts
export interface OrchestratedTimeline {
  schemaVersion: 'orchestrated-v1';
  projectId: string;
  renderProfile: { width: number; height: number; fps: number; aspectRatio: '9:16' | '16:9' | '1:1' };
  slots: OrchestratedSlot[];              // 一个 shotSlot 一条,按时间顺序
  transitions: OrchestratedTransition[];  // 相邻 slot 之间,长度 = slots.length - 1
  meta: {
    productName?: string;
    targetCategory?: string;
    matchSource: 'llm_judge' | 'rule_based' | 'mixed';
    generatedAt: string;
    planOnly: true;
  };
  warnings: string[];
}

export interface OrchestratedSlot {
  slotId: string; segmentId?: string; role: ShotSlotRole | string; index: number;
  startMs: number; endMs: number;
  sourceIntent?: string; transferableIntent?: string;   // transferable 已 sanitize,防泄漏
  motifType?: string; motionTokens?: string[];
  fill: SlotFillMatched | SlotFillGap;
}

export interface SlotFillMatched {
  kind: 'matched';
  assetId: string; matchQuality: number;
  matchedCriteria: string[]; missingCriteria?: string[];
  treatmentSpec?: SlotTreatmentSpec;
  status: 'matched' | 'partial';
  videoEngineInstruction: string;          // 给③的一句执行指令
  options?: GapResolutionOption[];          // partial 时附"可增强"选项
  evidence: { coverageStatus?: 'covered' | 'weak' | 'insufficient'; matchedIngredients: string[]; missingIngredients: string[]; blockingReasons: string[] };
}

export interface SlotFillGap {
  kind: 'gap';
  reason: string; missing: string;
  recommendedOptionId: GapResolutionOption['id'];
  options: GapResolutionOption[];           // 给用户挑的三种解决方式(§5)
  videoEngineInstruction: string;
  evidence: { coverageStatus?: 'covered' | 'weak' | 'insufficient'; matchedIngredients: string[]; missingIngredients: string[]; blockingReasons: string[] };
}

export type GapResolutionOption = ReshootOption | HyperframesOption | AigcOption;

export interface ReshootOption {          // 补拍:给用户的自然语言拍摄指导
  id: 'reshoot'; title: string; guidanceNL: string; framing: string;
  durationSec: number; mustCapture: string[]; avoid: string[];
}
export interface HyperframesOption {      // hyperframes:给③的自然语言剪辑指导
  id: 'hyperframes'; title: string; editingGuidanceNL: string;
  cardType?: string; copy?: { headline?: string; subline?: string; bullets?: string[]; cta?: string };
  referencedAssetIds: string[]; durationMs: number;
}
export interface AigcOption {             // AIGC:给生成器的 prompt(仅 job card)
  id: 'aigc'; prompt: string; negativePrompt: string; referenceAssetIds: string[];
  aspectRatio: '9:16' | '16:9' | '1:1'; expectedDurationSec: number;
  providerHint: 'seedance' | 'gemini' | 'generic';
  ownership: 'external_generation_job_card_only';
}

export interface OrchestratedTransition {
  id: string; fromSlotId: string; toSlotId: string;
  mode: 'hyperframes' | 'aigc_frame_bridge' | 'cut' | 'match_cut';
  transitionFunction?: string;
  preferredImplementation: 'hyperframes' | 'video_engine' | 'external_generation';
  reason: string;
  hyperframes?: { editingGuidanceNL: string; durationMs: number; styleTokens: string[] };
  aigcFrameBridge?: { fromTailFrameRef?: string; toHeadFrameRef?: string; prompt: string; negativePrompt: string; durationMs: number; ownership: 'external_generation_job_card_only' };
  requiredAssets: string[]; missingAssets: string[]; riskNotes: string[];
}
```

**边界(写进 schema 注释 + 校验)**:`planOnly = true`;AIGC = job card only;不真实调外部模型 / 不渲染 MP4 / 不生成音频。
新增样例 `docs/examples/orchestrated-timeline.sample.json`,保证 `python -m json.tool` 通过。

---

## 4. Director Agent 模块

新增目录 `apps/api/src/services/directorAgent/`:

```text
directorAgent.ts                # 对外入口 runDirectorAgent
orchestratedTimelineBuilder.ts  # 主流程(§5 匹配编排)
gapResolutionOptionsBuilder.ts  # 三种解决方式(§6)
transitionOrchestrator.ts       # 转场(§7)
index.ts
```

入口:

```ts
export async function runDirectorAgent(input: {
  projectId: string;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  assetSupplyContext?: AssetSupplyContext;   // ② 的产物,作为证据输入
  contentBrief: ContentBrief;
  categoryPreset?: CategoryPreset;
  boundaries?: Boundary[];
  options?: { hyperframesTransitionWeight?: number; useLlmMatcher?: boolean };
}): Promise<OrchestratedTimeline>;
```

> **硬约束**:Director Agent **不写进** `assetManager/` 目录;**不改** ② 的输出(只读消费 `AssetSupplyContext`);不恢复 `fallbackCards / suggestedRepair` 进 ② 输出。

---

## 5. 匹配 + 编排(交给 LLM)— 详细可执行

`orchestratedTimelineBuilder.ts` 主流程:

1. **跑匹配(复用)**:`const m = await matchSlotsWithFallback({ graph, assets, boundaries });` → `meta.matchSource = m.alignmentSource`。
2. **逐 slot 决策 + 降级阶梯(方案二,已定)**:好→中→差三档,每档有"默认动作",但三选项始终都给用户挑:

   | 档位 | 质量分 | fill | 默认动作(recommended) | 说明 |
   |---|---|---|---|---|
   | **最好** | `≥0.85` | `kind='matched'`, `status='matched'` | **直接用真素材** | 不需要加工 |
   | **差一点** | `0.45–0.85` 且有 assetId | `kind='matched'`, `status='partial'` + `options` | **hyperframes 剪辑增强**(给③的 NL 指导) | 把素材填进去,再用现有素材剪一下顶上;不重拍、不生成 |
   | **最差** | `<0.45` 或无 assetId | `kind='gap'` + `options` | **AIGC 生成补空**(prompt) | 没素材可用,生成补空缺 |

   - partial 档:`fill.kind='matched'` **先把素材填入**,同时 `options` 给增强方案,`recommendedOptionId='hyperframes'`。
   - missing 档:`fill.kind='gap'` **空着**,`options` 三选项,`recommendedOptionId='aigc'`。
   - **`reshoot`(补拍)始终作为选项提供**(最高保真,但需用户去拍),**不在自动降级阶梯里**。
3. **source-specific 闸门(§5.4)**:即使 role 匹配分高,若该 slot 判为"源片专属、不可迁移",**强制降为 partial/gap**(必须给目标品类替代方案),绝不 matched。
4. **时长**:`startMs/endMs` 取 slot 所属 segment 的 `start/end`(ms);同段多 slot 均分或按 `requiredAsset.minDuration`。
5. **transferableIntent**:`sanitizeMotionGrammarText(slot.intent...).sanitizedIntent`(复用,防泄漏)。
6. **videoEngineInstruction**:每个 slot 合成一句给③的执行指令(matched=用该素材+treatment;gap=按 recommended option 执行)。
7. 组 `slots[]` → 调 §7 生成 `transitions[]` → 返回 `OrchestratedTimeline`。

### 5.4 source-specific 闸门(关键正确性)
- 信号来源(已存在):`IngredientTransferability`(`shared/types.ts`)、motif `bannedSourceTerms` / `transferVariables`、slot `sourceInstance` vs `intent` 的差异。
- 规则:若 slot 的关键要素标记为不可迁移、或命中 `bannedSourceTerms`,则**不允许 matched**,必须走 partial/gap 并给目标品类替代。
- 这是防止"MacBook 屏幕交互"这类源片专属语义被直接判定覆盖的闸门。

**测试**(`orchestratedTimelineBuilder.test.ts`):注入 mock LLM(`clientFactory`)→ 每个 shotSlot 恰好一条 OrchestratedSlot;强匹配=matched;弱匹配=partial+options;未命中=gap+3 options;source-specific 高分也降级;LLM 抛错时 `matchSource='rule_based'` 仍出完整时间线;Director Agent **不改** ② 输出对象。

---

## 6. 未命中/弱匹配 → 多种解决方式 — **最详细、最可执行**

`gapResolutionOptionsBuilder.ts`:

```ts
export function buildGapResolutionOptions(args: {
  slot: ShotSlotNode; coverage?: ContextualSlotCoverage; assetSupplyContext?: AssetSupplyContext;
  contentBrief: ContentBrief; categoryPreset?: CategoryPreset; referenceAssetIds: string[]; motif?: ViralMotifAnnotation;
}): { options: GapResolutionOption[]; recommendedOptionId: GapResolutionOption['id'] };
```

每个 gap / partial slot **必须返回恰好 3 个选项**:

### 6.1 `ReshootOption`(补拍)— 复用 `manualShootBrief`,转 NL
- 来源:`buildManualShootBrief` 已给 title/objective/shotDescription/framing/durationSec/mustCapture/avoid。
- 改造:拼成 `guidanceNL`。示例:
  > 「请补拍一个 5 秒竖屏镜头:手打开瓶盖,瓶身标签清楚可见,背景干净不露脸。务必拍到:瓶身标签、开盖动作、冷凝水细节。避免:其他品牌、价格承诺、医疗/健康功效。」
- 工作量:小。

### 6.2 `HyperframesOption`(给③的 NL 剪辑指导)— 半成品,需合成
- 来源:`buildHyperframesBrief`(cardType/copy/visualElements/animationHints)。
- 改造(**新增 NL**):合成 `editingGuidanceNL`。示例:
  > "Use the product packshot as the center layer. Animate ice cube, lemon slice, and tea droplet layers falling from the top, briefly orbiting the bottle, then snapping into a CTA lock-up card. Keep the original product label visible. Do not introduce unauthorized brands or health claims."
- 与 ③ 的 `HyperFramesFillSpec`(`packages/video-agent/src/generation/hyperframesFillSpec.ts`)字段对齐,③ 可直接执行。
- 工作量:中。

### 6.3 `AigcOption`(给生成器的 prompt)— 复用
- 来源:`aigcGenerationBrief.prompt / negativePrompt / referenceAssetIds / aspectRatio / expectedDurationSec / providerHint`。
- 改造:直接映射;**必须** `ownership = 'external_generation_job_card_only'`,不调真实模型。
- 工作量:小。

### 6.4 `recommendedOptionId`(推荐)— 跟随降级阶梯(方案二)
推荐项跟 §5 的"好→中→差"阶梯走,**不是"补拍优先"**:
1. **partial 档 → 推荐 `hyperframes`**:已有勉强可用的素材,剪辑增强最划算(不重拍、不生成、IP 安全)。
2. **missing 档 → 推荐 `aigc`**:无素材可剪,生成补空;若 `aigc` 不 eligible(无产品参考 / 不允许生成),回退推荐 `hyperframes`(卡片兜底永远可执行)。
3. **`reshoot` 始终作为选项**(最高保真):用户愿意去拍可手动选,但不作自动默认。
> 三选项(reshoot/hyperframes/aigc)对 partial 与 missing **都始终给全**,用户可覆盖推荐;`channelEligibility` 仍用来标注每个选项"能不能走"。

**测试**(`gapResolutionOptionsBuilder.test.ts`):每 gap 恰好 3 选项(reshoot/hyperframes/aigc);**partial 档推荐 `hyperframes`、missing 档推荐 `aigc`**(`aigc` 不 eligible 时回退 `hyperframes`);`reshoot.guidanceNL` 含 framing+mustCapture;`hyperframes.editingGuidanceNL` 含 cardType+referencedAssetIds;`aigc.ownership==='external_generation_job_card_only'` 且 prompt 不含源片泄漏词;三选项文案均无品牌/价格/医疗/名人。

---

## 7. 转场编排(hyperframes 高权重 + 抽帧 AIGC 兜底)

> **决策 2(已定):转场逻辑迁入 Director Agent。** 把 `transitions/transitionRecipeGenerator` 的核心(配对 / preset / motif 驱动 / 模板 → 转场配方)搬进 `directorAgent/transitionOrchestrator.ts`,并从消费 `TimelineItem` 改为消费 `OrchestratedSlot`;① 不再负责转场,旧文件随 PR-C 清理。

`transitionOrchestrator.ts`:

```ts
export async function buildOrchestratedTransitions(args: {
  slots: OrchestratedSlot[]; assetCards: AssetCard[]; categoryPreset?: CategoryPreset;
  contentBrief: ContentBrief; hyperframesWeight?: number;   // 默认 0.8
}): Promise<OrchestratedTransition[]>;
```

规则:
1. 相邻 slot 一对一条转场;`transitionFunction` 复用 `inferNarrativeFunction` / `transitionRecipeGenerator`。
2. **默认 `mode='hyperframes'`(权重 0.8,绝大多数走它)**,合成 `editingGuidanceNL`(复用 storyboardPrompt/videoPrompt 转成给③的剪辑指令)。
3. **仅当** 两侧都是真实 `matched` 素材 **且** 母题需要真实帧连续性(如 `chaos_to_order`/`ingredient_to_product`)→ `mode='aigc_frame_bridge'`。
4. 无法判断 → 降级 `cut` 或 `hyperframes`;**不真实生成、不调外部模型**;AIGC frame bridge 只出 prompt/job card。
5. 帧引用未实现时允许占位:`fromTailFrameRef = "required: extract tail frame from slot_x"`(**不因无抽帧能力阻塞本期**)。

**测试**:对数 = slots-1;默认绝大多数 `hyperframes` 且 `editingGuidanceNL` 非空;构造两侧 matched+强母题 → 出现 `aigc_frame_bridge`;gap 侧不要求抽帧。

---

## 8. 帧抽取(后置,不阻塞主期)

`apps/api/src/services/directorAgent/frameExtractor.ts`(可后置):ffmpeg 可用则抽首/尾帧(复用 `render-executor` 的 `resolveFfmpegBin`),不可用返回 undefined → 转场自动降级 hyperframes,绝不让 Director Agent 失败。

---

## 9. Video Agent Handoff(决策 4:A —— 只交付时间线,不渲染)

`apps/api/src/services/videoAgent/orchestratedToAuthored.ts`:把 `OrchestratedTimeline` 映射成 ③ 能读的**结构化时间线 `AuthoredTimeline`**(matched→media beat;gap+所选 option→对应 beat / honest substitute;transition→`beat.transitionOut` 或 hyperframes 指令)。

**Director 的交付物到此为止 = 一条时间线**(`OrchestratedTimeline` + 其 `AuthoredTimeline` 映射)。**Director 不调用渲染、不产出 MP4 成品** —— 渲染由 ③(或后续步骤)在需要时另行执行(③ 已有 `renderAuthoredTimeline`,PR #65),但那不属于 Director 的输出。
> 给 video-agent 的是"**时间线**",不是"渲染好的片子";全程 plan / handoff。

---

## 10. 手测脚本 + 测试

- 手测:`scripts/manual_test_director_agent_timeline.ts` → 输入 macbook_neo structure_graph + kangshifu asset_cards;输出 `tmp/director-agent-orchestrated-timeline.json` + `...report.md`(含 Summary / Slot Timeline / Gap Options / Transition Plan / Video Engine Handoff / External Job Cards / Source Leakage Check)。
- 单测(`directorAgent/*.test.ts`)覆盖 `gpt_plan.md` §10 的 15 条,重点:每 slot 一条;三档匹配;每 gap 三选项;hyperframes 有给③的 NL;aigc 是 job-card-only;相邻一转场;多数 hyperframes;无 MacBook 源词泄漏;**不改 ② 输出**;不恢复 fallbackCards;sample JSON 校验。

---

## 11. 分阶段任务(建议顺序)

- [ ] **P0 契约**:`OrchestratedTimeline` 等加入 `shared`(types+zod+测试)+ sample JSON。
- [ ] **P1 Director 骨架 + 匹配编排**:`directorAgent.ts` + `orchestratedTimelineBuilder.ts`(复用 `matchSlotsWithFallback`,matched/partial/gap + source-specific 闸门)。(§5)
- [ ] **P2 多选项**:`gapResolutionOptionsBuilder.ts`(复用补拍/AIGC,新增 hyperframes NL)。(§6)**← 重点**
- [ ] **P3 转场**:`transitionOrchestrator.ts` —— **迁入** `transitionRecipeGenerator` 逻辑,适配 `OrchestratedSlot`,hyperframes 高权重 + 帧桥接占位。(§7,决策 2)
- [ ] **P4 ③ handoff**:`orchestratedToAuthored.ts`(`OrchestratedTimeline → AuthoredTimeline`,**只交付时间线、不渲染**)+ 手测脚本验证时间线产出。(§9/§10,决策 4)
- [ ] **P5 抽帧(后置)**:`frameExtractor.ts` 真实抽帧。(§8)
- [ ] **P6 接线(低风险)**:`POST /api/director/orchestrate`;不大改 UI。

> 与迁移 PR 的关系:建立在 PR-A/PR-B 之上(③ 已是执行引擎);PR-C 删①中段照旧。现有 `transitionRecipeGenerator` 被 §7 复用。

---

## 12. 硬约束(动手必须遵守)

```text
- Director Agent 独立目录,不塞进 assetManager/;不重写 ② / ③。
- ② 只产 AssetCard + 供给证据;不恢复 fallbackCards / suggestedRepair。
- 全程 plan / handoff:不真实调外部模型、不渲染 MP4、不生成音频;AIGC = job card only。
- 冰红茶只能作 demo fixture / category preset,不硬编码进 core service。
- MacBook 源片语义不得泄漏进 target prompt。
- 不提交 tmp / 大视频 / API key。
```

---

## 13. 待决策(动手前确认)

1. ~~partial 处理~~ **已定(方案二 + 降级阶梯)**:matched 直接用素材;partial **填入素材 + 默认推荐 hyperframes 剪辑增强**;missing **空着 + 默认推荐 aigc 生成补空**;`reshoot` 始终可选但不在自动阶梯。见 §5 表。
2. ~~转场归属~~ **已定:转场逻辑迁入 Director Agent**。`transitions/transitionRecipeGenerator` 的核心搬进 `directorAgent/transitionOrchestrator.ts`,并从消费 `TimelineItem` 改为消费 `OrchestratedSlot`;① 不再拥有转场(PR-C 一并清理)。见 §7。
3. ~~source-specific 闸门数据源~~ **已定:A —— 先用现有信号组装闸门**(`IngredientTransferability` + motif `bannedSourceTerms`),先跑起来,不够用再补专门判定。见 §5.4。
4. ~~handoff 形态~~ **已定:A,但 Director 只交付"时间线",不渲染成品**。`orchestratedToAuthored` 把 `OrchestratedTimeline` 映射成 ③ 能读的 `AuthoredTimeline`(结构化时间线,而非纯文字)交给 ③;**Director 不调用渲染、不产出 MP4**——渲染是 ③/后续步骤的事。见 §9。
5. ~~LLM 匹配缓存~~ **已定(默认决定):v1 不加缓存/限频**。Director 每次 run 仅一次 LLM 调用(频率低、按项目触发),`temperature 0.2` 保证近似稳定;测试一律注入 mock client(`clientFactory`),不打真实 LLM;调用失败由现有规则版匹配兜底。仅当出现"同一 (structureGraph, assetCards) 被反复重排"时,再加一层内容哈希缓存——列为后续优化,不进 v1。

---

## 14. 验收标准(组会口径)

合格 ≠ coverage 更好看,而是:**structure graph 每个 slot 都进 `OrchestratedTimeline`;每个 slot 有明确 fill 决策;每个 missing/partial slot 有三种解决方式;每对相邻 slot 有转场计划;产物可交给 ③;全程仍是 plan/handoff,不假装真实渲染。**

> 一句话:**Director Agent = 把素材匹配、缺口补全、转场编排成一条可执行时间线的编导大脑。**
