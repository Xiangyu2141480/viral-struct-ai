import { Router } from 'express';
import { applyTimelineEdit } from '../services/timelineEditPlanner';
import { generateTimelineWithFallback } from '../services/timelineGenerator';

export const timelineRouter = Router();

timelineRouter.post('/generate', async (req, res) => {
  const {
    structureGraph,
    newContent,
    matches,
    repairs,
    assets,
    assetCards,
    variant,
    boundaries
  } = req.body;
  const result = await generateTimelineWithFallback({
    structureGraph,
    newContent,
    matches: matches ?? [],
    repairs: repairs ?? [],
    assets: assets ?? assetCards ?? [],
    variant,
    boundaries: boundaries ?? structureGraph?.boundaries
  });

  res.json({
    ...result,
    warnings: result.warning ? [result.warning] : []
  });
});

timelineRouter.post('/apply-edit', async (req, res) => {
  const { instruction, timeline, contentBrief, newContent } = req.body;
  if (!Array.isArray(timeline)) {
    res.status(400).json({
      error: 'timeline must be an array',
      updatedTimeline: [],
      patchSummary: 'Timeline 缺失，无法应用自然语言改片。',
      changedItems: [],
      editType: 'unsupported',
      appliedEditTypes: [],
      rationale: '请求体需要提供 timeline。',
      warnings: ['timeline must be an array'],
      supportedEditSuggestions: ['开头更抓人', '商品信息提前', '减少字幕', '增强节奏感', 'CTA 更强 / 购买引导更明确']
    });
    return;
  }

  res.json(applyTimelineEdit({
    instruction: String(instruction ?? ''),
    timeline,
    contentBrief: contentBrief ?? newContent
  }));
});
