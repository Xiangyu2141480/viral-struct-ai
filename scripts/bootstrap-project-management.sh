#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-Xiangyu2141480}"
REPO="${GITHUB_REPO:-viral-struct-ai}"
FULL_REPO="${OWNER}/${REPO}"

cd "$(git rev-parse --show-toplevel)"

echo "Using repository: ${FULL_REPO}"
gh auth status >/dev/null

if ! gh repo view "${FULL_REPO}" >/dev/null 2>&1; then
  echo "GitHub repository ${FULL_REPO} not found or not accessible."
  exit 1
fi

ensure_milestone() {
  local title="$1"
  local desc="$2"

  if gh api "repos/${FULL_REPO}/milestones?state=all" --jq ".[] | select(.title == \"${title}\") | .number" | grep -q .; then
    echo "Milestone exists: ${title}"
  else
    echo "Creating milestone: ${title}"
    gh api -X POST "repos/${FULL_REPO}/milestones" \
      -f title="${title}" \
      -f description="${desc}" >/dev/null
  fi
}

upsert_label() {
  local name="$1"
  local color="$2"
  local desc="$3"

  if gh label list --repo "${FULL_REPO}" --search "${name}" --json name --jq '.[].name' | grep -Fxq "${name}"; then
    gh label edit "${name}" --repo "${FULL_REPO}" --color "${color}" --description "${desc}" >/dev/null
    echo "Updated label: ${name}"
  else
    gh label create "${name}" --repo "${FULL_REPO}" --color "${color}" --description "${desc}" >/dev/null
    echo "Created label: ${name}"
  fi
}

create_issue_once() {
  local title="$1"
  local milestone="$2"
  local labels="$3"
  local body="$4"

  if gh issue list --repo "${FULL_REPO}" --state all --search "${title} in:title" --json title --jq '.[].title' | grep -Fxq "${title}"; then
    echo "Issue exists: ${title}"
    return 0
  fi

  local label_args=()
  IFS=',' read -ra LABEL_ARRAY <<< "${labels}"
  for label in "${LABEL_ARRAY[@]}"; do
    label_args+=(--label "${label}")
  done

  echo "Creating issue: ${title}"
  gh issue create \
    --repo "${FULL_REPO}" \
    --title "${title}" \
    --milestone "${milestone}" \
    "${label_args[@]}" \
    --body "${body}" >/dev/null
}

append_gitignore_once() {
  local line="$1"
  touch .gitignore
  grep -qxF "${line}" .gitignore || echo "${line}" >> .gitignore
}

echo "Writing .gitignore safeguards..."
append_gitignore_once ""
append_gitignore_once "# Build and cache artifacts"
append_gitignore_once ".turbo/"
append_gitignore_once "**/.turbo/"
append_gitignore_once "*.tsbuildinfo"
append_gitignore_once "apps/web/.next/"
append_gitignore_once "apps/api/dist/"
append_gitignore_once "packages/shared/dist/"
append_gitignore_once "packages/remotion-video/dist/"

echo "Creating milestones..."
ensure_milestone "M1 - P0 Core Loop" "样例输入、基础视频解析、结构抽取、新内容输入和基础结构迁移闭环。"
ensure_milestone "M2 - P0 Gap Detection & Repair" "结构槽位匹配、素材缺口识别、缺口补全策略和补全结果展示。"
ensure_milestone "M3 - P0 Visualization & Demo" "结构迁移可视化、时间线可视化、Remotion 可播放 demo 和结果验证。"
ensure_milestone "M4 - P1 Advanced Creation" "包装生成、多版本生成、真实素材适配、人工可调和自然语言改片。"
ensure_milestone "M5 - Final Delivery" "最终文档、演示视频、视频产物 case、答辩材料和交付检查。"

echo "Creating labels..."
upsert_label "score/p0-core" "0E8A16" "P0 基础闭环得分项：样例输入、结构拆解、结构迁移生成。"
upsert_label "score/p0-gap" "FBCA04" "P0 素材缺口识别与补全得分项。"
upsert_label "score/p0-visualization" "1D76DB" "P0 迁移过程可视化与结果可验证得分项。"
upsert_label "score/p1-packaging" "5319E7" "P1 画面包装生成得分项。"
upsert_label "score/p1-multiversion" "BFD4F2" "P1 多版本生成得分项。"
upsert_label "score/p1-real-assets" "C2E0C6" "P1 真实素材适配得分项。"
upsert_label "score/p1-human-in-loop" "D93F0B" "P1 人机协同、人工可调和自然语言改片得分项。"
upsert_label "score/bonus" "FF7F50" "加分项：自然语言改片、AIGC 补全、强可解释性、工程完成度。"
upsert_label "type/frontend" "BFDADC" "前端页面、交互、可视化相关任务。"
upsert_label "type/backend" "C2E0C6" "后端 API、服务、任务调度相关任务。"
upsert_label "type/ai" "F9D0C4" "LLM、多模态理解、Prompt、Agent、评分器相关任务。"
upsert_label "type/video" "D4C5F9" "FFmpeg、OpenCV、Remotion、视频渲染相关任务。"
upsert_label "type/docs" "FEF2C0" "说明文档、交付材料、答辩材料相关任务。"
upsert_label "risk/demo-critical" "B60205" "影响最终演示闭环的关键任务，必须优先保证可运行。"

