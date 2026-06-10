# Product-Intelligence 驱动迁移 — 优化方案（内部工作版）

> 这份是给我自己实现时看的工作文档，不是对外交付物。目的：把 `product_understanding_driven.md`
> 那份研究报告（它**读不到我们的代码**，模块名是猜的，见报告 line 13/370）和我们**真实的
> asset + director pipeline** 逐项对账，分清「已经有 / 半成品 / 真缺」，再排出务实的落地顺序，
> 避免按报告重建已存在的东西。

---

## 1. 现状 vs 报告 — 逐模块对账

| 报告提议的模块 | 我们真实已有 | 状态 | 真实差距 |
|---|---|---|---|
| **ProductIntelligenceAnalyzer**（复杂度/证明体系/claim 边界/感官仪式/压缩规则，带证据+置信度） | `ContentBriefSchema`（productName / category? / targetAudience / scenario / sellingPoints / cta / stylePreference） | **缺** | 只有薄 brief。无 complexity / proofRegime / proofType / claimBoundary / usageRituals / sensoryCues / 证据链。`category` 只是从 productName 推的字符串。**最大真缺口**，是后面所有模块的目标端语义锚。 |
| **TargetDurationPlanner**（多档 preset） | `orchestratedTimelineBuilder.ts` 的 `targetDurationForMode`：`source_preserve / high_click_15s / high_conversion_20s / full_story_30s` | **机制已有 / 选档缺** | 4 档已存在 ✓（恰好等于报告建议）。但档位是外部写死传入（`DEFAULT_TARGET_DURATION_MODE='high_conversion_20s'`），**没有按产品复杂度自动推荐**；且只设总时长，不改 slot 数。 |
| **StructuralCompressionPlanner**（功能重预算：N 源 → K 目标 beat，keep/compress/merge/replace/drop） | `computeSlotTimings`：纯线性比例缩放，**每个源 slot → 恰好 1 个目标 slot** | **缺（核心病根）** | `targetStartMs = (sourceStartMs/sourceDur)×targetDur`。27 源 slot 1:1 映成 27 目标 slot 等比塞进 20s。详见 §2。 |
| **SourceFunctionMapper**（源功能→目标等价家族） | `sourceSpecificAbstraction.ts`（subtype / abstractGrammar / targetEquivalentLabel / targetEquivalentActions）+ motif 系统 + `transferableIntent` | **半成品** | 有「逐 slot 抽象 + 目标等价动作」碎片 ✓；但没有「整条源 arc 的功能角色 → 目标家族 + keep/merge/replace/drop」的统一规划。报告的 `TargetBeatPlan`（preservedStructureFunction / sourceFunctionFamily / rhythmRole / emotionFunction / proofType / fillStrategy）远更丰富。**和 StructuralCompression 是同一件事的两面。** |
| **三层 rejectIf**（hard / sourceSpecific / transformationHints） | `splitRejectIfForTransfer`（`hardRejectIf` vs `sourceSpecificRejectIf`，队友 9c0f41b） | **基本完成** | 前两层已切 ✓。第三层 transformationHints 部分由 sourceAbstraction 承担。不算瓶颈。 |
| **DirectorPromptContextBuilder**（统一 SlotPromptContext → 3 个 builder） | `channelBriefAuthor.ts`：`SharedChannelIntent → reshoot/hyperframes/aigc` 3 套能力受限 prompt + `authorTimelineOptions.ts`（Part B） | **形状已对 / 内容薄** | 架构形状已经对了 ✓（一份共享中性意图 → 3 套 prompt + validators + fallback）。但 `SharedChannelIntent` 比报告的 `SlotPromptContext` 薄：缺 productIntelligence、preservedStructureFunction、targetEquivalentBeat+reason、claimBoundaries。**补字段即可，不重建。** |
| **evidence-aware SlotMatcher**（AssetEvidenceBundle: keyframe/OCR/ASR/affordance/quality/policyFlags） | `AssetCard.analysis`（semantic / 多维 quality / media.keyframes / humanPresence.actions）+ `candidateSlotRoles` + M3 LLM judge | **半成品** | 证据包大部分有 ✓（关键帧/质量维度/动作/产品可见性/候选角色）；缺结构化 OCR/ASR（plain 图片/短片多半本就无 ASR）。matcher 已是多状态 + LLM judge ✓。**非主瓶颈。** |
| **honest handoff**（materialBackedBeat vs plannedBeat） | `fillStatus` 5 态 + `orchestratedToAuthored`（gap → honest-substitute beat）+ AIGC 仅 plan-only job card | **基本完成** | plan-only 边界、job card、honest substitute、source-leakage check 都在 ✓。 |
| **claimBoundary 前置** | 内容护栏（source-leak / surreal 守卫） | **缺（产品 claim 层）** | 有「源词泄漏 / 超现实」守卫 ✓，但无「健康疗效 / 绝对化第一 / before-after / 价格不一致」**产品广告合规边界**。属 PI 的一部分。 |
| **transition + sonic plan per beat** | `transitions`（transitionFunction / mode / hyperframes / aigcFrameBridge） | **半成品** | transition 有 ✓；`sonicCue` / `soundDependency` 无。P2，不决定生死。 |
| **reviewerEvidenceReport** | `manual_test_director_agent_timeline.ts` 报告（rejectIf transfer / quality dist / slot tiering / prompt diversity / motif / leakage） | **半成品** | 报告框架已很全 ✓；缺 PI / 功能压缩 / 证据使用 / claim 检查章节。 |

