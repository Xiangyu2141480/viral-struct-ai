import { Router } from 'express';
import { generateTimelineMock } from '../services/timelineGenerator';

export const timelineRouter = Router();

timelineRouter.post('/generate', async (req, res) => {
  const result = await generateTimelineMock(req.body);
  res.json(result);
});

timelineRouter.post('/apply-edit', async (req, res) => {
  const { instruction, timeline } = req.body;
  res.json({
    patches: [
      {
        op: 'note',
        reason: 'mock patch for natural language editing',
        instruction
      }
    ],
    updatedTimeline: timeline
  });
});
