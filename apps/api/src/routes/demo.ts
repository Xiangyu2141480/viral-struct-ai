import { Router } from 'express';
import type { ContentBrief } from '@viral-struct/shared';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { getChampionDemoShowcase } from '../services/demoShowcase';
import { planGapRepairs } from '../services/gapRepairPlanner';
import { evaluateQuality } from '../services/qualityEvaluator';
import { matchSlots } from '../services/slotMatcher';
import { extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { generateTimelineMock } from '../services/timelineGenerator';
import { analyzeVideoFile, getSeedVideoPath } from '../services/videoAnalyzer';

export const demoRouter = Router();

demoRouter.get('/showcase', (_req, res) => {
  res.json({ showcase: getChampionDemoShowcase() });
});

demoRouter.post('/run', async (_req, res) => {
  try {
    const showcase = getChampionDemoShowcase();
    const filePath = await getSeedVideoPath(showcase.case.seedFilename);

    if (!filePath) {
      res.status(500).json({ error: `Demo seed video not found: ${showcase.case.seedFilename}` });
      return;
    }

    const contentBrief: ContentBrief = {
      productName: showcase.case.productName,
      targetAudience: showcase.case.targetAudience,
      scenario: showcase.case.scenario,
      sellingPoints: showcase.case.sellingPoints,
      cta: showcase.case.cta,
      stylePreference: showcase.case.stylePreference
    };

    const videoAnalysis = await analyzeVideoFile({
      videoId: showcase.case.seedFilename,
      filePath,
      manualTranscript: showcase.case.manualTranscript
    });
    const structure = await extractStructureFromVideoAnalysis(videoAnalysis);
    const assetCards = await loadAssetLibrary(showcase.case.assetLibraryId);
    const slotResult = matchSlots(structure.structureGraph, assetCards);
    const repairs = planGapRepairs(slotResult.gaps, assetCards, contentBrief);
    const generation = await generateTimelineMock({
      structureGraph: structure.structureGraph,
      newContent: contentBrief,
      matches: slotResult.matches,
      repairs,
      variant: 'high_click'
    });
    const qualityReport = evaluateQuality({
      matches: slotResult.matches,
      timeline: generation.timeline
    });

    res.json({
      showcase,
      contentBrief,
      videoAnalysis,
      structureGraph: structure.structureGraph,
      structureDebug: structure.debug,
      assetCards,
      slotMatches: slotResult.matches,
      materialGaps: slotResult.gaps,
      repairs,
      ...generation,
      qualityReport
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
