# 全链路深度解析与问题诊断：源片分析 → 素材比对 → 时间线生成

> 写作目的：把「素材分析 → 素材比对 → 时间线生成」整条 pipeline 的每个技术细节讲清楚，并指出**哪里做得不对、哪里能改进**。
> 诊断基线：`kangshifu_plain_user_test` 素材库 × `macbook_neo` 源结构图，27 槽位，LLM 匹配，最近一次运行结果为 **0/27 匹配、aigc 提示词 16/27 去重率、几乎不迁移源片结构**。
> 阅读对象：不需要预先熟悉这套代码。每个阶段都先用大白话讲「它在干嘛」，再讲数据，再讲问题。

---

## 0. 一分钟结论（TL;DR）

这套系统的设计意图是对的，**但效果差不是某一个 bug，而是四个阶段叠加的结果**。按「对最终质量的影响」从大到小排：

| # | 阶段 | 问题一句话 | 严重度 |
|---|------|-----------|--------|
| **A** | 素材分析（②摄入） | **素材卡是用文件名糊出来的**，没真看视频：质量分全是 0.74、关键帧为空、语义来自 `open_cap` 这种文件名关键词 | 🔴 致命 |
| **B** | 源片→结构图（①Python） | 槽位带源专属硬门槛 `acceptanceCriteria.rejectIf`（如「产品形态完全固定无开合结构的素材」），直接把饮料素材判死 | 🔴 致命 |
| **C** | 时间线生成（③Director） | Prompt 作者只按 `(角色, motif, 是否源专属)` 查**罐头模板**，丢掉每个槽位各自的迁移意图 → **高重复 + 不迁移结构** | 🟠 严重 |
| **D** | 匹配（slotMatcher） | 裁判 prompt 本身写得好，但两边都被 A/B 饿死；阈值固定、LLM 在 0.45 线附近抖动 → 结果不稳 | 🟡 中 |

**因果链**：素材是文件名 stub（A）+ 槽位有源专属硬门槛（B）→ 匹配器两边信息都不足，全部判 `quality < 0.45`（D）→ 27 槽全部 fallback 到「生成」分支 → 生成分支用罐头模板、丢弃系统已经算好的精细迁移变量（C）→ 高重复、不迁移结构。

**最该先动的不是 Director 的 prompt（C），而是素材分析（A）和源专属门槛（B）**——因为只要匹配永远是 0，Director 再怎么调都只是在美化「全部要重新生成」这一种退化输出。

---

## 1. 全链路总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 输入：源片视频(MacBook广告)          输入：用户素材(6个康师傅手机片)         │
└─────────────────────────────────────────────────────────────────────────┘
        │                                          │
        ▼  ① 结构分析(Python)                       ▼  ② 素材摄入(Asset Manager)
┌──────────────────────────┐            ┌──────────────────────────────────┐
│ rough_scan  粗扫分块       │            │ deterministicAssetAnalyzer        │
│ fine_scan   精扫每块       │            │  └ 文件名正则推语义 / 质量启发式    │
│ boundary_scan 转场扫描     │            │ optionalVlmAssetAnalyzer (默认关)  │
│   ↓ extract_structure_graph│            │  └ 给VLM喂关键帧→真实caption       │
│ structure_graph.json       │            │   ↓                               │
│  · segments(段落)          │            │ AssetCard[]                       │
│  · shotSlots(槽位)         │            │  · 语义/质量/suitableSlots/keyframe│
│    └ requiredAsset(源专属)  │            └──────────────────────────────────┘
│    └ migrationContract     │                          │
│       intent/sourceInstance│                          │
│       acceptanceCriteria   │                          │
└──────────────────────────┘                          │
        │                                              │
        └───────────────┬──────────────────────────────┘
                        ▼  ③ Director Agent
        ┌────────────────────────────────────────────────┐
        │ 1. slotMatcher  槽位×素材 对齐                    │
        │    matchSlotsLLM(裁判) ─失败→ matchSlots(规则)    │
        │ 2. buildAssetSupplyContext  覆盖度/缺料简报(②产)  │
        │ 3. decideFillStatus  逐槽定档(5态)               │
        │ 4. buildFill  matched→直接用 / partial·gap→3选项 │
        │ 5. transitionOrchestrator  转场                  │
        │ 6. buildReusableAssetPacks  复用素材包            │
        │    ↓                                            │
        │ OrchestratedTimeline (plan-only，不渲染)         │
        └────────────────────────────────────────────────┘
                        ▼
        orchestratedToAuthored → AuthoredTimeline (交给③ Video Agent)
