import { Router } from 'express';
import { extractStructureMock } from '../services/structureExtractor';

export const structureRouter = Router();

structureRouter.post('/extract', async (req, res) => {
  const graph = await extractStructureMock(req.body.videoAnalysis);
  res.json({ structureGraph: graph });
});