echo "Writing README and team docs..."

mkdir -p docs scripts

cat > README.md <<'DOC'
# Viral Struct AI / 爆构引擎

面向营销短视频的 **爆款结构迁移 + 素材缺口补全 + 时间线视频生成** 平台。

本项目不是做一个通用剪辑器，也不是简单让大模型写脚本，而是把优质样例短视频中的创作方法抽象成可迁移的结构协议，再迁移到新的商品、主题或用户素材中。

## 一句话定位

> 从爆款样例中抽取 Hook、节奏、卖点推进、包装样式和镜头槽位，再根据新商品与用户素材自动匹配、识别缺口、补全表达，并生成脚本、分镜、时间线和可播放 demo。

## 当前工程状态

已经完成：

- monorepo 项目骨架
- `apps/web` 前端页面骨架
- `apps/api` 后端 API 骨架
- `packages/shared` 共享类型与结构协议
- `packages/remotion-video` Remotion demo 包骨架
- GitHub Actions CI 基础配置
- 本地 `pnpm typecheck` 和 `pnpm build` 已通过
- 结构迁移项目文档与 GitHub 任务体系初始化

## 技术栈

- Frontend: Next.js / React / TypeScript
- Backend: Node.js / Express / TypeScript
- Shared Protocol: TypeScript + Zod
- Video: FFmpeg / ffprobe / Remotion
- AI: LLM / VLM / ASR / Agent
- Repo: pnpm workspace + Turborepo

## 推荐启动方式

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate

pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm build
pnpm dev
```

## 核心数据流

```txt
Sample Video
  ↓
VideoAnalysis
  ↓
ViralStructureGraph
  ↓
New Content + User Assets
  ↓
AssetCard[]
  ↓
SlotMatch[] + MaterialGap[]
  ↓
GapRepair[]
  ↓
Script + Storyboard + TimelineItem[]
  ↓
Remotion Preview / MP4 Demo
  ↓
QualityReport
```

## 核心创新点

1. **ViralStructureGraph**  
   把短视频抽象成 Hook、痛点、卖点、证明、CTA、节奏、包装、镜头槽位和转场关系。

2. **Structure Slot Matching**  
   不是先写脚本再硬匹配素材，而是先定义每个结构槽位需要什么素材，再匹配用户素材。

3. **Material Gap Detection**  
   明确识别缺少开头吸引镜头、商品特写、使用过程、对比镜头、CTA 镜头等问题。

4. **Gap Repair Planner**  
   通过标题卡、卖点卡、对比卡、CTA 卡、裁切放大、字幕补全、AIGC 背景等方式补足素材不足。

5. **Explainable Timeline Protocol**  
   输出不是纯文本，而是可以被 Remotion 或 FFmpeg 消费的时间线协议。

## 评分目标

目标不是“能生成一个视频”而已，而是尽量覆盖评分表所有得分点：

- P0 基础闭环：25 分
- P0 素材缺口识别与补全：20 分
- P0 可视化与结果验证：20 分
- P1 进阶创作能力：20 分
- 人机协同与整体完成度：15 分
- 加分项：最高 10 分

详细见：

- `docs/TEAM_HANDOFF.md`
- `docs/AI_CONTEXT.md`
- `docs/SCORING_EXECUTION_PLAN.md`
- `docs/DEMO_TARGET.md`
- `docs/ISSUE_INDEX.md`

## 安全边界

- 不复刻样例内容，只迁移结构方法。
- 不复制他人肖像、品牌元素、音乐原片段和受版权保护的画面。
- 用户上传素材默认视为用户有使用权。
- 营销文案中的功效、价格、排名、认证等强事实必须有用户输入或证据来源。
- API Key 只允许放在服务端 `.env`，不得提交到仓库。
DOC

cat > docs/TEAM_HANDOFF.md <<'DOC'
# Team Handoff / 给队友的项目交接说明

## 1. 我们现在已经完成了什么

当前已经完成的是 **参赛项目的工程地基和任务系统**：

- GitHub 仓库已创建：`viral-struct-ai`
- monorepo 骨架已完成
- 前端、后端、共享协议、Remotion 包已经拆好
- 本地 `pnpm install`、`pnpm typecheck`、`pnpm build` 已通过
- CI 已修复 pnpm 版本冲突和 workspace 依赖构建顺序问题
- 已建立项目文档体系
- 已建立 milestones、labels 和 18 个核心 issues

当前项目还不是最终 demo。接下来要把 mock 链路逐步替换成真实能力。

## 2. 项目最终要做成什么

最终 demo 要展示一个完整闭环：

```txt
上传爆款样例视频
  ↓
系统展示基础解析：时长、比例、封面、镜头数、字幕概览
  ↓
系统抽取样例结构：脚本结构、节奏结构、包装结构
  ↓
输入新商品和不完整素材
  ↓
系统识别素材是否能支撑样例结构
  ↓
系统指出哪些结构槽位缺素材
  ↓
系统给出补全策略
  ↓
系统生成新脚本、分镜、时间线和可播放 demo
  ↓
用户可以调整 Hook、卖点顺序、节奏、包装风格
  ↓
