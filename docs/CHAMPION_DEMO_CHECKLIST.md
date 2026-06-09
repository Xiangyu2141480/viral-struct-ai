# Review Demo Checklist

本清单用于答辩前自检：每个评分点都要能在页面、代码或说明文档中找到证据。

## 1. 本地启动

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

推荐本地 `.env`：

```txt
API_PORT=4000
WEB_ORIGIN=http://localhost:3000,http://localhost:3001
SEED_VIDEO_DIR=./seed_assets/raw_videos
UPLOAD_DIR=./uploads
FRAME_DIR=./frames
COVER_DIR=./covers
ANALYSIS_DIR=./seed_assets/analysis
ASSET_LIBRARY_DIR=./seed_assets/asset_libraries
ENABLE_MOCK_AI=true
```

真实模型 key 只放本地 `.env`，不提交到仓库。

## 2. 主 Demo 流程

0. 一键演示：在单页应用（路由 `/`）点击“一键演示”按钮（加载 GET /api/struct/demo），让评委先看到完整闭环、评分证据链和队友模块接入证据。
1. 步骤 01 · 样例解析：主 demo 使用 `macbook_neo.mp4`，粘贴手动字幕，展示真实时长、FPS、分辨率、关键帧、镜头草案。
2. 步骤 01 · 样例解析：优先加载 `seed_assets/analysis/macbook_neo/structure_graph.json` 这个 rough/fine scan adapter 图谱（结构图/上下对位在同一样例步骤内），展示脚本结构、节奏结构、包装结构、creativeIngredients 和证据。
3. 步骤 02 · 素材输入：输入康师傅冰红茶 brief，点击“使用康师傅 AssetCard 库”，读取 `seed_assets/asset_libraries/kangshifu_demo/asset_cards.json` 中的真实 AssetCard，展示瓶身主图、动感冰爽图和组合包装图等少量素材。
4. 步骤 03 · 缺口诊断：展示每个结构槽位的 matched/partial/missing、缺口原因、影响段落和补全策略。
5. 步骤 04 · 成片编译：生成脚本、分镜、时间线、真实 AssetCard 画面预览、样例结构到新结果映射、质量自检。
6. 在 步骤 04 · 成片编译 切换高点击版、高转化版、高质感版，演示版本策略差异。
7. 输入“开头更抓人一些，把商品信息提前，节奏更快”，演示人工可调/自然语言改片。

API smoke 可直接调用：

```bash
curl -X POST http://localhost:4000/api/demo/run
curl http://localhost:4000/api/assets/libraries/kangshifu_demo
```

## 3. 评分证据

- 基础闭环：真实 seed/upload 解析、结构图谱、脚本/分镜/时间线输出。
- 素材缺口：SlotMatch、MaterialGap、GapRepair 明确展示缺什么、为什么缺、如何补。
- 展示可验证：真实素材预览、时间线、结构映射、质量报告。
- 进阶能力：标题卡/卖点卡/对比卡/CTA 卡、多版本、真实素材 AssetCard。
- 人机协同：版本切换和自然语言调整能重新影响结果。
- 队友模块复用：一键演示展示 rough/fine scan artifact、AssetCard library、slot/gap/repair、timeline/quality 四段证据链。

## 4. Fallback 策略

- ffmpeg/ffprobe 异常：`VideoAnalysis.analysisSource = mock_fallback`，页面展示 warning。
- 无 ASR：manual transcript fallback；为空时结构抽取优先使用 rough/fine scan artifact，再回退 shots/keyframes 规则兜底。
- 无真实素材库：demo 会回退到 `analyzeAssetsMock`，缺口识别仍可演示。
- AI provider 不可用：核心 demo 使用规则/mock provider，不阻断展示。

## 5. 安全边界

- 只迁移结构方法，不复刻样例画面、人物、品牌或音乐。
- 不生成或替代真人肖像，不评价外貌，不输出颜值类判断。
- 营销强事实必须来自用户输入或可解释证据。
- AIGC 只作为可选补全，并在页面和文档中标注。
