# Rough Scan stage 协议 v2 审计 — 4 sub-agent 并行评估

**Date:** 2026-05-23
**Owner:** 严平川 (Fine Scan + Rough Scan)
**Branch:** `codex/fine-scan-peak-micro`
**Status:** ✅ 审计完成 — Phase 1 立即可执行(单一 owner,无需同步)

## 触发事件

`docs/DECISIONS/2026-05-23-graph-protocol-v2-audit.md`(姊妹 ADR)
完成后,对 Rough Scan stage 协议做同样的 4-agent 审计。

**关键差异**:Rough Scan 和 Fine Scan 都是同一 owner 维护(我),
Consumer 就是 Fine Scan 自己 + Stage 1.5 `boundary_micro_scan`。
没人读的字段可以**直接删,无需同步会**。

## 审计范围

Rough Scan stage 产出 6 个 artifacts:

| 文件 | 内容 | Producer |
|---|---|---|
| `rough_structure_scan.json` | Doubao 一次粗扫 5fps 预览版 | Doubao + `scripts/doubao_rough_scan.py` |
| `rough_structure_scan_raw_response.json` | LLM 原始响应 | 调试副产物 |
| `audio_beat_map.json` | 音频节拍 + BPM | `beat_this` 库 |
| `transition_beat_alignment.json` | 边界 vs 音频对齐 | **遗留** — 全代码库无生成代码 |
| `content_transition_timeline.json` | Stage 1.5 合成 timeline | `scripts/assemble_timeline.py` |
| `uploaded_file_info.json` | Doubao 文件 ID 记录 | 上传产物 |

## 4 Agent 核心发现

### Agent A — Producer 视角

**Doubao 编造类字段**(实测后判定不可靠):

1. **`audioOrRhythmSignals[]`** — **5fps 预览没有音频**
   (`audio_beat_map.wav` 是独立产物),所有"音效"描述都是 Doubao 看
   画面臆想 ⚡
2. **`confidence`**(两处)— 11 个 block + 10 个 boundary 全部塞在
   0.8-0.9 区间,无校准
3. **`roughSummary.globalConversionLogic`** — 凭 11 块粗扫推商业逻辑,
   超出可观测范围
4. **`hasInternalTransition`** — 实测 100% true,Doubao 默认填 true
5. **`whyNeedsMicroscope`** — 套话生成器,与 cue 重复

**上游已产但协议没要**:
- `ffprobe` 能产 `videoCodec / aspectRatio / actualFps / audioCodec / durationMs`
- `beat_this` 已产 `BPM / firstDownbeatAt / tempoStability` — 但
  `roughSummary` 在编 `globalConversionLogic` 时**反而没真音频证据**

**自我重复**:
- `rough.contentBlocks[]` ≡ `content_transition_timeline.timelineUnits[content_block]`
  逐字段拷贝
- `contentBlocks[].boundaryReason` ≡ `boundaryCandidates[].visibleBoundaryCue`
- `globalNotes.likelyHookWindow` ≡ `contentBlocks[0].timeRange`
- `globalNotes.likelyCtaRegion` ≡ `contentBlocks[-1].timeRange`
- `uploaded_file_info.uploaded` vs `.ready` — 仅 `status` 不同其余 13 字段全同

### Agent B — Consumer 视角(grep 硬证据)

**真实契约只剩 11 字段:**

| 字段 | grep 命中 | 类型 |
|---|---|---|
| `videoId` | fine_scan, assemble, boundary | driving |
| `contentBlocks[].id` | fine_scan, assemble, boundary | driving |
| `contentBlocks[].timeRange` | fine_scan, assemble, boundary | driving |
| `contentBlocks[].coarseRoleGuess` | fine_scan, boundary | driving(prompt 注入)|
| `contentBlocks[].boundaryReason` | fine_scan | driving(prompt 注入)|
| `contentBlocks[].observableSummary` | fine_scan, boundary | driving(prompt 注入)|
| `contentBlocks[].fineScanFocusQuestions` | fine_scan | driving(prompt 注入)|
| `boundaryCandidates[].id, fromBlockId, toBlockId` | boundary, assemble | driving |
| `boundaryCandidates[].roughBoundaryTime` | boundary | driving |
| `boundaryCandidates[].inspectionWindow` | boundary | driving(裁 clip)|
| `boundaryCandidates[].visibleBoundaryCue` | boundary | driving(prompt)|
| `boundaryCandidates[].whyNeedsMicroscope` | boundary | driving(prompt)|