```

> 注：①是 Python（`scripts/`），②③是 TypeScript（`apps/api/src/services/`）。本次手测脚本 [scripts/manual_test_director_agent_timeline.ts](scripts/manual_test_director_agent_timeline.ts) 直接读预先生成好的 `structure_graph.json` 和 `asset_cards.json`，所以①②的产物质量是「已经固定」的输入。

---

## 2. 阶段①：源片 → 结构图（Python）

### 2.1 大白话：它在干嘛

把一条「爆款源片」拆成一张**可迁移的结构骨架**：这片子分几段（segments）、每段要几个镜头（shotSlots）、每个镜头原片拍的是什么、迁移到新商品时要保留什么。

代码：[scripts/extract_structure_graph.py](scripts/extract_structure_graph.py)。它把三个上游扫描产物合并：
- `rough_scan`（粗扫）：把片子切成 11 个内容块，每块猜一个粗角色（hook/卖点/使用/CTA…）。
- `fine_scan`（精扫）：对每块做细颗粒分析，产出 `shotStructure`、`requiredAssetType`、`transferableMotifs`，以及最关键的 **`migrationContract`**（迁移契约）。
- `boundary_scan`（转场扫）：块与块之间的转场类型（morph/wipe/cut…）。

### 2.2 数据：一个槽位长什么样

以 `macbook_neo` 的 `slot_block_002_asset_002`（usage_demo）为例：

```jsonc
{
  "role": "usage_demo",
  "requiredAsset": {
    "subject": "双手将灰色薄型平板状产品拿起，翻转展示边缘、圆角和外壳质感，打开后自动展开为完整笔记本形态…", // ← 源专属原文
    "minDuration": 1.18
  },
  "intent": {                              // migrationContract.intent —— 可迁移意图
    "purpose": "通过双手操作逐步展示产品超薄质感与特殊开合结构，完成产品形态的完整揭晓",
    "motionPattern": "fluid_product_handling_and_transform",
    "durationMs": [15000, 20000]
  },
  "sourceInstance": {                      // 仅供识别"要被替换的东西"
    "productInSource": "灰色超薄MacBook笔记本",
    "specificAction": "双手拿起薄平板状产品翻转展示边缘，逐步打开展开为完整笔记本…"
  },
  "acceptanceCriteria": {                  // 抽象接受标准（OR 关系）
    "anyOf": [
      { "examples": ["双手翻转展示产品细节","产品形态逐步展开"],
        "motionType": "object_kinetic_handling", "compositionType": "centered_subject_clean_bg" },
      { "examples": ["薄产品边缘特写展示","开合结构慢动作演示"],
        "motionType": "slow_kinetic_transform" }
    ],
    "rejectIf": ["背景杂乱的实拍素材", "产品形态完全固定无开合结构的素材"]  // ← 源专属硬门槛
  }
}
```

**设计是聪明的**：`sourceInstance` 是"要被换掉的源产品"（不要求新素材长得像），`acceptanceCriteria.anyOf[].motionType`（`object_kinetic_handling` / `tactile_interaction`）才是**抽象迁移钩子**——一个「手开盖+喝」的动作本质上就是 tactile_interaction，理论上应该能命中。

### 2.3 ❌ 问题点

1. **`acceptanceCriteria.rejectIf` 是源专属的硬门槛，会杀死抽象迁移。**
   `"产品形态完全固定无开合结构的素材"` 这条，是从 MacBook「展开/开合」语义直接抄过来的。康师傅瓶子就是「形态固定、无开合结构」，于是**任何饮料素材都命中 rejectIf 被毙**。抽象层（motionType）给了活路，rejectIf 又把活路堵死。
   → 这条 rejectIf 在阶段③被原样发给 LLM 裁判（见 §4.3），裁判照办。报告里大量「无开合结构」「无产品悬浮变换特效」的拒绝理由就是它。

2. **`requiredAsset.subject` 是源专属原文**（"灰色薄型平板…展开为笔记本"）。下游全靠 sanitize 去防止它泄漏进生成 prompt（§5 防泄漏机制），是「先污染再清洗」，比「源头就分离源专属/可迁移」更脆。

3. **`viralMotifAnnotations` 不在结构图里**（实测 `g.viralMotifAnnotations` 为空）——motif 是阶段③运行时用 TS 重新抽的（§5.1）。这本身不算错，但意味着「源片有什么爆款结构动机」这个核心信息，①没沉淀下来，每次在③靠正则重算。

---

## 3. 阶段②：素材 → AssetCard（Asset Manager 摄入）★最大根因

### 3.1 大白话：它在干嘛

把用户上传的每个素材（视频/图/文案）变成一张**结构化卡片** `AssetCard`：这素材里有什么物体、能放进哪些槽位、画质多少、能不能裁剪/循环、有没有人手……让下游匹配器能「读懂」素材。

有两条分析路径：
- **`deterministicAssetAnalyzer`（默认走这条）**：[apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts)
- **`optionalVlmAssetAnalyzer`（默认关闭）**：[apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts](apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts)，需要 `ASSET_VLM_ENABLED=true` + `ASSET_VLM_MODEL` 才启用。

### 3.2 数据：一张真实卡片有多「空」

`plain_003_open_cap` 这张卡（`analysisSource: "deterministic"`）：

```jsonc
{
  "spatialDescription": "Plain user-shot Kangshifu iced tea video (plain_003_open_cap.mp4); contains hand or usage-action cues; 10.03s", // 模板文本，没真看画面
  "detectedObjects": ["beverage bottle","product","hand","usage scene"],   // 文件名 open_cap → hand/usage
  "qualityScore": 0.74,
  "analysis": {
    "quality": { "resolution":0.74,"sharpness":0.74,"brightness":0.74,"contrast":0.74,
                 "composition":0.74,"lighting":0.74,"productFocus":0.74, … },  // ← 全维度同一个数
    "media": { "keyframes": [] },                                              // ← 没抽关键帧
    "semantic": { "summary": "Plain user-shot Kangshifu iced tea video…" }     // ← 同上模板文本
  }
}
```

它从哪来？`inferSemanticFromNameAndText()`（[deterministicAssetAnalyzer.ts:189](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts#L189)）**对文件名跑正则**：

```ts
const hasUsageCue = /usage|demo|hand|open|cap|drink|开盖|杯|饮用/.test(lower);
// open_cap.mp4 命中 → detectedObjects 加 'hand','usage scene'，suitableSlots 加 'usage_demo'
```

也就是说：**把这些 mp4 改名成 `clip001.mp4`，分析结果就全变了**——因为它压根没看视频内容，全靠文件名猜。

### 3.3 ❌ 问题点（这是 0/27 的最大根因）

1. **素材没被真正分析**：语义来自文件名、质量分是一个复制到所有维度的启发式常数（0.74）、`keyframes: []`。匹配器在阶段③拿到的「素材证据」基本是空的（§4.3 会看到裁判收到的 asset summary 里 keyframe captions 为空、visualContent 是 `*_fallback` 占位符）。

2. **VLM 这条路即使打开也救不了当前库**：`optionalVlmAssetAnalyzer` 靠 `buildMediaContent()` 把**关键帧图片**发给多模态模型（[optionalVlmAssetAnalyzer.ts:195](apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts#L195)）。但这个库 `keyframes: []`——没图可发，VLM 只能照着「文件名糊出来的 summary」再糊一遍。**垃圾进垃圾出。**

3. **质量分无区分度**：所有素材所有维度都 0.74，匹配器里 `quality * 0.1`、`getAnalysisPenalty` 这些项形同虚设，无法把「清晰的产品特写」和「糊的随手拍」区分开。

> **一句话**：阶段③的 LLM 裁判被要求「拿丰富的 MacBook 槽位去对齐『Plain user-shot…contains hand or usage-action cues』这种文件名描述」——它没有任何真实画面信息可依据，只能保守判低分。**这是效果差的第一性原因。**

---

## 4. 阶段③-1：槽位 × 素材 匹配（slotMatcher）

### 4.1 大白话：它在干嘛

给每个源片槽位，从用户素材里挑一个最合适的，并打一个 0–1 的 `quality` 分：
- `quality ≥ 0.85` → `matched`（直接用）
- `0.45 ≤ quality < 0.85` → `partial`（能用但要增强）
- `quality < 0.45` → `missing`/`gap`（没合适的，要补拍或生成）

代码：[apps/api/src/services/slotMatcher.ts](apps/api/src/services/slotMatcher.ts)。入口 `matchSlotsWithFallback`：**先试 LLM 裁判 `matchSlotsLLM`，任何报错就 fallback 到规则打分 `matchSlots`。**

### 4.2 LLM 裁判 prompt（这部分其实写得好）

系统提示（[slotMatcher.ts:341](apps/api/src/services/slotMatcher.ts#L341)）明确写了：

> 「只看意图 + 接受标准，不要让 sourceInstance 把你带跑——新素材不需要和源片产品长得像。」
> 「即使没有任何 asset 能达 ≥0.85，也仍要给出最佳匹配；质量 <0.45 才允许 assetId = null。」

并且最近修过两个真实坑（你的提交 `0135592`）：`response_format: json_object` 不被某些模型支持时**自动重试**、长输出 `max_tokens=8192` 防截断。**这部分是健康的。**

### 4.3 裁判实际收到了什么

`summarizeSlot`（[slotMatcher.ts:410](apps/api/src/services/slotMatcher.ts#L410)）发槽位的 `intent` / `acceptanceCriteria` / `sourceInstance`——**包括 `acceptanceCriteria.rejectIf`**。
`summarizeAsset`（[slotMatcher.ts:422](apps/api/src/services/slotMatcher.ts#L422)）发素材的 `visualContent` / `motionPotential` / `analysisEvidence`（语义短描述、top affordance、质量、**关键帧 caption**）。

对当前数据，这意味着裁判看到的是：
- 槽位侧：丰富且**带 rejectIf 硬门槛**（要「开合结构」，拒「形态固定」素材）。
- 素材侧：`analysisEvidence.keyframes` caption 为空、`visualContent` 是 fallback 占位、`quality 0.74`——**几乎没有可判断的真实证据**。

→ 裁判一边被 rejectIf 要求拒静态饮料，一边对素材一无所知，理性选择就是判 `quality < 0.45`。报告里 27 条全 `missing_generation_required` 且理由多为「无开合结构 / 无对应候选素材」，与此完全吻合。

### 4.4 ❌ 问题点

1. **rejectIf 被原样发给裁判当硬门槛**（根源在①，但③可以选择不发或降级为软提示）。
2. **素材侧信息饥饿**（根源在②）。
3. **阈值全局固定 + LLM 抖动**：0.45/0.85 写死在多处。上一轮同样数据能出 partial、这一轮全 gap，差别就在 LLM 在 0.45 线附近的逐次波动（`temperature: 0.2` 仍有抖动）。匹配结果**不可复现**。
4. **规则 fallback 也不准**：`getSemanticMatch`（[slotMatcher.ts:150](apps/api/src/services/slotMatcher.ts#L150)）主要看 `asset.suitableSlots.includes(role)`——而 `suitableSlots` 也是②用文件名推的。所以 fallback 路径同样建立在文件名猜测上。

---

## 5. 阶段③-2：Director → OrchestratedTimeline

### 5.1 大白话：它在干嘛

拿到「每槽匹配结果 + ②的覆盖度简报」，编排出一条**纯计划**时间线（不渲染、不调外部模型、不出音频）：
- 每槽定一个 `fillStatus`（5 态）；
- `matched` → 直接用素材；`partial`/`gap` → 给「补拍 / HyperFrames / AIGC」三个方案；
- 算转场；算「复用素材包」；做源专属防泄漏。

入口 [apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts)。

### 5.2 motif 抽取：算了一堆精细迁移变量……然后扔掉

`findMotif → extractViralMotifAnnotation`（[apps/api/src/services/motifs/viralMotifExtractor.ts](apps/api/src/services/motifs/viralMotifExtractor.ts)）对每个槽位算出：

```jsonc
{
  "motionTokens": ["assembly_completion","bottle_rotation","snap_open", …],   // 逐槽，从槽位全文正则
  "transferVariables": [                                                       // ★ 精细的源→目标映射
    { "name":"assembly_payoff",
      "sourceValue":"source product assembly",
      "targetValue":"pour to cup or bottle rotation reveal",
      "allowedTargetValues":["pour to cup","bottle rotation","lineup sweep"],
      "notes":"Translate assembly into a drink-state reveal, not hardware construction." },
    { "name":"activation_action", "targetValue":"cap opening or hand-triggered pour", … }
  ],
  "targetCategoryMapping": { "preferredEquivalents":["ice cubes","lemon slices","cap opening","CTA lock-up", …] }
}
```

`transferVariables` 和 `targetCategoryMapping.preferredEquivalents` **正是你想要的「抽象迁移」**：把源片的「组装完成」映射成「倒入杯中/瓶身旋转」，把「交互激活」映射成「开盖/手触发倒水」，还带 `allowedTargetValues` 和 `notes`。

**但是**——`grep` 整个 `directorAgent/` 目录，`transferVariables`、`targetCategoryMapping`、`preferredEquivalents` **只出现在测试文件里，生产代码一次都不读**。Director 实际只用了 `motifType` 和 `motionTokens` 两个字段。

### 5.3 Prompt 是怎么生成的：罐头模板

`buildGapResolutionOptions` → `buildDirectorSpec`（[apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts](apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts)）的逻辑是：

```
spec = zhRoleSpec(slot.role)                        // 按角色查一张写死的中文模板表 ZH_ROLE_SPECS
if (motif.motifType === 'kinetic_assembly_reveal')  // 命中→换成另一张写死的"冰爽级联组装"模板
   spec = { …固定的 label/reshootShot/aigcScene/mustCapture… }
