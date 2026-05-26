# Champion Demo Checklist

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
ENABLE_MOCK_AI=true
```

真实模型 key 只放本地 `.env`，不提交到仓库。

## 2. 主 Demo 流程

0. `/demo`：打开冠军演示工作台，点击“一键运行冠军 demo”，让评委先看到完整闭环和评分证据链。
1. `/analyze`：选择 `huaxizi.mp4` 或 `YVES SAINT LAURENT .mp4`，粘贴手动字幕，展示真实时长、FPS、分辨率、关键帧、镜头草案。
2. `/graph`：自动抽取 ViralStructureGraph，展示脚本结构、节奏结构、包装结构、creativeIngredients 和证据。
3. `/adapt`：输入便携咖啡杯 brief，只上传少量产品/手持素材或仅输入文字素材，生成 AssetCard。
4. `/gaps`：展示每个结构槽位的 matched/partial/missing、缺口原因、影响段落和补全策略。
5. `/result`：生成脚本、分镜、时间线、Web 预览、样例结构到新结果映射、质量自检。
6. 在 `/result` 切换高点击版、高转化版、高质感版，演示版本策略差异。
7. 输入“开头更抓人一些，把商品信息提前，节奏更快”，演示人工可调/自然语言改片。

API smoke 可直接调用：

```bash
curl -X POST http://localhost:4000/api/demo/run
```

## 3. 评分证据

- 基础闭环：真实 seed/upload 解析、结构图谱、脚本/分镜/时间线输出。
- 素材缺口：SlotMatch、MaterialGap、GapRepair 明确展示缺什么、为什么缺、如何补。
- 展示可验证：Web 预览、时间线、结构映射、质量报告。
- 进阶能力：标题卡/卖点卡/对比卡/CTA 卡、多版本、真实素材 AssetCard。
- 人机协同：版本切换和自然语言调整能重新影响结果。

## 4. Fallback 策略

- ffmpeg/ffprobe 异常：`VideoAnalysis.analysisSource = mock_fallback`，页面展示 warning。
- 无 ASR：manual transcript fallback；为空时结构抽取可用 shots/keyframes 兜底。
- 无真实素材：AssetCard 可由 text brief 生成，缺口识别仍可演示。
- AI provider 不可用：核心 demo 使用规则/mock provider，不阻断展示。

## 5. 安全边界

- 只迁移结构方法，不复刻样例画面、人物、品牌或音乐。
- 不生成或替代真人肖像，不评价外貌，不输出颜值类判断。
- 营销强事实必须来自用户输入或可解释证据。
- AIGC 只作为可选补全，并在页面和文档中标注。