系统生成多版本结果
```

## 3. 选择的拿奖方向

我们选择的是：

> 营销类短视频 + Motion Graph 可解释结构迁移

不要做通用剪辑器，也不要做纯脚本生成器。

评委需要看到的是：

- 从样例中抽出了什么结构
- 这个结构如何迁移到新商品
- 用户素材哪里不够
- 系统如何补足缺口
- 最终如何生成时间线和视频 demo

## 4. 核心模块

### 4.1 Video Analyzer

负责样例视频基础解析。

输入：

```txt
sample.mp4
```

输出：

```txt
duration / fps / resolution / cover / keyframes / shots / transcript
```

### 4.2 Structure Extractor

负责从样例中抽结构。

输出：

```txt
ViralStructureGraph
```

至少包含：

- 脚本结构：Hook / 痛点 / 卖点 / 证明 / CTA
- 节奏结构：镜头频率、快慢段、高潮位置
- 包装结构：字幕密度、标题条、卖点卡、转场、封面风格

### 4.3 Asset Analyzer

负责理解用户上传素材。

每个素材输出：

```txt
AssetCard
```

包含：

- 素材类型
- 空间描述
- 时间动作描述
- 适合的结构槽位
- 质量分
- 是否适合做 Hook / 商品特写 / 使用过程 / 对比 / CTA

### 4.4 Slot Matcher

把结构槽位和素材匹配。

输出：

```txt
matched / partial / missing
```

### 4.5 Gap Repair Planner

负责素材缺口补全。

补全方式优先级：

1. 标题卡补全
2. 卖点卡补全
3. 对比卡补全
4. CTA 卡补全
5. 裁切放大和现有素材复用
6. 字幕和文案补全
7. AIGC 背景或封面补全

### 4.6 Timeline Generator

生成：

- 脚本
- 分镜
- 时间线草案
- 包装方案
- Remotion 可播放 demo

## 5. 当前最重要的开发顺序

不要一开始做高级 UI，也不要一开始做 AIGC 视频生成。

优先顺序：

```txt
1. Mock 全链路跑通
2. 样例视频真实解析
3. ViralStructureGraph 真实抽取
4. 用户素材 AssetCard 分析
5. Slot matching
6. Gap detection
7. Gap repair
8. Timeline generation
9. Remotion preview
10. 多版本和人工可调
```

## 6. 队友开发规则

- 先读 `packages/shared/src` 里的类型，不要随便改协议。
- 所有 AI 输出必须经过 schema 校验。
- 所有核心模块都要支持 mock 模式，保证答辩现场可演示。
- 不要把 API Key、Token、Cookie、真实账号密码写进仓库。
- 不要把项目做成通用剪辑器，始终围绕“样例结构迁移”。
- 新功能要对应 GitHub issue。
- Demo-critical 任务优先级最高。

## 7. 最理想的最终展示结果

最终页面至少包括：

```txt
/analyze   样例视频分析
/graph     结构图谱
/adapt     新内容和素材输入
/gaps      素材缺口识别与补全
/result    脚本、分镜、时间线和视频 demo
```

最终答辩要能一句话说明：

> 我们不是复制爆款视频，而是抽取爆款视频的创作结构，并将其迁移到新商品和用户素材中；当素材不足时，系统会识别结构槽位缺口并自动补全。
DOC

cat > docs/AI_CONTEXT.md <<'DOC'
# AI Context / 给队友 AI 助手看的上下文

请所有参与开发的 AI 助手先阅读本文件。目标是避免不同 AI 各做各的，导致项目方向发散。

## 1. 项目身份

项目名称：

```txt
Viral Struct AI / 爆构引擎
```

项目任务：

```txt
爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台
```

项目方向：

```txt
营销短视频结构迁移
```

不要把项目做成：

- 通用视频编辑器
- 纯文案生成器
- 纯 AIGC 视频生成器
- 纯竞品调研文档
- 只上传素材然后让模型生成结果的黑盒工具

## 2. 当前工程事实

- 仓库是 pnpm workspace + Turborepo。
- 前端在 `apps/web`。
- 后端在 `apps/api`。
- 共享协议在 `packages/shared`。
- Remotion demo 在 `packages/remotion-video`。
- 当前本地 typecheck 和 build 已通过。
- CI 中需要先 build `@viral-struct/shared`，否则 API 包无法解析共享类型。

## 3. 核心中间层

所有能力都要围绕：

```txt
ViralStructureGraph
```

不要让 LLM 直接输出散乱文本。

推荐链路：

```txt
VideoAnalysis
  -> ViralStructureGraph
  -> AssetCard[]
  -> SlotMatch[] + MaterialGap[]
  -> GapRepair[]
  -> TimelineItem[]
  -> QualityReport