**一句话总结对账**：报告里属于 P0 的「rejectIf 拆分」「honest handoff」我们**已经做完**；「4 档时长」「渠道 3-builder」「源抽象」「coverage/supply context」都**已存在**。真正没做的、且最值钱的，是 **Product Intelligence** 和 **功能结构压缩** 两件——其余多为「在已有结构上加字段/加章节」。

---

## 2. 诊断：为什么「迁移效果还不好」（用本次真实 run 的数据说话）

源 `macbook_neo`：229s，**11 个 segment 已带功能角色**（hook×1、selling_point×6、usage×3、cta×1），细分成 27 个 shotSlot（opening_attention×2、product_closeup×10、usage_demo×13、cta_visual×2）。

本次 director run 输出：**27 个目标 slot**，时间 `0-393ms / 393-786ms / …`，27 拍塞进 20s ⇒ 平均 ~740ms/拍，机枪式剪辑。

三个互相叠加的根因：

1. **没有功能重预算（最致命）**：`computeSlotTimings` 把每个源 slot 等比缩放成一个目标 slot。6 个 selling_point 段共 **122s（占源片 53%）的 feature explanation**，被原样保留成 ~16 个 product_closeup/usage 微 slot。对低复杂度饮料，这段本该 **merge + replace 成 1-2 个感官/利益 beat**。我们却把「MacBook 讲 5 个硬件 feature」的结构惯性直接搬进了冰红茶。
2. **没有目标端「靠什么说服」**：缺 proofRegime / proofType。所以即便 Part B 已把渠道内容裁剪得「物理能做到」，slot 的**集合本身**仍是源片的 27 个碎片，而不是饮料该有的 `hook → reveal → sensory cascade → ritual activation → usage payoff → social → benefit → CTA` 八拍。
3. **时长档没按品类选**：20s 是写死的，不是 PI 按「低复杂度冲动品 → balanced_20s」推出来的。

**关键认知**：这次的「删安全 + 信 VLM 打分改造」和之前的 Part B（渠道能力裁剪），都是在「**把已选 slot 表达得更对**」。它们都**不解决**「slot 集合 = 源片 27 碎片」这个上游问题。真正的杠杆在 **PI + 功能压缩**：把 27 碎片重预算成 ~8 个目标功能 beat。

---

## 3. 落地顺序（按「我们的存量」重排报告的 P0-P3）

报告 P0 = PI + 压缩 + rejectSplit + honest handoff。后两者我们已 DONE，所以**我们真实的 P0 收窄为两件因果耦合的事**：

### P0-A · ProductIntelligenceAnalyzer（目标端语义锚）
- `packages/shared`：新增 `ProductIntelligence` 类型 + zod schema（含 `EvidenceSpan{source,text,confidence}`、`ProductFact`、`ClaimBoundary`、`ProofRegime/ProofType/ProductComplexity`、`targetDurationRecommendation`、`sourceFunctionCompressionRules`）。**字段照报告，但裁掉 YAGNI 的**（先不做 multimodal OCR/ASR 输入，留接口）。
- `apps/api/src/services/productIntelligence/productIntelligenceAnalyzer.ts`：
  - **LLM 路径**：ContentBrief 的 productName/sellingPoints/scenario 自由文本 → 结构化 PI。
  - **deterministic fallback**：关键词规则推 category / complexity / proofRegime / 推荐时长 / 基础 claim 风险（demo 稳定性，沿用我们 mock/fallback 一贯做法）。
- **claimBoundary 在此前置生成**（健康疗效 / 绝对化 / before-after / 价格不一致），喂给 prompt context 当 negative 约束。
- 注意：这是**新增的、对外合规层**，跟之前用户让我删的「素材 safety-status 打分」**完全两回事**（那是素材级安全分，已删对了；这是产品广告 claim 边界）。不冲突。

