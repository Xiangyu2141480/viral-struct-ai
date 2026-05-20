import { Router } from 'express';
import { matchSlots } from '../services/slotMatcher';

export const slotsRouter = Router();

slotsRouter.post('/match', async (req, res) => {
  const { structureGraph, assetCards } = req.body;
  const result = matchSlots(structureGraph, assetCards ?? []);
  res.json(result);
});
