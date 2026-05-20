import { Router } from 'express';
import { planGapRepairs } from '../services/gapRepairPlanner';

export const gapsRouter = Router();

gapsRouter.post('/repair', async (req, res) => {
  const { gaps, assetCards, newContent } = req.body;
  const repairs = planGapRepairs(gaps ?? [], assetCards ?? [], newContent);
  res.json({ repairs });
});
