import { Router } from 'express';
import { planMissingMaterialGenerationJobs } from '../services/missingMaterialGenerationPlanner';

export const materialGenerationRouter = Router();

materialGenerationRouter.post('/plan', (req, res) => {
  const { materialGaps } = req.body;

  if (!Array.isArray(materialGaps)) {
    res.status(400).json({
      error: 'materialGaps must be an array',
      jobs: [],
      source: 'missing_material_generation_planner',
      warnings: ['materialGaps must be an array']
    });
    return;
  }

  res.json(planMissingMaterialGenerationJobs({
    materialGaps,
    repairs: req.body.repairs ?? [],
    storyboardFrames: req.body.storyboardFrames ?? [],
    timeline: req.body.timeline ?? [],
    contentBrief: req.body.contentBrief,
    aspectRatio: req.body.aspectRatio,
    provider: req.body.provider
  }));
});
