# AssetCard 提取 Pipeline 全解（图片/视频输入 → 切分 → 生成卡片）

> 目的：在你**重做整个 AssetCard 提取**之前，把「当前系统是怎么从一个原始图片/视频，一步步变成一张 `AssetCard` 的」讲清楚——每个环节、每个数据形态、用了什么工具。
> 阅读对象：不需要预先熟悉这套代码。先看 §1 的大局，再按阶段往下读。
> 配套文档：问题诊断见 [docs/pipeline-analysis-and-critique.md](docs/pipeline-analysis-and-critique.md)（本文只讲「现状怎么跑」，不重复讲「哪里错」，但会在每段末尾标注 ⚠️ 关键事实，供你重做时取舍）。

---

## 1. 先搞清楚：现在其实有 **3 条** 提取路径 + 1 个「假数据」来源

很多困惑来自「以为只有一条 pipeline」。实际上 `AssetCard` 可以由 4 个不同的地方产生，**质量天差地别**：

| 路径 | 入口 | 模型真的看了画面吗？ | 产出卡片的 `analysisSource` | 现状用途 |
|------|------|------------------|---------------------------|---------|
| **P1 · Python 库烤制** | `scripts/analyze_asset_library.py` | ✅ **真看**（视频原生上传，按 5fps 采样喂给多模态模型） | 不写（薄卡，加载时补） | 预生成素材库的**正经工具** |
| **P2 · TS 上传 API** | `POST /api/assets/analyze` | ❌ 默认不看（靠文件名+ffprobe元数据）；可选开 VLM 看关键帧 | `deterministic`（或 `optional_vlm` 增强 / `mock_filename_rules` 兜底） | 用户实时上传走这条 |
| **P3 · TS 纯多模态** | `analyzeAssetsLLM()` | ✅ 真看（图片 base64 直传） | `llm_multimodal` | **仅图片、不支持视频**；当前**没接到任何路由**，等于半成品 |
| **F · 测试 fixture** | `scripts/manual_test_asset_manager.ts` | ❌ 全靠文件名+元数据糊 | `deterministic`（手工合成） | **你现在用的 `kangshifu_plain_user_test` 库就是它产的** |

> ⚠️ **最重要的一句话**：你诊断时看到的那个「质量分全是 0.74、关键帧为空、语义是文件名糊的」库，**不是任何一条真 pipeline 跑出来的**，而是 **F（测试 fixture 脚本）** 烤的。所以「重做提取」的第一个决定是：**用 P1（真 VLM）重新烤库，还是把 P2/P3 补全**。

下面把每条路径**从输入到输出逐步拆开**。

---

## 2. 通用第一步：媒体探测（probe）——拿到「这是什么文件」

无论哪条 TS 路径，视频/图片进来都先做**元数据探测**，代码 [apps/api/src/services/assetManager/mediaProbeService.ts](apps/api/src/services/assetManager/mediaProbeService.ts)：

- **视频** `probeVideo`：调用 **ffprobe**（`ffprobe-static`）读出：
  - `durationSec`（时长）、`fps`（帧率，从 `avg_frame_rate` 解析）、`width`/`height`、`aspectRatio`（9:16 / 16:9 / 1:1 / unknown，按宽高比±0.08 容差判断）、`hasAudio`。
  - ffprobe 失败 → 降级：duration=0、fps=0、aspectRatio=unknown，`fallbackUsed=true`。
- **图片** `probeImage`：**不调外部工具**，直接读文件头字节解析宽高（PNG 读偏移 16/20、JPEG 扫 SOF marker、WEBP 读 VP8X）。解析不了就 width/height 留空。

产出统一结构 `AssetMediaProfile`：`{ kind, sourceUrl, fileSizeBytes, format, durationSec?, fps?, width, height, aspectRatio, hasAudio?, keyframes: [] }`（注意此刻 `keyframes` 还是空的）。

> ⚠️ 这一步只拿到**容器级元数据**（多长、多大、什么比例），**完全没有画面语义**。fps/分辨率是准的（真探测），但「画面里有什么」一无所知。

---

## 3. 「切分」这一步：视频 → 关键帧（只有视频、且只在 TS 路径）

你说的「切分」，在这套系统里指的是**视频抽关键帧**，代码 [apps/api/src/services/assetManager/keyframeExtractor.ts](apps/api/src/services/assetManager/keyframeExtractor.ts) 的 `extractAssetKeyframes`：

