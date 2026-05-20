import { Router } from 'express';
import { evaluateQuality } from '../services/qualityEvaluator';

export const qualityRouter = Router();

qualityRouter.post('/evaluate', async (req, res) => {
  res.json({ qualityReport: evaluateQuality(req.body) });
});
