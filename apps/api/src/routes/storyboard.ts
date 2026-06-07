import { Router } from 'express';
import { planStoryboardFrames } from '../services/storyboardPromptPlanner';

export const storyboardRouter = Router();

storyboardRouter.post('/plan', (req, res) => {
  const {
    timeline,
    structureGraph,
    contentBrief,
    assetCards,
    slotMatches,
    materialGaps,
    repairs
  } = req.body;

  if (!Array.isArray(timeline)) {
    res.status(400).json({
      error: 'timeline must be an array',
      frames: [],
      source: 'storyboard_prompt_planner',
      warnings: ['timeline must be an array']
    });
    return;
  }

  const result = planStoryboardFrames({
    timeline,
    structureGraph,
    contentBrief,
    assetCards,
    slotMatches,
    materialGaps,
    repairs
  });

  res.json(result);
});