**整对象 0 消费**:
- `roughSummary`(3 子字段全部 0 命中)
- `globalNotes`(5 子字段全部 0 命中)
- `scanMode`, `sampling`(顶层 0 命中)
- `boundaryCandidates[].confidence`(0 命中)
- `contentBlocks[].hasInternalTransition`(`setdefault` 但 0 下游读)

**副产物文件**:
- `audio_beat_map.json` — driving(fine_scan + boundary 消费)
- `content_transition_timeline.json` — terminal output(目前是 pipeline 终点)
- **`transition_beat_alignment.json` — 0 个 .py 文件命中,可直接删除**
- `uploaded_file_info.json` / `rough_structure_scan_raw_response.json` /
  `rough_structure_scan_response_text.txt` — dump-only,移到 `_debug/`

### Agent C — Schema Engineering

**3 个「三套」严重缺陷**:

#### 三套时间真相源(同一边界 6 个时间值)
```
boundaryCandidates[0].roughBoundaryTime      = 9.5    (Rough LLM)
contentBlocks[0].timeRange.end                = 9.5    (同源)
timelineUnits[1].semanticPivotTime            = 9.336  (Stage 1.5)
timelineUnits[1].timeRange                    = [9.002, 10.503]  (Stage 1.5)
transitionAlignments[0].candidateTime         = 9.5    (代码合成)
audio_beat_map.beats[7].time                  = 9.26   (beat_this 实际)
```
→ 下游无法判断哪个是 SoT,必须定 `canonicalBoundaryTime` 字段

#### 三套 role taxonomy
- Rough `coarseRoleGuess`:7 值
- Fine `roleConfirmation.role`:8 值(3 不重叠)
- `transitionAlignments.fromPossibleRole`:4 值(完全不重叠)

→ 应收敛为单一 `Role` union

#### 三套 ID 命名碎片化
```
主文件:   boundary_001
beat 对齐: rough_trans_001
timeline:  transition_boundary_001
```
→ 应统一为 `boundary_001`

### Agent D — Cross-Category

跨品类可用性 **38 / 100**(比 Graph 42 还低)。

**致命单点**:`fineScanFocusQuestions` 跨品类污染 — Rough 自动生成问题
直接驱动 Fine Scan prompt 上下文。MacBook 样本是 3C 风问题
(「色彩变幻特效是否和音乐卡点对齐?」),迁到网课会问"芯片性能",
迁到探店会问"配色"。

| 品类 | 字段可填率 |
|---|---|
| MacBook 3C | ~80% |
| 小红书美妆 | ~65% |
| 抖音零食带货 | ~55% |
| YouTube 编程网课 | ~30% |
| 大众点评探店 | ~35% |

**必修字段**:
- `coarseRoleGuess` 7 枚举 → 10 枚举(补 `tutorial_step` / `testimonial` /
  `atmosphere_or_context`)
- `likelyVideoType` 5 枚举 → 9 枚举(补 `tutorial / course_preview /
  local_service / lifestyle_vlog`)
- `globalNotes.likelyProductFirstSeenAt` → `likelySubjectFirstSeenAt`
  ("subject" 覆盖产品/课程/服务/人物)
- `dominantPackaging` → 枚举化(`headline / subtitle / feature_card /
  price_strip / chapter_card / menu_label / sticker / ...`)

## 4 Agent 共识 — Phase 1 立即可删

| 字段 | 删除理由 | 证据 |
|---|---|---|
| `scanMode` | 常量 `"global_preview"` | A+B |
| `sampling.{compressed, wholeVideo}` | 常量 true | A+B |
| `roughSummary.globalConversionLogic` | LLM 编商业逻辑;0 下游消费 | A+B |
| `contentBlocks[].audioOrRhythmSignals` | **5fps 预览无音轨,完全臆想** | A |
| `contentBlocks[].hasInternalTransition` | 实测 11/11 都 true,信息熵=0;0 消费 | A+B+C |
| `contentBlocks[].confidence` | 全在 0.85-0.9 无校准;仅 propagate | A+B+C |
| `boundaryCandidates[].confidence` | 0 下游消费 | A+B+C |
| `boundaryCandidates[].whyNeedsMicroscope` | 套话,与 cue 重复 | A+C |
| `globalNotes.likelyHookWindow` | 100% ≡ `contentBlocks[0].timeRange` | A+B |
| `globalNotes.likelyCtaRegion` | 100% ≡ `contentBlocks[-1].timeRange` | A+B |
| `globalNotes.importantOpenQuestions` | ⊂ Σ contentBlocks[*].fineScanFocusQuestions | A+B |
| `transition_beat_alignment.json` 整个文件 | **全代码库无生成代码,0 消费** | B(grep 硬证据)|

