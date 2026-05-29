import { Router } from 'express';
import { matchSlotsWithFallback } from '../services/slotMatcher';

export const slotsRouter = Router();

slotsRouter.post('/match', async (req, res) => {
  const { structureGraph, assetCards, boundaries } = req.body;
  const result = await matchSlotsWithFallback({
    graph: structureGraph,
    assets: assetCards ?? [],
    boundaries: boundaries ?? structureGraph?.boundaries
  });

  res.json({
    ...result,
    warnings: result.warning ? [result.warning] : []
  });
});
