# Project Plan / 项目计划

## 1. Project Positioning

Viral Struct AI 是“爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台”。

目标是让评审看到：

```txt
从样例中抽取了什么结构
这些结构如何迁移到新商品
用户素材哪里不足
系统如何补全缺口
最终生成了什么脚本、分镜、timeline 和预览
```

## 2. Current Implementation Snapshot

当前主线已经形成可演示闭环：

- `/demo` 主评审链路：macbook_neo 样例结构迁移到康师傅冰红茶 demo 素材。
- `/analyze -> /graph -> /adapt -> /gaps -> /result` 标准产品流程。
- API 标准强链路：slots/gaps/timeline 都使用 fallback-capable services。
- Web 可解释层：Generation Trace、Migration Evidence、Variant Diff、Edit Summary。
- Natural Language Edit Patch：`/api/timeline/apply-edit` rule-based timeline patch。
- Quality metrics：结构匹配、槽位覆盖、脚本视觉对齐、事实性、连贯性、字幕可读性、transition fidelity。
- LLM fallback：无 key 或模型失败时，标准流程仍能跑通，并显示 source/warning。

## 3. Core User Flow

```txt
样例视频分析
  -> 结构抽取
  -> 内容 brief 输入
  -> 素材适配
  -> 槽位匹配
  -> 缺口识别
  -> 缺口补全
  -> timeline 生成
  -> 多版本生成
  -> 自然语言改片
  -> 质量评估
```

## 4. Implemented Modules

| Module | Current Status | Key Files |
|---|---|---|
| M1 样例视频上传/解析 | Implemented for seed/upload basics | `apps/api/src/routes/videos.ts`, `apps/api/src/services/videoAnalyzer.ts` |
| M2/M3 结构抽取 | Implemented with artifact-first and rule fallback | `apps/api/src/routes/structure.ts`, `apps/api/src/services/structureExtractor.ts` |
| AssetCard 素材适配 | Implemented for static library and lightweight analysis | `apps/api/src/routes/assets.ts`, `apps/api/src/services/assetAnalyzer.ts` |
| Slot matching | Implemented with LLM fallback | `apps/api/src/services/slotMatcher.ts` |
| Gap repair | Implemented with LLM fallback | `apps/api/src/services/gapRepairPlanner.ts` |
| Timeline generation | Implemented with LLM/template fallback | `apps/api/src/services/timelineGenerator.ts` |
| Quality evaluation | Implemented | `apps/api/src/services/qualityEvaluator.ts` |
| Generation Trace | Implemented | `apps/web/components/PipelineStatus.tsx` |
| Migration Evidence | Implemented | `apps/web/components/MigrationEvidencePanel.tsx`, `apps/web/lib/migrationEvidence.ts` |
| Variant Diff | Implemented | `apps/web/components/VariantDiffPanel.tsx` |
| Natural Language Edit Patch | Implemented as rule-based patch | `apps/api/src/services/timelineEditPlanner.ts`, `apps/web/components/TimelineEditSummary.tsx` |
| Remotion export | Not main delivery | `packages/remotion-video` placeholder |

## 5. Demo Case

Main demo:

```txt
Source sample: macbook_neo
Target product: 康师傅冰红茶
Target assets: product hero images and product copy
Intentional gaps: usage shot, CTA end-card, complete comparison footage
```

Why this case works:

- It demonstrates structure transfer instead of content copying.
- It shows material gaps clearly.
- It uses packaging/text repair where real footage is missing.
- It can run without live model calls.

## 6. Next Priorities

Now that the product demo is stable, the next phase should focus on delivery:

1. Final documentation and submission package.
2. 3-5 minute recording script and screenshots.
3. Manual QA checklist for `/demo` and standard flow.
4. Optional: make quality re-evaluation run automatically after natural-language edits.
5. Optional: improve visual preview polish.

## 7. Explicit Non-Goals For This Checkpoint

Do not claim these as completed:

- stable MP4 export
- full Remotion rendering product
- complete ASR-first pipeline
- full drag-and-drop editor
- model training
- fully autonomous multi-agent creative system

## 8. Validation Commands

Run before submission:

```bash
pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
rg --hidden -n "ark-[A-Za-z0-9-]+" .
```

The secret scan should return no matches.