1. 取 `maxFrames = min(5, …)`——**最多 5 帧**。
2. 在时间轴上**均匀采样**：第 i 帧时间点 = `(i+1) * 时长 / (帧数+1)`。例：10 秒视频取 5 帧 → 大约在 1.7s / 3.3s / 5s / 6.7s / 8.3s。
3. 对每个时间点用 **ffmpeg** `-ss <t> -frames:v 1` 截一张 jpg，存到 `frameDir`，URL 形如 `/media/frames/<assetId>_frame_N.jpg`。
4. 每帧产出 `AssetKeyframe`：`{ id, timeSec, url, description: "Deterministic asset keyframe N", source: 'sampled_frame' }`。

> ⚠️ **三个关键事实，重做时务必知道**：
> 1. 这是**等距时间采样，不是镜头/场景切分**（没有 shot-cut 检测；`scripts/shot_cut_detector.py` 那个是给**源片结构分析**用的，不在素材路径里）。
> 2. 帧的 `description` 只是占位串「Deterministic asset keyframe N」——**没有真实 caption**。真正的画面描述只有在第 5 步 VLM 跑起来、把这些帧图喂给模型后才会有。
> 3. **关键帧只在 P2（TS 上传）跑**。P1（Python）和 F（fixture）产出的卡片 `keyframes: []`——P1 是因为它把整段视频交给模型、不在本地抽帧；F 是因为它压根没抽。**没有关键帧 = 即使开了 VLM 增强（第5步）也没图可看。**

---

## 4. 语义生成：画面里「有什么」——三种截然不同的做法

这是决定卡片质量的核心步骤。三条路差异最大就在这里。

### 4a. P2 默认做法：文件名正则推断（`deterministic`）

代码 [apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts) 的 `inferSemanticFromNameAndText()`——**对文件名跑正则**，不看任何画面：

```ts
const hasUsageCue = /usage|demo|hand|open|cap|drink|开盖|杯|饮用/.test(lower);
// 文件名含 open/cap → detectedObjects 加 'hand','usage scene'；suitableSlots 加 'usage_demo'
const hasBenefitCue = /splash|ice|cold|lemon|冰|柠檬|解腻/.test(lower);
// …以此类推推出 detectedIngredients / visualStyleTags / candidateSlotRoles
```

产出：`spatialDescription`（模板句）、`detectedObjects`、`suitableSlots`、`detectedIngredients`、`visualContent`（占位，如 `subjectPosition: 'center_composition_fallback'`）、`motionPotential`、`candidateSlotRoles`（置信度按顺序递减 0.82/0.76/…）。

> ⚠️ 把 `plain_003_open_cap.mp4` 改名成 `clip.mp4`，输出就完全变了——因为它只读文件名。

### 4b. P2 可选增强：关键帧喂 VLM（`optional_vlm`）

代码 [apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts](apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts) 的 `enrichAssetsWithOptionalVlm()`：

- **默认关闭**，要 `ASSET_VLM_ENABLED=true` + `ASSET_VLM_MODEL` 才启用。
- 把每张卡的**关键帧图片**（`buildMediaContent` 把本地 jpg 转 base64）连同文字 prompt 发给多模态模型，要它返回 `shortCaption / sceneType / productVisible / productVisibilityScore / detectedObjects / suggestedRoles / rationale / risks`。
- 把结果**合并**进卡片：补 detectedObjects、suitableSlots、把 `productVisibilityScore` 灌进 `quality.productFocus/subjectProminence`、丰富 `search` 与 `analysis.vlm`。
- 带**安全过滤** `detectUnsupportedClaims`：caption 里出现「100%/保证/第一/治愈」等会被剔除，不作为产品证据。

> ⚠️ 这条增强**依赖第3步的关键帧存在**。当前库 `keyframes: []` → 即使你开了 VLM，它也没图可发，只能照着「文件名糊出来的 summary」再糊一遍。**要让 VLM 有效，必须先保证有关键帧。**

### 4c. P1 / P3 做法：模型直接看原始素材（真多模态）

- **P1（Python，`scripts/analyze_asset_library.py`）**：把**整个视频/图片文件原生上传**到供应商的 Files API（`upload_file`），用 `input_video` / `input_image` 内容块（视频按 `--upload-fps 5` 采样）发给模型，prompt 用 [prompts/asset_library/asset_card_v0.md](prompts/asset_library/asset_card_v0.md)（或 v1）。模型**真的看到了动作和画面**，返回 spatialDescription/temporalDescription/detectedObjects/suitableSlots/qualityScore/detectedIngredients/humanPresence/visualStyleTags。
- **P3（TS，`analyzeAssetsLLM`）**：图片转 base64 data URL 直传多模态模型，prompt 在 [apps/api/src/services/assetAnalyzer.ts](apps/api/src/services/assetAnalyzer.ts) 里（更细，含 `visualContent`/`motionPotential`/`candidateSlotRoles` 的字段说明）。**显式不支持视频**（遇到 .mp4 直接抛错），且**没接到任何路由**。