## 综合方案 — v2 Rough Scan Stage

### 物理目录重组(Phase 2)

```
seed_assets/analysis/macbook_neo/
├── analysis_manifest.json                    ← 新增:顶层索引
├── stage1_rough/
│   └── rough_structure_scan.v2.json
├── stage1_media/
│   ├── media_technical.json                  ← 新增:ffprobe 输出
│   └── audio_beat_map.v2.json                ← 加 schemaVersion
├── stage1_5_assembly/
│   └── content_transition_timeline.v2.json   ← 去重复字段
└── _debug/                                   ← 调试 dump 隔离
    ├── rough_raw_response.json
    └── uploaded_file_info.json
```

### v2 协议 TypeScript 草案

见父对话中的完整草案。核心:
- 删 14 项(其中 1 个是整个文件)
- 扩 `media_technical.json`(ffprobe)+ `audio_beat_map.v2` 加字段
- 加 `analysis_manifest.json` 顶层索引
- `coarseRoleGuess` → `roleHypothesis: Role | null`(与 Fine 共享)
- `roughBoundaryTime` → `canonicalBoundaryTime`

### 字段精简对比

| | v1 | v2 | 变化 |
|---|---:|---:|---|
| 主输出顶层字段 | 8 | 4 | **-50%** |
| contentBlocks 子字段 | 11 | 7 | **-36%** |
| boundaryCandidates 子字段 | 9 | 6 | **-33%** |
| globalNotes 子字段 | 5 | 2 | **-60%** |
| 副产物文件 | 6 | 4(净 -2)| |
| LLM 编造字段 | 5 | **0** | **彻底清零** |
| 跨品类可用性 | 38 | ~82 | **+115%** |

## 实施路径

### Phase 1(半天)— 删 + 标注,零风险 — **本 ADR 范围**

立即执行(单一 owner,无需同步):

- [ ] 删 Rough Scan prompt 中要求 Doubao 产的 7 个 KILL 字段
- [ ] 删 `doubao_rough_scan.py` 的 `setdefault` 5 处
- [ ] 删 `assemble_timeline.py` `build_content_unit` 中 propagate 2 处
- [ ] 物理删除 `seed_assets/.../transition_beat_alignment.json`
- [ ] 默认路径把 3 个 dump 文件移到 `_debug/`
- [ ] 更新 `tests/test_doubao_rough_scan.py` 添加「字段被剥离」断言
- [ ] pytest 全绿

**预期收益**:Doubao 输出 token 减少 30%+ → Rough Scan 提速 + 省成本。

### Phase 2(1-2 天)— 扩 + 重组

- 加 `media_technical.json`(ffprobe 一行命令)
- `audio_beat_map.v2` 加 `firstDownbeatAt / tempoStability`
- 加 `analysis_manifest.json` 顶层索引
- 物理目录重组(`stage1_rough/` / `stage1_media/` / `stage1_5_assembly/` / `_debug/`)
- 解决三套 ID + 三套时间(`canonicalBoundaryTime` + 统一 `boundary_001`)

### Phase 3(2-3 天)— 跨品类化

- 重写 Rough prompt 为两步生成(`detectedCategory` → 品类问题模板挑题)
- `coarseRoleGuess` 扩 3 个 role
- `likelyVideoType` 扩 4 个枚举
- `globalNotes.likelyProductFirstSeenAt` → `likelySubjectFirstSeenAt`
- 跨品类样本验证(食品/家居/网课各 1 个)

## 备选方案(已评估,被否决)

| 方案 | 否决理由 |
|---|---|
| 保留所有字段以"未来可能用得到" | Agent A+B 多线证据:`audioOrRhythmSignals` 是 LLM 臆想,留之有害 |
| 不重组物理目录,只删字段 | Agent C 三套 ID/时间问题不解决,长期负债持续累积 |
| 单文件方案(合并所有副产物到 rough_structure_scan.json) | 任一阶段重跑要重写整个 blob;版本号难分阶段独立演进 |