```

## 4. 必须优先覆盖的评分点

优先级从高到低：

1. P0 基础闭环
2. 素材缺口识别
3. 素材缺口补全
4. 迁移过程可视化
5. 最终 demo 可播放
6. 包装生成
7. 多版本生成
8. 人工可调
9. 自然语言改片

## 5. 不要做的事

- 不要过早实现复杂时间线编辑器。
- 不要过早做复杂转场库。
- 不要把大量时间花在训练模型上。
- 不要依赖线上模型才能跑 demo。
- 不要生成没有证据的营销强断言，比如“销量第一”“全网最低”“医用级”等。
- 不要提交任何密钥。

## 6. 推荐实现策略

每个 AI 模块都应该有两种模式：

```txt
mock mode
real mode
```

mock mode 用于保证答辩稳定。

real mode 用于展示技术能力。

## 7. 结构迁移的关键定义

样例视频不是被复制，而是被抽象为：

- 段落结构
- 镜头槽位
- 节奏模式
- 包装模式
- 转场策略
- 封面风格
- 可迁移规则

新视频不是复刻样例内容，而是复用其创作方法。

## 8. 最重要的展示逻辑

最终页面必须让评委看见：

```txt
样例结构是什么
这些结构映射到新内容哪里
哪些槽位缺素材
系统为什么认为缺
系统选择了什么补全策略
最终时间线如何生成
```

## 9. 推荐 Prompt 原则

要求 LLM 输出 JSON，并说明：

- role
- purpose
- duration
- transferRule
- requiredAsset
- fallbackStrategies
- evidence
- risk

输出后必须用 Zod 校验。

## 10. 一句话项目解释

> Viral Struct AI learns the transferable structure of a viral marketing short video, maps it to a new product and incomplete user materials, repairs missing material slots, and generates an explainable timeline-based video demo.
DOC

cat > docs/SCORING_EXECUTION_PLAN.md <<'DOC'
# Scoring Execution Plan / 评分项执行计划

目标：不是单纯做一个能看的 demo，而是让每一个评分点都有可展示证据。

## 总分结构

| 模块 | 分数 | 我们的目标 |
|---|---:|---|
| 基础闭环完成度 | 25 | 拿 23-25 |
| 素材缺口处理能力 | 20 | 拿 18-20 |
| 结果展示与可验证性 | 20 | 拿 18-20 |
| 进阶能力 | 20 | 拿 16-20 |
| 人机协同与整体完成度 | 15 | 拿 12-15 |
| 加分项 | +10 | 冲 5-10 |

## 1. 基础闭环完成度，25 分

### 1.1 样例输入与基础解析，5 分

实现证据：

- 上传样例视频
- 展示时长、比例、帧率、分辨率
- 展示封面
- 展示关键帧
- 展示镜头数
- 展示字幕或 ASR 概览

目标得分：5/5

### 1.2 结构拆解能力，10 分

实现证据：

- 脚本结构：Hook / 痛点 / 卖点 / 证明 / CTA
- 节奏结构：镜头频率、段落快慢、高潮位置
- 包装结构：字幕密度、标题条、卖点卡、转场、封面风格

目标得分：9-10/10

### 1.3 结构迁移生成能力，10 分

实现证据：

- 根据样例结构和新商品生成脚本
- 生成分镜
- 生成时间线草案
- 生成可播放 demo

目标得分：9-10/10

## 2. 素材缺口处理能力，20 分

### 2.1 素材缺口识别，8 分

实现证据：

- 每个结构槽位都有 matched / partial / missing 状态
- 展示缺少开头吸引镜头
- 展示缺少使用过程镜头
- 展示缺少对比镜头
- 展示缺少 CTA 镜头
- 说明缺口影响哪个段落

目标得分：7-8/8

### 2.2 素材缺口补全，12 分

实现证据：

- 标题卡补全
- 卖点卡补全
- 对比卡补全
- CTA 卡补全
- 裁切放大
- 字幕补全
- 可选 AIGC 背景或封面补全

目标得分：10-12/12

## 3. 结果展示与可验证性，20 分

### 3.1 迁移过程可视化，10 分

实现证据：

- StructureGraph
- MappingTable
- GapBoard
- RepairBoard
- 样例结构到新内容的映射线

目标得分：9-10/10

### 3.2 最终效果展示，10 分

实现证据：

- 分镜表
- 时间线可视化
- Remotion Player
- MP4 demo 或可播放 demo
- 样例结构与新结果对比

目标得分：9-10/10

## 4. 进阶能力，20 分

### 4.1 画面包装能力，8 分

实现证据：

- 字幕样式
- 标题条
- 卖点卡
- 封面方案
- 转场建议
- 强调贴纸或箭头

目标得分：7-8/8

### 4.2 多版本生成，4 分

实现证据：

- 高点击版
- 高转化版
- 高质感版

目标得分：3-4/4

### 4.3 真实素材适配，8 分

实现证据：

- AssetCard
- 素材分类
- 推荐适合槽位
- 高光片段或关键帧筛选

目标得分：6-8/8

## 5. 人机协同与整体完成度，15 分

### 5.1 人工可调，8 分

实现证据：

- 改 Hook 方式
- 改卖点顺序
- 改包装风格
- 改视频节奏
- 改 CTA 表达
- 修改后重新生成结果

目标得分：6-8/8

### 5.2 创意与产品完成度，7 分

实现证据：

- 完整产品流程
- ViralStructureGraph
- Timeline Protocol
- 可解释结构迁移
- 清晰 UI 和演示 case

目标得分：6-7/7

## 6. 加分项

目标：

- 自然语言改片
- AIGC 背景 / 封面补全
- 质量评分面板
- 强可解释图谱
- 工程质量和交互细节

目标加分：5-10
DOC

cat > docs/DEMO_TARGET.md <<'DOC'
# Demo Target / 最终演示目标

## 1. 推荐主 case

商品：

```txt
便携咖啡杯
```

目标用户：

```txt
通勤上班族
```

卖点：

```txt
1. 保温 8 小时
2. 不漏水
3. 单手开盖
4. 可放入车载杯架
```

用户素材故意不完整：

```txt
1. 产品正面图 1 张
2. 手持图 1 张
3. 商品介绍文案 1 段
```

故意缺少：

```txt
1. 开头强视觉镜头
2. 使用过程视频
3. 对比镜头
4. 结尾 CTA 镜头
```

这样可以最大化展示素材缺口识别和补全能力。

## 2. 理想演示流程

### Step 1：上传样例视频

展示：

- 视频封面
- 时长
- 分辨率
- 镜头数
- 字幕 / ASR 概览
- 关键帧

### Step 2：样例结构拆解

展示：

```txt
Hook -> 痛点 -> 卖点 -> 证明 -> CTA
```

同时展示：

- 节奏结构
- 包装结构
- 封面风格
- 转场建议
- 字幕密度

### Step 3：结构图谱

展示 Motion Graph：

```txt
[Hook]
  -> required: opening_attention
  -> package: large title + zoom
  -> transfer rule: 替换为新商品核心痛点

