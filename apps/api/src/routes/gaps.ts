import { Router } from 'express';
import type { ContentBrief } from '@viral-struct/shared';
import { planGapRepairsWithFallback } from '../services/gapRepairPlanner';

export const gapsRouter = Router();

gapsRouter.post('/repair', async (req, res) => {
  const { gaps, assetCards, newContent, structureGraph, boundaries } = req.body;
  const result = await planGapRepairsWithFallback({
    gaps: gaps ?? [],
    assets: assetCards ?? [],
    newContent: newContent ?? fallbackContentBrief(),
    graph: structureGraph,
    boundaries: boundaries ?? structureGraph?.boundaries
  });

  res.json({
    ...result,
    warnings: result.warning ? [result.warning] : []
  });
});

function fallbackContentBrief(): ContentBrief {
  return {
    productName: '新商品',
    targetAudience: '目标用户',
    scenario: '当前使用场景',
    sellingPoints: [],
    cta: '了解更多。',
    stylePreference: '清晰、可解释'
  };
}