else if (containsSourceSpecificTerm(slotText))      // 命中源专属词→换成"饮料等价镜头"模板
   spec = { …另一张固定模板… }
```

aigc prompt = `罐头 aigcScene` + `motionTokens 经 MOTION_TOKEN_ZH 静态字典翻译的迁移行` + 卖点行。

### 5.4 ❌ 问题点

1. **🟠 高重复（直接对应你的吐槽）**：`buildDirectorSpec` 的 key 只有 `(role, motifType, 是否源专属)` 这一小撮组合。它**完全没读每槽各自不同的 `intent.purpose` / `acceptanceCriteria.anyOf.examples` / `sourceInstance.specificAction`**（这些在结构图里逐槽不同，§2.2 见过）。结果：
   - `block_004` 的 3 个 `kinetic_assembly_reveal` 槽 → reshoot 文案**一字不差**。
   - 所有 `usage_demo` 槽 → 同一份 aigc。实测 **aigc 16/27 去重**，重复全来自此。

2. **🟠 不迁移结构（直接对应你的吐槽）**：系统在 §5.2 已经算出了每槽的 `transferVariables`（源→目标动作映射 + allowedTargetValues + notes），却扔掉不用，改用 `MOTION_TOKEN_ZH` 这张**静态词典**贴标签（`assembly_completion → "组装完成"`）。于是「抽象迁移」退化成「把英文 token 翻成中文词」，丢失了「assembly→倒入杯中」这种真正的结构迁移。

3. **🟡 `source_specific_not_transferable` 是死分支**：`decideFillStatus`（[orchestratedTimelineBuilder.ts:217](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts#L217)）把 `!hasAsset || quality<0.45 → missing_generation_required` 放在最前面判断。只要没素材就直接返回，后面的 `source_specific_not_transferable` 永远轮不到（本次实测命中 0 次）。队友新加的这个 5 态，目前只用得到 1 态。

4. **🟡 ②的精细简报被覆盖**：手测脚本确实调了 `buildAssetSupplyContext`（②）产出 `missingMaterialBriefs`，但 `buildAigcOption` 只从 brief 借 `providerHint`/`expectedDurationSec`，**brief 里逐槽不同的 prompt 文本被丢弃**，改用 §5.3 的罐头。等于②做的 per-slot 工作白做了。

5. **🟡 `reusableAssetPacks` 是写死的饮料清单**：`buildReusableAssetPacks`（[orchestratedTimelineBuilder.ts:609](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts#L609)）硬编码了 9 个饮料 pack（冰爽微距包、开盖使用包…）。思路对（把"一素材多槽"收敛成共享包），但**不是从实际槽位语义聚类出来的**，换个品类（比如美妆）这 9 个包就全错。

6. **（连带现象，非独立 bug）**：因为全是 gap，转场全部退化成 `cut`（转场桥接要求两端都是 matched）；5 态状态只用到 `missing_generation_required` 一态。这些不是 Director 的错，是上游 0 匹配的下游表现。

---

## 6. 把四个阶段串起来：这次 0/27 + 高重复是怎么发生的

```
①源片槽位带 rejectIf"无开合结构判死"  ┐
                                      ├─→ ④裁判：槽位要开合结构 + 素材一无所知
