import { Router } from 'express';
import multer from 'multer';
import { analyzeAssetsMock } from '../services/assetAnalyzer';

const upload = multer({ dest: process.env.UPLOAD_DIR ?? './uploads' });
export const assetsRouter = Router();

assetsRouter.post('/analyze', upload.array('assets'), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  const cards = await analyzeAssetsMock(files, req.body?.textBrief);
  res.json({ assetCards: cards });
});