[Pain Point]
  -> required: problem scene
  -> fallback: text_card

[Selling Point]
  -> required: product closeup
  -> fallback: crop_zoom + selling point card

[Proof]
  -> required: comparison shot
  -> fallback: comparison_card

[CTA]
  -> required: end visual
  -> fallback: cta_card
```

### Step 4：输入新商品和素材

展示用户只上传了少量素材。

### Step 5：素材适配

展示 AssetCard：

```txt
产品图：适合 product_closeup / CTA，不适合 usage_demo
手持图：适合 usage_demo 的弱补全，不是真实动作视频
文案：适合脚本和字幕生成
```

### Step 6：缺口识别

展示 GapBoard：

| 结构槽位 | 需要素材 | 当前素材 | 状态 |
|---|---|---|---|
| Hook | 强视觉开头 | 无 | missing |
| 商品特写 | 产品近景 | 产品图 | matched |
| 使用过程 | 操作视频 | 手持图 | partial |
| 对比证明 | 对比镜头 | 无 | missing |
| CTA | 结尾镜头 | 无 | missing |

### Step 7：补全策略

展示 RepairBoard：

| 缺口 | 补全方式 |
|---|---|
| 缺开头镜头 | 标题卡 + 产品图快速推近 |
| 缺使用过程 | 手持图裁切 + 步骤字幕 |
| 缺对比镜头 | 左右对比卡 |
| 缺 CTA | 结尾行动卡 |

### Step 8：生成结果

展示：

- 新脚本
- 分镜
- 时间线
- Remotion 预览
- 样例结构和新结果对比

### Step 9：人工调整

演示：

```txt
把 Hook 改成更抓人
把保温卖点提前
节奏改快
包装风格改成高转化
```

### Step 10：多版本

展示：

- 高点击版
- 高转化版
- 高质感版

## 3. 最终视频效果要求

不要求电影级画面，但必须做到：

- 能播放
- 字幕清楚
- 镜头段落清楚
- 能看到标题卡、卖点卡、对比卡、CTA 卡
- 能看到素材缺口被补全
- 能解释每一段来自哪个样例结构槽位

## 4. 答辩核心话术

> 我们不是复制爆款视频，而是把爆款里的创作结构抽象成可迁移的 ViralStructureGraph。系统会把结构映射到新商品和用户素材上，并检查每个结构槽位是否有素材支撑。当素材不足时，系统会通过标题卡、卖点卡、裁切放大、字幕补全、对比卡和 CTA 卡等方式补全，最后生成脚本、分镜、时间线和可播放 demo。
DOC

cat > docs/ISSUE_INDEX.md <<'DOC'
# Issue Index / GitHub 任务索引

本文件是 GitHub issues 的阅读版索引，方便队友和 AI 快速理解任务边界。

## M1 - P0 Core Loop

1. `[P0-01] 初始化 monorepo、基础工程和 CI`
2. `[P0-02] 样例视频上传与基础解析`
3. `[P0-03] 定义 ViralStructureGraph 结构协议`
4. `[P0-04] 实现样例结构抽取`
5. `[P0-05] 新内容与用户素材输入`

目标：打通样例理解到结构抽取的基础闭环。

## M2 - P0 Gap Detection & Repair

6. `[P0-06] 实现 AssetCard 素材理解`
7. `[P0-07] 实现结构槽位与素材匹配 Slot Matching`
8. `[P0-08] 实现素材缺口识别 Gap Detection`
9. `[P0-09] 实现素材缺口补全 Gap Repair Planner`

目标：拿满素材缺口处理能力相关分数。

## M3 - P0 Visualization & Demo

10. `[P0-10] 生成脚本、分镜和时间线草案`
11. `[P0-11] 实现结构迁移可视化`
12. `[P0-12] 实现 TimelineView 时间线可视化`
13. `[P0-13] 实现 Remotion 可播放视频 demo`

目标：让评委能看见迁移过程和最终结果。

## M4 - P1 Advanced Creation

14. `[P1-14] 画面包装生成`
15. `[P1-15] 多版本生成`
16. `[P1-16] 人工可调`
17. `[BONUS-17] 自然语言改片 Timeline Patch Agent`

目标：冲高分和加分项。

## M5 - Final Delivery

18. `[DELIVERY-18] 完成最终文档、演示视频和视频产物 case`

目标：确保交付完整，答辩稳定。
DOC

cat > docs/CURRENT_STATUS.md <<'DOC'
# Current Status / 当前状态

## 已完成

- 项目仓库初始化
- GitHub 远程仓库绑定
- pnpm workspace 配置
- Turborepo 配置
- 前端、后端、共享协议、Remotion 包目录拆分
- CI pnpm 版本冲突修复
- CI workspace 依赖构建顺序修复
- 本地 `pnpm typecheck` 通过
- 本地 `pnpm build` 通过
- 项目任务体系脚本化

## 当前最近的工程结论

`@viral-struct/shared` 必须在 API、Web、Remotion typecheck 之前 build，否则这些包无法解析共享类型。

因此：

```txt
turbo typecheck dependsOn ^build
CI 里显式先 build @viral-struct/shared
```

## 下一步

优先做 M1：

```txt
1. 样例视频上传
2. ffprobe 基础解析
3. FFmpeg 抽封面和关键帧
4. 手动字幕 fallback
5. VideoAnalysis 数据结构
6. ViralStructureGraph mock 输出
7. 前端 analyze / graph 页面展示
```

## 当前不要做

- 不要先做复杂编辑器
- 不要先做复杂 AIGC
- 不要先重构 monorepo
- 不要修改核心协议名称
- 不要提交密钥
DOC

echo "Creating GitHub issues..."

create_issue_once "[P0-01] 初始化 monorepo、基础工程和 CI" "M1 - P0 Core Loop" "score/p0-core,type/backend,type/frontend,risk/demo-critical" "$(cat <<'BODY'
## 目标

完成项目基础工程，保证仓库可以被评委和队友快速运行。

## 当前状态

基础工程已经搭好，本地 typecheck 和 build 已通过。此 issue 可在 CI 变绿后关闭。

## 验收标准

- `pnpm install` 可执行
- `pnpm typecheck` 可通过
- `pnpm build` 可通过
- `apps/web` 可启动
- `apps/api` 有 `/health` 接口
- GitHub Actions CI 可运行
- README 有本地启动说明
- `.gitignore` 已忽略 `.turbo`、`.next`、`dist`、`*.tsbuildinfo`

## 对应评分

- 产品完成度
- 工程质量
- demo 可运行性
BODY
)"

create_issue_once "[P0-02] 样例视频上传与基础解析" "M1 - P0 Core Loop" "score/p0-core,type/backend,type/video,risk/demo-critical" "$(cat <<'BODY'
## 目标

支持输入 1 条或多条样例视频，并展示基础分析结果。

## 验收标准

- 支持上传样例视频
- 使用 `ffprobe` 展示 duration / fps / resolution / aspect ratio
- 使用 FFmpeg 抽取封面
- 支持关键帧抽取
- 支持简单镜头数统计
- 展示字幕或 ASR 概览
- 支持手动字幕 fallback，避免 ASR 失败影响 demo
- 输出统一的 `VideoAnalysis` 数据结构

## 对应评分

- 样例输入与基础解析：5/5
BODY
)"

create_issue_once "[P0-03] 定义 ViralStructureGraph 结构协议" "M1 - P0 Core Loop" "score/p0-core,type/ai,type/backend,risk/demo-critical" "$(cat <<'BODY'
## 目标

定义项目核心中间层 `ViralStructureGraph`，作为结构抽取、素材匹配、缺口补全和时间线生成的统一协议。

## 验收标准

- 定义 `SegmentNode`
- 定义 `ShotSlotNode`
- 定义 `RhythmStructure`
- 定义 `PackagingStructure`
- 定义 `GraphEdge`
- 定义 `TransferRule`
- 使用 Zod 做结构校验
- 在文档中解释为什么这样定义视频结构
- 所有下游模块只消费结构化协议，不消费散乱文本

## 对应评分

- 结构定义能力
- 结构拆解能力
- 创意与产品完成度
BODY
)"

create_issue_once "[P0-04] 实现样例结构抽取：脚本结构、节奏结构、包装结构" "M1 - P0 Core Loop" "score/p0-core,type/ai,risk/demo-critical" "$(cat <<'BODY'
## 目标

从样例视频分析结果中抽取可迁移结构。

## 验收标准

- 输出脚本结构：Hook / 痛点 / 卖点 / 证明 / CTA
- 输出节奏结构：平均镜头时长、切换频率、快慢段、高潮位置
- 输出包装结构：字幕密度、标题条、卖点卡、转场、封面风格
- 支持 mock 模式
- 支持 LLM 模式
- LLM 输出经过 Zod 校验
- LLM 失败时 fallback 到 mock structure

## 对应评分

- 结构拆解能力：8-10/10
BODY
)"

create_issue_once "[P0-05] 新内容与用户素材输入" "M1 - P0 Core Loop" "score/p0-core,type/frontend,type/backend,risk/demo-critical" "$(cat <<'BODY'
## 目标

支持用户输入新主题、商品信息、卖点和素材。

## 验收标准

- 支持输入商品名称
- 支持输入目标用户
- 支持输入使用场景
- 支持输入核心卖点
- 支持上传图片 / 视频素材
- 支持输入文案素材
- 前端形成 `ContentBrief` 和 `AssetInput`
- 支持便携咖啡杯 demo case

## 对应评分

- 新内容与素材输入
- 结构迁移生成能力
BODY
)"

create_issue_once "[P0-06] 实现 AssetCard 素材理解" "M2 - P0 Gap Detection & Repair" "score/p0-gap,score/p1-real-assets,type/ai,type/video,risk/demo-critical" "$(cat <<'BODY'
## 目标

对用户上传素材进行基础理解，形成 `AssetCard`。

## 验收标准

- 图片素材生成 `spatialDescription`
- 视频素材抽取中间帧
- 视频素材按 1fps 最多抽 5 帧形成 temporal frames
- 输出 `temporalDescription`
- 判断素材适合哪些结构槽位
- 输出 `qualityScore`
- 支持 mock 模式，保证 demo 稳定

## 对应评分

- 真实素材适配：6-8/8
BODY
)"

create_issue_once "[P0-07] 实现结构槽位与素材匹配 Slot Matching" "M2 - P0 Gap Detection & Repair" "score/p0-gap,type/backend,type/ai,risk/demo-critical" "$(cat <<'BODY'
## 目标

把样例结构中的 shot slots 映射到用户素材，判断 matched / partial / missing。

## 验收标准

- 每个 `ShotSlotNode` 都能计算匹配分数
- 输出 matched / partial / missing
- 输出匹配到的 `assetId`
- 输出缺口原因
- 输出影响的结构段落
- 前端可展示匹配表

## 对应评分

- 素材缺口识别：6-8/8
BODY
)"

create_issue_once "[P0-08] 实现素材缺口识别 Gap Detection" "M2 - P0 Gap Detection & Repair" "score/p0-gap,type/backend,type/ai,risk/demo-critical" "$(cat <<'BODY'
## 目标

识别哪些结构槽位无法被当前素材直接满足。

## 验收标准

- 识别缺少开头吸引镜头
- 识别缺少商品特写
- 识别缺少使用过程镜头
- 识别缺少对比镜头
- 识别缺少结尾 CTA 镜头
- 每个 gap 有 severity、reason、affectedSegment
- 前端 GapBoard 可展示

## 对应评分

- 素材缺口识别：8/8
BODY
)"

create_issue_once "[P0-09] 实现素材缺口补全 Gap Repair Planner" "M2 - P0 Gap Detection & Repair" "score/p0-gap,type/ai,type/video,risk/demo-critical" "$(cat <<'BODY'
## 目标

为素材缺口选择合理补全策略并生成可执行结果。

## 验收标准

- 支持 `title_card` 补全开头镜头
- 支持 `selling_point_card` 补全卖点表达
- 支持 `comparison_card` 补全对比镜头
- 支持 `cta_card` 补全结尾行动镜头
- 支持 `crop_zoom` 复用现有图片
- 支持 `caption_rewrite` 用字幕补足画面表达
- 每个 repair 有 reason 和 expectedResult
- 前端展示补全前后对比

## 对应评分

- 素材缺口补全：9-12/12
BODY
)"

create_issue_once "[P0-10] 生成脚本、分镜和时间线草案" "M3 - P0 Visualization & Demo" "score/p0-core,score/p0-visualization,type/ai,risk/demo-critical" "$(cat <<'BODY'
## 目标

基于样例结构、新商品、素材匹配和缺口补全结果，生成新的短视频方案。

## 验收标准

- 输出完整脚本
- 输出分镜表
- 输出 `TimelineItem[]`
- 每个 `TimelineItem` 包含 start / end / role / asset / script / subtitles / packaging
- 缺口补全片段有 repair 标记
- 输出结果可被 Remotion 读取

## 对应评分

- 结构迁移生成能力：8-10/10
- 结果可验证
BODY
)"

create_issue_once "[P0-11] 实现结构迁移可视化 StructureGraph + MappingTable" "M3 - P0 Visualization & Demo" "score/p0-visualization,type/frontend,risk/demo-critical" "$(cat <<'BODY'
## 目标

让评审清楚看到从样例抽取了什么结构，以及这些结构如何映射到新内容。

## 验收标准

- 展示 Hook / 痛点 / 卖点 / 证明 / CTA 节点
- 展示每个节点的 purpose 和 transferRule
- 展示样例结构到新内容的映射
- 展示素材匹配状态
- 展示缺口和补全策略
- UI 中明确区分 extracted / mapped / repaired

## 对应评分

- 迁移过程可视化：8-10/10
BODY
)"

create_issue_once "[P0-12] 实现 TimelineView 时间线可视化" "M3 - P0 Visualization & Demo" "score/p0-visualization,type/frontend,risk/demo-critical" "$(cat <<'BODY'
## 目标

将生成结果以时间线形式展示，方便评委验证结构迁移结果。

## 验收标准

- 展示 0-2s / 2-4s / 4-8s 等时间段
- 每段展示画面描述
- 每段展示脚本和字幕
- 每段展示包装方式
- 每段展示素材来源
- 缺口补全部分有明显标记

## 对应评分

- 最终效果展示
- 分镜 / 时间线可视化结果
BODY
)"

create_issue_once "[P0-13] 实现 Remotion 可播放视频 demo" "M3 - P0 Visualization & Demo" "score/p0-visualization,type/video,type/frontend,risk/demo-critical" "$(cat <<'BODY'
## 目标

根据 `TimelineItem[]` 生成可播放 demo。

## 验收标准

- Remotion Player 可预览
- 支持标题卡
- 支持卖点卡
- 支持对比卡
- 支持 CTA 卡
- 支持字幕显示
- 支持图片 crop_zoom / push_in 动效
- 支持导出或生成 MP4 demo

## 对应评分

- 最终效果展示：8-10/10
BODY
)"

create_issue_once "[P1-14] 画面包装生成：字幕、标题条、卖点卡、封面方案" "M4 - P1 Advanced Creation" "score/p1-packaging,type/frontend,type/ai,type/video" "$(cat <<'BODY'
## 目标

增强包装能力，覆盖 P1 评分项。

## 验收标准

- 支持字幕样式 / 排版建议
- 支持标题条生成
- 支持卖点卡片生成
- 支持封面文案或封面方案
- 支持转场建议
- 包装方案与视频内容有关联

## 对应评分

- 画面包装能力：6-8/8
BODY
)"

create_issue_once "[P1-15] 多版本生成：高点击、高转化、高质感" "M4 - P1 Advanced Creation" "score/p1-multiversion,type/ai,type/frontend" "$(cat <<'BODY'
## 目标

同一内容输出多个创作版本，增强展示效果。

## 验收标准

- 支持高点击版
- 支持高转化版
- 支持高质感版
- 三个版本的 hook、节奏、字幕密度、CTA 有明显差异
- 前端支持切换版本并比较差异

## 对应评分

- 多版本生成：3-4/4
BODY
)"

create_issue_once "[P1-16] 人工可调：Hook、卖点顺序、节奏、包装风格" "M4 - P1 Advanced Creation" "score/p1-human-in-loop,type/frontend,type/ai" "$(cat <<'BODY'
## 目标

支持用户对生成结果进行可控修改并重新生成。

## 验收标准

- 支持修改 hook 方式
- 支持调整卖点顺序
- 支持调整节奏速度
- 支持调整包装风格
- 修改后 timeline 有明显变化
- 前端展示修改前后差异

## 对应评分

- 人工可调能力：6-8/8
BODY
)"

create_issue_once "[BONUS-17] 自然语言改片 Timeline Patch Agent" "M4 - P1 Advanced Creation" "score/p1-human-in-loop,score/bonus,type/ai,type/frontend" "$(cat <<'BODY'
## 目标

支持用户用一句话修改生成结果。

## 验收标准

- 输入：“开头更抓人一些”
- 输入：“把商品卖点提前”
- 输入：“减少字幕，增强节奏感”
- 系统输出 timeline patch
- 前端展示修改了哪些节点
- 重新生成脚本和时间线

## 对应评分

- 自然语言改片加分项
- 人机协同亮点
BODY
)"

create_issue_once "[DELIVERY-18] 完成最终文档、演示视频和视频产物 case" "M5 - Final Delivery" "type/docs,type/video,risk/demo-critical" "$(cat <<'BODY'
## 目标

准备最终答辩和评审材料，确保交付完整。

## 验收标准

- README 完整
- `docs/ARCHITECTURE.md` 完整
- `docs/TOOL_PROTOCOL.md` 完整
- `docs/SAFETY_BOUNDARY.md` 完整
- `docs/SCORING_EXECUTION_PLAN.md` 完整
- 有完整演示视频
- 有至少 1 个视频产物 case
- 有样例结构截图
- 有新商品迁移截图
- 有素材缺口识别截图
- 有补全策略截图
- 有生成时间线截图
- 有最终 demo 视频
- 有前后对比展示
- 说明使用了哪些 AI 工具
- 说明哪些部分是自主设计与实现

## 对应评分

- 最终效果展示
- 可验证性
- 交付完整性
- 安全边界要求
BODY
)"

echo "Committing generated docs and project management script..."
git add README.md docs scripts/bootstrap-project-management.sh .gitignore || true

if [ -f pnpm-lock.yaml ]; then
  git add pnpm-lock.yaml
fi

if [ -f apps/web/next-env.d.ts ]; then
  git add apps/web/next-env.d.ts
fi

git commit -m "docs: add team handoff and scoring execution plan" || true
git push || git push -u origin main || true

echo ""
echo "Done."
echo "Repository: https://github.com/${FULL_REPO}"
echo ""
echo "Check milestones:"
echo "  gh api repos/${FULL_REPO}/milestones --jq '.[] | [.title, .open_issues] | @tsv'"
echo ""
echo "Check issues:"
echo "  gh issue list --repo ${FULL_REPO} --limit 30"