### P0-B · StructuralCompressionPlanner（功能重预算 ← 最直接可见的「效果变好」）
- **在 11 个 segment 层做压缩，不在 27 slot 层**（segment 已自带 functional role，是天然压缩单元；slot 是它的细分，聚合回去即可）。
- 映射：`segment.role(hook/selling_point/usage/cta) → preservedStructureFunction → targetEquivalentFamily`，决策 `keep/compress/merge/replace/drop` 由 **PI.complexity + PI.recommendedProofTypes + duration preset 预算** 驱动。
- 低复杂度饮料预算示例（报告 §MacBook→冰红茶 那张表可直接用）：6 个 selling_point → merge/replace 成 `sensory_cascade` + `benefit_proof` 共 1-2 拍；usage 段 → `ritual_activation` + `usage_payoff`；hook/reveal/cta keep。输出 ~6-8 个 `TargetBeat`，每拍 `mergedSourceSlotIds` 聚合若干源 slot 作证据来源。
- 工程上：把 `computeSlotTimings` 从「逐 slot 等比」换成「**先 plan K 个功能 beat → 再在 beat 内分配时长/选证据 slot**」。Director 的下游（matcher/transition/channel authoring）改成消费 K 个 beat 而不是 27 个 slot。
- ⚠️ **会改 slot 数 → 破坏一大批快照式测试 + 队友的设计假设**。务必**渐进开关**（仿 `AUTHOR_OPTIONS`：加 option/env，默认保留旧 1:1 行为，新行为 opt-in，先在 manual run 验证 timeline 变成 ~8 拍且 feature 段被 merge，再和用户/队友确认后切默认 + 改测试）。

> P0-A 先出最小可用版（哪怕只有 complexity + proofTypes + 推荐时长），P0-B 依赖它的 complexity 决策。两者一起做，PI 先行半步。

### P1
- **DirectorPromptContextBuilder 增强**：把 `SharedChannelIntent` 扩成 `SlotPromptContext`（加 `productIntelligence` / `preservedStructureFunction` / `targetEquivalentBeat+reason` / `claimBoundaries`）。**复用现有 `channelBriefAuthor` 的 3-builder 结构**，只加字段 + prompt 段。低风险、直接去模板味。
- **TargetDurationPlanner 自动选档**：`PI.targetDurationRecommendation.preferred → DEFAULT_TARGET_DURATION_MODE`（替掉写死的 20s）。
- **reviewerEvidenceReport**：report 加 `## Product Intelligence` / `## Source Function Compression` / `## Asset Evidence Usage` / `## Claim Boundary Check` 章节（评委可解释性，性价比高）。
- （可选）若素材含文字，evidence bundle 补 OCR + claim 提取。

### P2
- transition + sonic grammar（`sonicCue` / `soundDependency` per beat；Reels sound-off 也要自洽）。
- marketing-appeal evaluator（AIDA 锚定，参考 GenAd-Bench）。

### P3
- Verifier / Reflector 闭环（NextAds 式）。**比赛冲刺期不做。**

---

## 4. 实现注意（给自己的提醒）

- **不要重建已有的**：rejectIf split、honest handoff、4 档 duration、channel 3-builder、source abstraction、coverage/supply context 全在。一律增量扩展。
- **压缩单元是 segment（11），不是 slot（27）**。
- **渐进开关是硬要求**：P0-B 改 slot 数会连锁破坏队友测试（如 `orchestratedTimelineBuilder.test.ts` 的 degradation ladder、source_specific=partial 等）。默认旧行为，新行为先 opt-in 验证，切默认前必须先和用户/队友打招呼（这是共享分支）。
- **PI 必带 deterministic fallback**（无 LLM / 信心不足时仍可跑）。
- **claim 安全 ≠ 之前删的素材 safety 打分**：别搞混，别把刚删的加回去。
- **测试矩阵**（采纳报告 5 类）：① PI extraction（冰红茶→low_complexity_impulse / proofTypes 含 sensory+usage / forbiddenClaims 含健康疗效&绝对化）；② structural compression（229s feature-heavy + balanced_20s → 输出 ≤20s 且 selling_point 段被 merge/replace，不得逐段保留，beat 数显著 < 源 slot 数）；③ reject split（已有）；④ prompt provenance（同 role 不同 slot 有别 + 含 targetEquivalent + 无源词泄漏）；⑤ handoff honesty（已有）。

---

## 5. 总纲

我们已经把 **plan-only 边界 + 渠道能力裁剪 + 诚实 handoff** 做扎实了。下一跳不是再做生成器，而是补上
**目标产品理解（PI）**，并据此**把源片的 27 个碎片重预算成 ~8 个目标功能 beat**——这才是「迁移效果」
从「换皮模板」跨到「懂产品的结构迁移」的真正杠杆。报告里其余的点，要么我们已有、要么是在已有结构上加字段。

**最小可见收益路径**：P0-A 出最小 PI（complexity + proofTypes + 推荐时长）→ P0-B 用它把 11 segment
重预算成 ~8 beat（opt-in flag）→ manual run 对比「27 拍机枪剪辑」变「8 拍功能化时间线」。这一条就能让
「迁移效果不好」肉眼可见地改善。