## 引用

- 4 sub-agent 原始报告:本会话 transcript `codex/fine-scan-peak-micro`
- 实测样本(重组后):`seed_assets/analysis/macbook_neo/stage1_rough/rough_structure_scan.json`
- 配套副产物在 `stage1_media/` / `stage1_5_assembly/` / `_debug/`
- Prompt:`prompts/video_understanding/rough_structure_scan_v0.md`
- 主脚本:`scripts/doubao_rough_scan.py`
- 装配脚本:`scripts/assemble_timeline.py`
- 姊妹 ADR:`docs/DECISIONS/2026-05-23-graph-protocol-v2-audit.md`

---

## §7. 实施记录(2026-05-23 当日落地)

本 ADR 的 Phase 1 / 2 / 2.5 / 3 在审计完成当日全部实施完毕。
跨品类视频样本验证(Phase 3 §中)需要新视频素材,**punt 到后续 iteration**。

### Phase 1 — KILL 字段清理(零风险删)

**实施:** ✅
- `prompts/video_understanding/rough_structure_scan_v0.md`:删 7 个要 LLM 产的 KILL 字段 + 1 个 confidence 约束句
- `scripts/doubao_rough_scan.py`:`normalize_*` 主动 `pop` 遗留字段(防御性,LLM 可能仍返回)
- `scripts/assemble_timeline.py`:`build_content_unit` 去除 propagate `audioOrRhythmSignals / confidence`
- `scripts/doubao_rough_scan.py`:默认路径迁 3 个 debug dump 到 `_debug/`
- 物理删除 `seed_assets/.../transition_beat_alignment.json`(全代码库无生成代码)
- 新增 4 个测试覆盖字段被剥离

### Phase 2 — 目录重组 + 新增 artifacts

**实施:** ✅
- 创建 v2 子目录结构:
  ```
  seed_assets/analysis/macbook_neo/
  ├── analysis_manifest.json          ← 新增
  ├── stage1_rough/                   ← 主 Rough Scan
  ├── stage1_media/                   ← 媒体 + 音频
  ├── stage1_5_assembly/              ← Stage 1.5 装配
  ├── _debug/                         ← 调试隔离
  └── (历史 fine_scan_*/ ground_truth/ compare_*.* 保留)
  ```
- 移动 8 个旧 artifact 到对应子目录
- 更新 9 处硬编码路径(4 脚本 + 2 测试)
- 新增 `scripts/extract_media_technical.py`(ffprobe wrapper,字段:`aspectRatio/fps/durationMs/width/height/videoCodec/audioCodec`)
- 新增 `scripts/build_analysis_manifest.py`(顶层索引生成器)
- 新增 32 个测试(20 个 media_technical + 12 个 manifest)

### Phase 2.5 — 协议工程修复(P2.5-A/B/C)

**实施:** ✅
- **P2.5-A** `scripts/augment_audio_beat_map.py`:派生 `firstDownbeatAt` + `tempo.stability` + `schemaVersion: audio_beat_map_v2`。从现有 v1 数据后处理,不需要 beat_this 重跑。MacBook Neo 实测:firstDownbeat=3.6s, stability=0.566
- **P2.5-B** `canonicalBoundaryTime` 字段加入 rough scan boundary normalize + assemble_timeline transition unit。解决 Agent C D1 "三套时间真相源" 问题
- **P2.5-C** assemble_timeline `normalize_transition_unit` 把 transition unit id 改为等于 `boundary_id`(单一 ID 哲学:transition unit 是 boundary 的 Stage 1.5 manifestation)。解决 Agent C D8 "三套 ID 命名"
- 新增 17 个测试(8 augment + 1 canonicalBoundaryTime + 1 id 统一 + 1 midpoint fallback + 6 其他覆盖)

### Phase 3 — 跨品类化(P3-A/B/C/D,prompt-only)