②素材是文件名stub(质量0.74/无关键帧) ┘     → 全部 quality<0.45 → 27槽全 gap
                                              │
                                              ▼
                          ③全部走 gap 三选项分支
                                              │
              ┌───────────────────────────────┴───────────────────────────┐
              ▼                                                             ▼
  buildDirectorSpec 按(role,motif)查罐头模板                 transferVariables/targetCategoryMapping
  → 同role/motif槽位文案塌成一份(16/27去重)                  被算出但不读 → 退化成静态词典贴标签
              │                                                             │
              └──────────────────────────┬──────────────────────────────────┘
                                         ▼
                        高重复 + 不迁移源片结构（你看到的现象）
```

---

## 7. 改进建议（按「投入产出比」排序）

### P0 — 先治根因，否则后面都是给退化输出化妆

- **P0-1 让素材真的被分析（②）。** 二选一或都做：
  - 给现有库**补抽关键帧**（`extractAssetKeyframes` 已存在，只是这个库 `keyframes: []`），再开 `ASSET_VLM_ENABLED=true` 跑一遍 `optionalVlmAssetAnalyzer`，让每张卡有真实 caption / detectedObjects / productVisibilityScore。
  - 或者预烤一个**带真实视觉描述**的 `asset_cards.json`（哪怕人工补 5–10 句中文描述），替掉文件名 stub。
  - 验收：卡片的 `analysis.semantic.summary` 不再是 `"Plain user-shot…"`，`keyframes.length > 0`，质量分维度有差异。

- **P0-2 软化源专属 `rejectIf`（①/③交界）。** 迁移场景下，`"产品形态完全固定无开合结构的素材"` 这类**源品类专属的 rejectIf 不应作为硬门槛发给裁判**。两种改法：
  - ①抽取时就把 `rejectIf` 限定为「品类无关」项（如「背景杂乱」可留，「无开合结构」应剔除或标记为 `sourceSpecific: true`）。
  - 或③`summarizeSlot` 在迁移时过滤掉带源专属语义的 rejectIf，只把 `acceptanceCriteria.anyOf.motionType` 作为正向匹配信号。
  - 验收：同样素材，usage 类槽位能进入 `partial` 而不是全 `gap`。

### P1 — Director prompt 质量（直接解决「重复 + 不迁移」）

- **P1-1 Prompt 作者改为「读每槽自己的迁移契约」而非查罐头模板。** 在 `buildAigcOption` / `buildReshootOption` 里，用 `slot.intent.purpose` + `slot.acceptanceCriteria.anyOf[].examples` + `motif.transferVariables` 来组装 prompt，让每槽文案由其**独有内容**驱动。
  - 验收：aigc 去重率从 16/27 提到接近 27/27；同 role 槽位不再一字不差。

- **P1-2 把已经算好的 `transferVariables` / `targetCategoryMapping.preferredEquivalents` 接进 prompt。** 这是「真正迁移结构」的现成材料：把 `assembly_payoff.targetValue="pour to cup or bottle rotation reveal"` 直接写进 aigc 的迁移行，而不是 `assembly_completion→"组装完成"` 这种贴标签。
  - 验收：aigc 里出现「把源片的组装完成迁移为倒入杯中/瓶身旋转」这类**带源→目标映射**的句子，而非孤立名词。

### P2 — 稳健性

- **P2-1 修 `source_specific_not_transferable` 死分支**：在 `decideFillStatus` 里，把「源专属判断」提到「无素材判断」之前，或在无素材时仍保留该标签，让 5 态真正可用。
- **P2-2 匹配可复现性**：LLM 裁判设 `seed`（若供应商支持）或对 0.45 边界做迟滞（hysteresis）；规则 fallback 不要只靠 `suitableSlots`，纳入 detectedObjects/质量。
- **P2-3 `reusableAssetPacks` 改为从实际槽位聚类生成**（按 role+motionTokens 分组），而非写死饮料清单。

### P3 — 验证方法

- **P3-1 用「匹配得上的源」重测**：当前 MacBook 源 × 康师傅素材本就是极端错配，无法验证 `matched/partial` 阶梯。建议用一个**饮料类源结构图**（或人为构造几个 usage/closeup 槽位）跑一遍，确认 P0/P1 修好后能稳定产出 matched/partial，而不是只验证「全部生成」这一条退化路径。

---

## 8. 附：问题 → 代码位置速查

| 问题 | 文件:行 | 关键符号 |
|------|---------|---------|
| 素材语义来自文件名正则 | [deterministicAssetAnalyzer.ts:189](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts#L189) | `inferSemanticFromNameAndText` |
| 质量分全维度同值 | [deterministicAssetAnalyzer.ts:294](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts#L294) | `buildAnalysisProfile` / `assetQualityScorer` |
| VLM 需关键帧图但库里为空 | [optionalVlmAssetAnalyzer.ts:195](apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts#L195) | `buildMediaContent` |
| 源专属 rejectIf | `structure_graph.json` 各槽 | `acceptanceCriteria.rejectIf` |
| rejectIf 被发给裁判 | [slotMatcher.ts:410](apps/api/src/services/slotMatcher.ts#L410) | `summarizeSlot` |
| 阈值固定 | [slotMatcher.ts:500](apps/api/src/services/slotMatcher.ts#L500) | `statusFromQuality` |
| 精细迁移变量被算出 | [viralMotifExtractor.ts:101](apps/api/src/services/motifs/viralMotifExtractor.ts#L101) | `buildTransferVariables` |
| ……却不被 Director 读 | `grep transferVariables apps/api/src/services/directorAgent/` | 仅命中 `*.test.ts` |
| 罐头模板（重复根源） | [gapResolutionOptionsBuilder.ts](apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts) | `buildDirectorSpec` / `ZH_ROLE_SPECS` |
| 静态词典贴标签 | [gapResolutionOptionsBuilder.ts](apps/api/src/services/directorAgent/gapResolutionOptionsBuilder.ts) | `MOTION_TOKEN_ZH` / `buildAigcOption` |
| 死分支 | [orchestratedTimelineBuilder.ts:217](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts#L217) | `decideFillStatus` |
| 写死的复用包 | [orchestratedTimelineBuilder.ts:609](apps/api/src/services/directorAgent/orchestratedTimelineBuilder.ts#L609) | `buildReusableAssetPacks` |

---

*生成时间：2026-06-09 ｜ 诊断数据：tmp/director-agent-orchestrated-timeline-report.md（27 槽 / 0 匹配 / aigc 16-27 去重）*