> ⚠️ 这两条是「模型真看画面」的路径，质量上限最高。但 **P1 只产薄卡**（见 §6 字段对比），**P3 只能图片**。

---

## 5. 质量打分：那个 0.74 到底怎么来的

两套质量逻辑，看走哪条路：

**(a) P2 真打分** `scoreAssetQuality`（[apps/api/src/services/assetManager/assetQualityScorer.ts](apps/api/src/services/assetManager/assetQualityScorer.ts)）：**逐维度算**——
- `resolution`：按像素数分桶（<1万→0.1；<25万→0.35；<100万→0.62；<200万→0.78；否则0.9）。
- `sharpness=0.6 / brightness=0.62 / contrast=0.58`：**固定常数**（明确警告「Pixel-level … are deterministic fallback estimates」——没做真实像素分析）。
- `composition` 看 aspectRatio 是否已知；`formatFit` 看 9:16/16:9/1:1；`productFocus` 看有无产品线索。
- `overallScore` = 上述 8 项平均。

→ 所以 P2 的质量分**各维度是不一样的**（虽然锐度/亮度是猜的）。

**(b) 加载时合成** `buildDefaultAnalysis`（[apps/api/src/services/assetManager/assetNormalizer.ts](apps/api/src/services/assetManager/assetNormalizer.ts#L49)）：当一张卡**没有 `analysis` 块**时（比如 P1 的薄卡），归一化器把 **`overallScore/resolution/sharpness/brightness/…` 全部设成同一个 `card.qualityScore`**、`keyframes: []`、`textSafeArea:0.7`、`formatFit:0.78`。

> ⚠️ **「全维度同值」就是这么来的**：要么是 F fixture 直接这么写（`inferQualityScore` 像素≥720×1280 就返回 0.74），要么是薄卡进 `normalizeAssetCards` 被合成。**真实像素质量从未被测量过。**

---

## 6. 组装与归一化：拼成最终 `AssetCard`

不管哪条路，最终卡片都要符合 `AssetCardSchema`。一张「完整卡」长这样（以库里 `plain_003_open_cap` 为例，精简）：

```jsonc
{
  "id": "plain_003_open_cap",
  "type": "video",
  "url": "seed_assets/user_test/kangshifu_plain_uploads/plain_003_open_cap.mp4",
  "spatialDescription": "…一句话画面构图…",
  "temporalDescription": "…仅视频：一句话时间维度动作…",
  "detectedObjects": ["beverage bottle","product","hand","usage scene"],
  "suitableSlots": ["usage_demo","product_closeup"],     // 能放进哪些槽位
  "qualityScore": 0.74,
  "detectedIngredients": ["product_closeup_trait","hand_demo","human_presence"],
  "humanPresence": { "hasHuman": true, "actions": ["holding_product"] },
  "visualStyleTags": ["clean_background"],
  "motionPotential": { "isStill": false, "implicitMotion": "high",
                       "canSimulateMotion": [...], "canSimulateDurationMs": [1200,4200] },
  "analysisSource": "deterministic",
  "analysis": {            // 富分析块（AssetAnalysisProfile）—— 下游 slotMatcher 主要读这里
    "media": { "durationSec":10.027, "fps":24, "width":720, "height":1280, "keyframes": [] },
    "semantic": { "summary": "...", "detectedObjects": [...], "motionPotential": {...} },
    "quality": { "overallScore":0.74, "resolution":0.74, … },   // 见 §5
    "slotAffordance": { "suitableSlots":[...], "primaryRoles":[{role,confidence}], "missingRoles":[...] },
    "editability": { "canCropZoom":true, "canLoop":true, "suggestedEdits":[...] },
    "safety": { "status":"passed", "brandRisk":"low", … },
    "search": { "tags":[...], "keywords":[...], "embeddingText":"..." }
  }
}
```

**字段语义速记（下游怎么用）**：
- `suitableSlots` / `analysis.slotAffordance` → 匹配器判断「这素材能不能放进某个角色的槽位」。
- `detectedIngredients`（枚举：hand_demo / product_closeup_trait / clean_background / premium_visual…）→ 与槽位的 `visualIngredientRequirements` 求交集打分。
- `motionPotential.canSimulateDurationMs` → 这素材能撑多长（裁判开 treatmentSpec 时要落在这个区间）。
- `analysis.quality.*` → 质量加分/惩罚。
- `analysis.media.keyframes[].description` → VLM 增强后才有真 caption，是裁判**最关键的视觉证据**（当前为空）。

**两套归一化**：
- **加载时** `loadAssetLibrary`（[apps/api/src/services/assetLibraryLoader.ts](apps/api/src/services/assetLibraryLoader.ts)）：读 `asset_cards.json` → Zod 校验 → `normalizeAssetCards`（缺 `analysis` 就用 §5b 合成，已有则字段级合并补全）。**每次消费库都会跑这一步**，所以 P1 的薄卡在被读取时会被「补全」成完整卡（代价是质量塌成单值、关键帧仍空）。
- **Python 端** `normalize_asset_card`：枚举过滤（剔除模型乱编的枚举值）、`qualityScore` 缺失默认 0.5、`_strip_none`（去掉 null 以适配 Zod `.optional()`）。

---

## 7. 全流程串起来（两张图）

### P2（用户实时上传，TS）
```
上传文件(multer) ─► probe(ffprobe/读文件头) ─► 视频:抽≤5关键帧(ffmpeg均匀采样)
   │                                                      │
   ▼                                                      ▼
inferSemanticFromNameAndText(文件名正则) ──► scoreAssetQuality(逐维度,锐度/亮度是常数)
   │                                                      │
   └──────────────┬───────────────────────────────────────┘
                  ▼
        deterministic AssetCard
                  │  (可选, ASSET_VLM_ENABLED=true 且有关键帧)
                  ▼
        enrichAssetsWithOptionalVlm(关键帧图→VLM→合并caption/role/productFocus)
                  │   任一步抛错 ▼
                  └────────────► analyzeAssetsMock(纯文件名规则, mock_filename_rules)
```

### P1（预烤素材库，Python，真 VLM）
```
clips/*.mp4|jpg ─► upload_file(原生上传, 视频5fps) ─► 多模态模型(看画面)
   │                                                       │
   ▼                                                       ▼
 prompts/asset_library/asset_card_v0|v1.md          返回 AssetCard JSON
   │                                                       │
   └───────────────────────► normalize_asset_card(枚举过滤/默认值) ─► asset_cards.json (薄卡)
                                                                              │
                                            被任何消费方读取时 ▼ loadAssetLibrary
                                            normalizeAssetCards → 补出 analysis(质量塌成单值, keyframes空)
```

---

## 8. 你重做时绕不开的 5 个决策点（现状给的约束）

> 本节只点决策，不展开方案（方案与验收见诊断文档的 P0/P1）。

1. **用哪条路当主力？** 现状能「真看视频」的只有 **P1（Python）**。P2 默认是文件名糊；P3 不支持视频且没接线。→ 重做大概率是「**以 P1 为基础，让它产出富卡**」或「**给 P2 补真实视觉分析**」。
2. **薄卡 vs 富卡的断层。** P1 只产 8 个顶层字段，`analysis`/`keyframes`/`visualContent`/`motionPotential` 全靠 `normalizeAssetCards` 在加载时**合成**——而合成会把质量塌成单值、关键帧留空。→ 想要逐维度质量和真 caption，必须让生成端**直接产出 `analysis` 块**，而不是依赖加载期合成。
3. **关键帧是 VLM 增强的前提。** 没有 `keyframes[]`，P2 的 VLM 增强形同虚设。→ 若走 P2，必须保证抽帧成功（ffmpeg 可用、duration>0）。
4. **「切分」目前是等距采样，不是镜头检测。** 如果你希望卡片能反映「这段视频里有几个动作/镜头」，现状不提供——需要引入 shot-cut 检测（仓库里有 `scripts/shot_cut_detector.py`，但只服务源片结构分析，未接入素材路径）。
5. **语义不许带品牌/型号**（所有 prompt 都强约束）+ **安全过滤**（剔除功效/夸大宣称）。重做时这两条护栏要保留，否则下游防泄漏/合规会破。

---

## 9. 代码位置速查

| 环节 | 文件 | 关键符号 |
|------|------|---------|
| P2 上传路由 | [apps/api/src/routes/assets.ts](apps/api/src/routes/assets.ts) | `POST /analyze` → `analyzeAssetsWithFallbackResult` |
| P2 编排（det+VLM） | [apps/api/src/services/assetManager/assetManagerService.ts](apps/api/src/services/assetManager/assetManagerService.ts) | `analyzeAssetsWithAssetManager` |
| P2 兜底/多模态/mock | [apps/api/src/services/assetAnalyzer.ts](apps/api/src/services/assetAnalyzer.ts) | `analyzeAssetsLLM` / `analyzeAssetsMock` / `analyzeAssetsWithFallbackResult` |
| 媒体探测 | [apps/api/src/services/assetManager/mediaProbeService.ts](apps/api/src/services/assetManager/mediaProbeService.ts) | `probeVideo` / `probeImage` |
| 关键帧切分 | [apps/api/src/services/assetManager/keyframeExtractor.ts](apps/api/src/services/assetManager/keyframeExtractor.ts) | `extractAssetKeyframes` |
| 文件名语义 | [apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts](apps/api/src/services/assetManager/deterministicAssetAnalyzer.ts#L189) | `inferSemanticFromNameAndText` |
| 质量打分 | [apps/api/src/services/assetManager/assetQualityScorer.ts](apps/api/src/services/assetManager/assetQualityScorer.ts) | `scoreAssetQuality` |
| VLM 增强 | [apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts](apps/api/src/services/assetManager/optionalVlmAssetAnalyzer.ts) | `enrichAssetsWithOptionalVlm` |
| 加载归一化（质量塌单值） | [apps/api/src/services/assetManager/assetNormalizer.ts](apps/api/src/services/assetManager/assetNormalizer.ts#L49) | `buildDefaultAnalysis` |
| 库加载 | [apps/api/src/services/assetLibraryLoader.ts](apps/api/src/services/assetLibraryLoader.ts) | `loadAssetLibrary` |
| **P1 Python 库烤制** | [scripts/analyze_asset_library.py](scripts/analyze_asset_library.py) | `process_clip` / `normalize_asset_card` |
| P1 VLM prompt | [prompts/asset_library/asset_card_v0.md](prompts/asset_library/asset_card_v0.md) · v1 | — |
| **当前库的真实出处（fixture）** | [scripts/manual_test_asset_manager.ts](scripts/manual_test_asset_manager.ts) | `inferQualityScore`(0.74) / `buildPlainDescription` |

---

# 第二部分 · 重做计划：从零做一个高质量 AssetCard 提取器

> 目标（用户原话）：从头做一个新的 AssetCard 提取器，**必须符合整个 Asset Manager 和 Director 流程的高质量要求**；并**删掉当前冗余/没用的其他提取器**，避免污染环境。
> 本部分给出：下游契约（§10）→ 新架构与完整 pipeline（§11）→ 技术选型取舍（§12）→ 落地步骤与验收（§13）→ 风险与开放决策（§14）。

## 10. 先定契约：新提取器必须「喂饱」的下游

「高质量」不是抽象词，而是**下游真正会读的字段必须是真的**。把消费方拆开看，新提取器的输出义务就清晰了。

### 10a. slotMatcher LLM 裁判读什么（最关键）

裁判 `summarizeAsset`（[apps/api/src/services/slotMatcher.ts:422](apps/api/src/services/slotMatcher.ts#L422)）发给模型的是：

| 裁判读的字段 | 当前现状 | 新提取器必须产出 |
|---|---|---|
| `analysisEvidence.keyframes[].caption` | **空** | ✅ **每帧真实 caption**（裁判最关键的视觉证据，决定它敢不敢判 partial/matched） |
| `analysisEvidence.semanticShortCaption` | 文件名模板 | ✅ 整片一句话真实描述 |
| `visualContent`（主体/位置/负空间/动感元素/光线/色板） | `*_fallback` 占位 | ✅ 真实视觉构图 |
| `motionPotential`（isStill/implicitMotion/canSimulate*/**动作语义**） | 文件名猜 | ✅ 真实运动 + **观察到的动作动词**（见下） |
| `detectedObjects` / `detectedIngredients`(枚举) / `suitableSlots` / `candidateSlotRoles` | 文件名猜 | ✅ 真实，枚举严格合法 |

> **★ 单点最高杠杆**：源片槽位的 `acceptanceCriteria.anyOf[].motionType` 是抽象迁移钩子（`object_kinetic_handling` / `tactile_interaction` / `pour_flow` / `drink_action` / `slow_kinetic_transform` …）。裁判要能把「一个开盖动作」对上 `tactile_interaction`，**前提是素材卡里有动作语义**。所以新提取器必须显式产出**「观察到的动作」清单**（如 `hand_opens_cap` / `pour_into_cup` / `bottle_rotation` / `first_sip`），让裁判有据可依 —— 这是把 0/27 救回 partial 的核心。

### 10b. Asset Manager（②）读什么

`assetSupplyContextBuilder` / `assetCoverageAnalyzer` / `slotAffordanceScorer` 读：`asset.type`、`analysis.media.{aspectRatio,height,durationSec}`、`detectedObjects`、`detectedIngredients`、`visualStyleTags`、`suitableSlots`、`humanPresence`。
注意：**`analysis.roleAffordance` 不是提取器产的**——它是②在建 supply-context 时由 `slotAffordanceScorer` 现算的。新提取器只需把它的**输入**（detectedIngredients / suitableSlots / quality / humanPresence）做准。

### 10c. Director（③）读什么

经 ② 的 `missingMaterialBriefs` + 直接读卡：`motionPotential.canSimulateDurationMs`（时长能否撑住槽位）、`detectedIngredients`（与槽位 `visualIngredientRequirements` 求交）、`quality`（加分/惩罚）、`humanPresence`（槽位 humanRequirement）。

### 10d. 硬性护栏（所有 prompt 必须保留）

1. **不得输出品牌/型号/产品名**——只描述视觉/动作/构图/人物。
2. **安全过滤**：剔除功效、夸大、明星、销量、医疗类宣称（沿用 `detectUnsupportedClaims`）。
3. **不编造**：看不出的字段返回 `[]`/`null`，并在 `warnings` 标注，**不许像旧 deterministic 那样用文件名假装看见了**。

---

## 11. 新提取器架构与完整 pipeline（修订：Python 原生视频路线）

> **本节已按「Python 原生视频 + asset_card_v2 prompt + full 卡 normalize」修订。** 原「TS 统一 / 关键帧批量」方案作废。
> 核心判断：让 LLM 看**原生连续视频**（供应商服务端按 5fps 抽帧）比 TS 端送几张静帧更能看懂「开盖 / 倒水 / 旋转」这类瞬时动作——而这正是对齐源片槽位 `acceptanceCriteria.motionType` 所必需。该能力（Files API + fps 上传）只在 Python 侧成熟，且 `rough_scan` 与 `analyze_asset_library.py` 已在共用同一套 `llm_client` 基础设施。
> ⚠️ 因落点改为 Python，先前设想的「TS 统一提取器 / 新建 TS bake 脚本」**作废，以本节为准**；TS 端 `deterministic/mock/llm_multimodal` 提取器的**删除**见 §13 第 3 步。

### 11a. 设计原则

- **单一提取器，单一卡片形态**：库烤制为主路径，**演进 `scripts/analyze_asset_library.py`** 为唯一真提取器，输出**完整 full AssetCard**（自带真实 `analysis` 块），**不再依赖加载期 `normalizeAssetCards` 合成**分析块。
- **复用 `llm_client` 摄入设施，重写 prompt + normalize**：原生视频上传 / 并发 / 重试 / 连接池全部复用（见 11b 标注）；真正要新写的只有**富 prompt（asset_card_v2）** 与**产 full 卡的 normalize**。
- **LLM 看原生视频（5fps，自适应）**：用 `upload_file(fps=...)` 让供应商服务端抽帧——这一步**就是「切分」**，交给供应商，本地无需盲采样。
- **诚实兜底**：单个素材调用失败时产出**显式低置信、带 warning** 的瘦卡，**绝不用文件名伪造语义**。

### 11b. 模块落点（修订）

```
scripts/analyze_asset_library.py     # ★演进：唯一真提取器。llm_client 原生视频(5fps) + v2 prompt + full-card normalize
prompts/asset_library/asset_card_v2.md   # ★新建：富 prompt——每帧/关键时刻 caption + 动作动词 + 感知质量维度
                                         #            + visualContent + motionPotential + candidateSlotRoles
scripts/llm_client.py                # ♻复用(不改)：
   upload_file(fps=5)                #   整片上传 + 服务端按 fps 抽帧(preprocess_configs[video][fps])
   wait_for_file / create_response   #   等就绪 + 多模态 Responses 调用(input_video + input_text)
   gated_call / configure_http_semaphore / configure_upload_semaphore  # 并发信号量 + 重试退避(上传单独窄道)
   extract_response_text / extract_json_object / load_prompt_sections / load_dotenv / env_value
scripts/extract_media_technical.py (或 video_tools.py)  # ♻复用：本地 ffprobe 取客观元数据(分辨率/时长/比例)→质量客观项
packages/shared/src/schemas.ts       # 契约：AssetCardSchema 复用；如加 observedActions 字段需同步②读取(见 §14)
```

### 11c. 完整 pipeline（逐阶段，Python）

```
输入：素材 clips/*.mp4|jpg (用户上传的新商品素材)
   │
   ▼ S1 摄入&分类   discover_clips + classify_media_type        [analyze_asset_library 已有]
   │
   ▼ S2 客观元数据   本地 ffprobe → 分辨率/时长/帧率/比例         [复用 extract_media_technical/video_tools]
   │                 （只取「客观可测」的，用于 quality.resolution / canSimulateDurationMs）
   │
   ▼ S3 原生上传(=切分)  upload_file(fps=自适应) + wait_for_file   [♻ llm_client]
   │                 供应商服务端按 5fps(短片提到8~10) 抽帧喂模型——切分交给供应商，本地不盲采
   │
   ▼ S4 多模态理解   create_response(input_video + asset_card_v2 prompt)   [♻ llm_client]
   │                 模型看完整片 → 返回富 JSON：
   │                   shortCaption, temporalDescription,
   │                   keyMoments[{timeSec, caption, action}]   ← 关键时刻(带动作动词)
   │                   detectedObjects[], observedActions[](★对齐 motionType), humanPresence{role,framing,actions},
   │                   visualContent{主体/位置/负空间/动感/光线/色板},
   │                   motionPotential{isStill,implicitMotion,canSimulateMotion,canSimulateDurationMs},
   │                   suggestedRoles[], styleTags[], qualityCues{sharpness,lighting,composition,subjectProminence},
   │                   risks[]
   │
   ▼ S5 关键帧缩略图  对 keyMoments[].timeSec 用 ffmpeg 本地抽帧 → analysis.media.keyframes[]
   │                 每帧 description = 模型给的 caption（来自看过整片的模型，非盲采占位）
   │
   ▼ S6 真实质量     resolution = S2 ffprobe 客观分桶
   │                 sharpness/lighting/composition/subjectProminence = S4 qualityCues(非常数!)
   │                 productFocus = 模型 productVisibility; formatFit = 比例; overallScore = 加权平均
   │
   ▼ S7 枚举映射+安全  suggestedRoles→suitableSlots/candidateSlotRoles; 元素→detectedIngredients(严格枚举);
   │                 observedActions→humanPresence.actions(枚举); 安全过滤(镜像 TS detectUnsupportedClaims)
   │
   ▼ S8 full normalize  normalize_asset_card v2 → 完整卡：
   │                 analysis{media(含keyframes真caption), semantic, quality(逐维度), slotAffordance,
   │                          editability, safety, search} + visualContent + motionPotential +
   │                          analysisSource:'llm_multimodal', fallbackUsed:false
   │                 (枚举过滤 + _strip_none；最终 Zod 校验在加载期 AssetCardSchema.parse)
   │
   ▼ (单片失败/无key) 诚实兜底：仅 S2 客观元数据 + warnings:["no visual analysis"] + 低置信 quality
   │                 analysisSource:'deterministic', fallbackUsed:true（不伪造语义）
   ▼
asset_cards.json (full 卡数组)  ──►  被 loadAssetLibrary 读取(已是 full，normalize 仅做兼容补全)
```

### 11d. 输出形态（与现有 schema 对齐，关键差异）

仍是 `AssetCardSchema`，但相比当前库：`analysis.media.keyframes[].description` = **真 caption（来自关键时刻）**；`analysis.quality.*` = **逐维度真值**（分辨率客观 + 感知来自模型）；`visualContent`/`motionPotential` = **真观察**；`detectedObjects`/`detectedIngredients`/`suitableSlots`/`candidateSlotRoles` = **真分类**；动作动词进 `temporalDescription`/`semantic.summary`/`keyframes[].description`；`analysisSource: 'llm_multimodal'`、`fallbackUsed:false`。
> Python 端不跑 Zod，但 normalize 必须**严格按 `AssetCardSchema` 形状产出**（枚举过滤 + 去 null），校验由加载期 `AssetCardArraySchema.parse` 兜底。

---

## 12. 关键技术选型与取舍（修订后的推荐 + 理由）

| 决策点 | 选项 | **推荐** | 理由 |
|---|---|---|---|
| **核心语言落点** | (a)TS 统一 / (b)Python 原生视频 / (c)双栈 | **(b) Python，演进 `analyze_asset_library.py`** | 原生视频的 Files API 客户端只有 Python 成熟；复用 `rough_scan` 同款 `llm_client`（信号量/重试/连接池），摄入近乎零成本。库烤制是当前主工作流。 |
| **视频理解方式** | 原生整片上传(服务端fps) / 关键帧批量(本地静帧) | **原生整片上传(服务端 5fps)** | 连续帧→开盖/倒水/旋转等瞬时动作保真最高（正是对齐 `motionType` 所需）；一行 `upload_file(fps)` 即得，无需本地盲采样编排。 |
| **「切分」方式** | 本地等距/场景采样 / 服务端fps+模型关键时刻 | **服务端 fps 采样喂模型 + 模型返回 keyMoments → 本地按时间戳抽缩略图** | 采样交给供应商；缩略图只在模型标注的关键时刻抽，caption 来自看过整片的模型，而非盲采占位。 |
| **采样 fps** | 固定 5 / 按时长自适应 | **自适应（默认 5，短片提到 8~10）** | 几秒的素材 5fps 帧太少、动作会被跳过；按时长上调保证关键动作被看到（CLI 加 `--upload-fps` 已有，补自适应逻辑）。 |
| **质量分** | 固定常数 / VLM感知 + 客观分辨率 | **VLM 感知 + 本地 ffprobe 分辨率** | 维度有区分度；分辨率用客观 ffprobe，不靠模型猜。 |
| **兜底语义** | 文件名伪造 / 诚实低置信 | **诚实低置信** | 整个问题的根源就是假数据。兜底宁可“我不知道”也不能假装看见。 |
| **库烤制工具** | 新 TS 脚本 / 演进 Python | **演进 `analyze_asset_library.py`（唯一烤制工具）** | 与提取核心同源；不再维护 TS/Python 双实现，正好删掉 TS 冗余（§13）。 |
| **live 上传 API 怎么调和** | TS 自己分析 / TS spawn 调 Python / 暂缓 | **暂缓（当前工作流不需要）**，需要时让 `POST /api/assets/analyze` **spawn 调 Python 提取器** | 当前是「预烤库→喂 director」，live 上传非关键路径；保留时也复用同一 Python 真路，不再有第二套分析逻辑。 |

---

## 13. 落地步骤与验收（Python 路线，分 4 步）

1. **富 prompt + 复用接线**：写 `prompts/asset_library/asset_card_v2.md`；在 `analyze_asset_library.py` 接入 `extract_media_technical.run_ffprobe`（客观元数据）与 `llm_client.upload_file(fps)`（已具备）。验收：`--dry-run` 能打印 v2 prompt 预览。
2. **full-card normalize**：重写 `normalize_asset_card` → 产出完整 `analysis` 块（含 `media.keyframes` 真 caption、逐维度 `quality`、`visualContent`、`motionPotential`、`candidateSlotRoles`、`semantic`），`analysisSource:'llm_multimodal'`；按模型返回的 `keyMoments[].timeSec` 用 ffmpeg 本地抽缩略图。验收：单素材跑出的卡能通过加载期 `AssetCardArraySchema.parse`，且 quality 维度不同、keyframes 有真 caption。
3. **删冗余 TS 提取器**：先删**孤儿** `analyzeAssetsLLM` + `parseAssetCardResponse`（无非测试引用）及其测试。`analyzeAssetsMock`/`deterministicAssetAnalyzer`/`optionalVlmAssetAnalyzer`/`assetManagerService` 仍被 `routes/demo.ts`、`routes/assets.ts` 依赖，**待 live-upload 决策（§14）后再删/改线**。验收：`pnpm --filter @viral-struct/api typecheck && test` 全绿。
4. **重烤库 & 端到端验证**：用新 `analyze_asset_library.py` 重烤 `kangshifu_plain_user_test`（需 clips 原始素材）→ 跑 [scripts/manual_test_director_agent_timeline.ts](scripts/manual_test_director_agent_timeline.ts)。**验收标准（证明真有提升）**：usage_demo/product_closeup 槽位**出现 matched/partial（不再 0/27）**；aigc 去重率显著上升；source leakage 仍 PASS。
   > ⚠️ 若此步仍大面积 gap，对照诊断文档：可能是**源片 rejectIf 硬门槛**（[docs/pipeline-analysis-and-critique.md](docs/pipeline-analysis-and-critique.md) 的 P0-2）在拖后腿——那是①/③交界问题，需配合处理，不全是提取器的锅。

---

## 14. 风险与开放决策

- **(开放) 视频理解保真度**：服务端 5fps 原生视频够不够抓住"开盖/倒水"这类瞬时动作？若验收第 4 步仍弱，提高自适应 fps 上限或对关键时刻做二次细扫。
- **(开放) 是否给 schema 加 `observedActions`**：能极大帮助裁判对齐 `motionType`；但改 `AssetCardSchema` 是契约变更，需同步②的读取。**当前实现先零 schema 变更**：把动作动词塞进 `temporalDescription` / `semantic.summary` / `keyframes[].description` / `detectedObjects`（裁判经 semanticShortCaption + keyframe caption 读得到）。
- **(开放) live 上传如何调和**：当前 `routes/demo.ts`、`routes/assets.ts` 仍走旧 TS 提取器。要么暂缓（当前工作流不需要），要么让它们 spawn 调 Python。决定后再删剩余 TS 提取器。
- **(风险) 成本/延迟**：每素材一次多模态调用；库烤制已用 `llm_client` 的并发信号量 + 重试。`_debug/<assetId>_raw_response.json` 已留痕，可缓存复用避免重复烧钱。
- **(风险) 兜底退化**：无 VLM key 时全是低置信瘦卡 → Director 会大面积 gap。这是**诚实**的代价，比假数据好；报告里需显式提示「未做视觉分析」。
- **(依赖) 这只是四大根因里的一个**：提取器修好能解 §0 的根因 A，但根因 B（源片 rejectIf）和 C（Director 罐头模板）仍需按诊断文档的 P0-2/P1 推进，才能让最终 prompt 既匹配得上又不重复、真迁移结构。

---

*生成时间：2026-06-09 ｜ 当前库 `kangshifu_plain_user_test` 由 manual_test_asset_manager.ts 烤制（6 卡 / 文件名语义 / 质量 0.74 / 无关键帧）。重做后由演进的 `analyze_asset_library.py` + `asset_card_v2.md` 产出 `llm_multimodal` full 卡。*