**实施:** ✅
- **P3-A** `coarseRoleGuess` 枚举扩展:加 `tutorial_step / testimonial / atmosphere_or_context`(7→10)
- **P3-A** `likelyVideoType` 枚举扩展:加 `tutorial / course_preview / local_service / lifestyle_vlog`(5→9)
- **P3-B** `likelyProductFirstSeenAt` → `likelySubjectFirstSeenAt`("subject" 通用化为产品/课程/服务/人物)+ normalize 加 `_migrate_global_notes_subject_rename` migration helper(双向兼容老 LLM 输出)
- **P3-C** 新增 `roughSummary.detectedCategory`(9 枚举)+ `categoryConfidence`(唯一保留的有消费契约的 confidence,**阈值 0.6**)
- **P3-D** prompt 加 8 套品类问题模板说明(3c/beauty/food/apparel/home/course/local_service/lifestyle)— 指导 LLM 根据 detectedCategory 调整 `fineScanFocusQuestions` 聚焦点。**单次调用**,不增加 Doubao API 成本
- 新增 3 个测试(prompt 新枚举检查 + migration 测试 + 二选一优先级测试)

### 测试矩阵

| 测试文件 | 通过数 | 类型 |
|---|---:|---|
| `test_doubao_rough_scan.py` | **31/31** | 含 Phase 1/2.5/3 新测试 |
| `test_assemble_timeline.py` | **4/4** | 含 v2.5 id 统一 + canonicalBoundaryTime 测试 |
| `test_doubao_boundary_scan.py` | ✅ | Phase 2 路径更新 |
| `test_compare_fine_scan.py` | ✅ | 无影响 |
| `test_extract_media_technical.py` | **20/20** | Phase 2 新文件 |
| `test_build_analysis_manifest.py` | **12/12** | Phase 2 新文件 |
| `test_augment_audio_beat_map.py` | **15/15** | Phase 2.5 新文件 |
| **合计** | **98/98 ✅** | **0 regression** |

注:`test_doubao_fine_scan.py` 1 个失败、`test_visual_peak_detector.py` 全错 — 均因
本机环境缺 `av` 和 `ruptures` 库,**非本次实施引起**。

### e2e 验证

```
$ python scripts/augment_audio_beat_map.py
wrote .../stage1_media/audio_beat_map.json
  schemaVersion=audio_beat_map_v2 firstDownbeatAt=3.6 tempo.bpm=83.33 tempo.stability=0.5659

$ python scripts/build_analysis_manifest.py --video-category 3c
wrote .../analysis_manifest.json
  rough      ok       rough_content_blocks_v1         stage1_rough/rough_structure_scan.json
  media      missing  —                                stage1_media/media_technical.json    ← 待 ffprobe
  audio      ok       audio_beat_map_v2               stage1_media/audio_beat_map.json
  timeline   ok       content_transition_timeline_v1  stage1_5_assembly/content_transition_timeline.json
```

### 字段精简对比(v1 → 实际产物)

| 维度 | v1 | 实际 | 变化 |
|---|---:|---:|---|
| Rough Scan 主输出顶层字段 | 8 | 5 | -38% |
| `contentBlocks[]` 子字段 | 11 | 7 | -36% |
| `boundaryCandidates[]` 子字段 | 9 | 6(+canonicalBoundaryTime)| -33% |
| `globalNotes` 子字段 | 5 | 2(subject 化)| -60% |
| `roughSummary` 子字段 | 3 | 4(+detectedCategory/Confidence)| 净增 |
| LLM 编造字段数 | 5 | **0** | **彻底清零** |
| stage1 副产物文件数 | 6(平铺)| 5(分目录 + manifest)| 净 -1 + 重组 |
| LLM 调用次数 | 1 | **1**(detectedCategory 同次产)| 不变 |

### 后续延期事项

| 工作 | 原因 | 候选时机 |
|---|---|---|
| 跨品类样本验证(食品/家居/网课) | 需要新视频素材 | 用户提供视频后 |
| ViralStructureGraph v2 | 跟下游团队共享协议 | W2-C 同步会后 |
| Fine Scan stage 同款审计 | Fine Scan v0.3 仍稳定 | 下个 iteration |
| `coarseRoleGuess` enum 与 Fine Scan `roleConfirmation.role` 跨 ADR 对齐 | 涉及 Fine Scan prompt 改 | 跟 Graph v2 一起做 |

### 累计代码改动统计

- **新增代码:** ~1000 行(4 新脚本 + 4 新测试文件 + 1 测试扩展)
- **删除代码:** ~36 行(prompt 字段 + propagate)
- **物理删除:** `transition_beat_alignment.json`(死文件)
- **重组:** 8 个 artifact 移到 v2 子目录
- **新增 artifact:** `analysis_manifest.json` + `audio_beat_map_v2` 升级
- **改动文件总数:** 12 个(5 改 + 7 新增)
- **测试覆盖:** **98/98 ✅** ,**0 regression**
