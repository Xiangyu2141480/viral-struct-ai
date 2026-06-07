import { Router } from 'express';
import { estimateDemoAnalytics } from '../services/demoScoringEstimator';

export const analyticsRouter = Router();

analyticsRouter.post('/demo-estimate', (req, res) => {
  res.json({
    demoEstimate: estimateDemoAnalytics({
      structureGraph: req.body.structureGraph,
      contentBrief: req.body.contentBrief,
      slotMatches: req.body.slotMatches ?? [],
      materialGaps: req.body.materialGaps ?? [],
      repairs: req.body.repairs ?? [],
      timeline: req.body.timeline ?? [],
      storyboardFrames: req.body.storyboardFrames ?? [],
      missingMaterialJobs: req.body.missingMaterialJobs ?? [],
      qualityReport: req.body.qualityReport,
      generationVariant: req.body.generationVariant
    })
  });
});
