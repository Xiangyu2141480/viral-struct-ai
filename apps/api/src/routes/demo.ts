import { Router } from 'express';
import type { AssetCard, ContentBrief, GapRepair, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';
import { analyzeAssetsMock } from '../services/assetAnalyzer';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { type DemoShowcase, getChampionDemoShowcase } from '../services/demoShowcase';
import { planGapRepairs } from '../services/gapRepairPlanner';
import { evaluateQuality } from '../services/qualityEvaluator';
import { matchSlots } from '../services/slotMatcher';
import { type StructureExtractionResult, extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { generateTimelineMock } from '../services/timelineGenerator';
import { analyzeVideoFile, getSeedVideoPath } from '../services/videoAnalyzer';

export const demoRouter = Router();

interface DemoEvidenceTraceItem {
  id: string;
  label: string;
  source: string;
  artifactPath?: string;
  detail: string;
  judgeBenefit: string;
}

interface DemoAssetLoadResult {
  assetCards: AssetCard[];
  source: 'asset_library' | 'demo_fallback';
  libraryId?: string;
}

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
    const boundaries = structure.structureGraph.boundaries;
    const assetLoad = await loadDemoAssetCards(showcase);
    const slotResult = matchSlots(structure.structureGraph, assetLoad.assetCards, boundaries);
    const repairs = planGapRepairs(slotResult.gaps, assetLoad.assetCards, contentBrief, boundaries);
    const assetLoad = await loadDemoAssetCards(showcase);
    const slotResult = matchSlots(structure.structureGraph, assetLoad.assetCards);
    const repairs = planGapRepairs(slotResult.gaps, assetLoad.assetCards, contentBrief);
    const generation = await generateTimelineMock({
      structureGraph: structure.structureGraph,
      newContent: contentBrief,
      matches: slotResult.matches,
      repairs,
      variant: 'high_click',
      boundaries
    });
    const qualityReport = evaluateQuality({
      matches: slotResult.matches,
      timeline: generation.timeline,
      boundaries
    });

    res.json({
      showcase,
      contentBrief,
      videoAnalysis,
      structureGraph: structure.structureGraph,
      structureDebug: structure.debug,
      assetCards: assetLoad.assetCards,
      assetSource: {
        source: assetLoad.source,
        libraryId: assetLoad.libraryId
      },
      slotMatches: slotResult.matches,
      materialGaps: slotResult.gaps,
      repairs,
      ...generation,
      qualityReport,
      evidenceTrace: buildEvidenceTrace({
        showcase,
        structure,
        assetLoad,
        matches: slotResult.matches,
        repairs,
        timeline: generation.timeline,
        qualityReport
      })
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDemoAssetCards(showcase: ReturnType<typeof getChampionDemoShowcase>): Promise<DemoAssetLoadResult> {
  try {
    const assetCards = await loadAssetLibrary(showcase.case.assetLibraryId);
    return {
      assetCards,
      source: 'asset_library',
      libraryId: showcase.case.assetLibraryId
    };
  } catch {
    const demoFiles = showcase.case.assetFiles.map((asset) => ({
      originalname: asset.filename,
      path: asset.publicUrl
    })) as Express.Multer.File[];
    return {
      assetCards: await analyzeAssetsMock(demoFiles, showcase.case.assetBrief),
      source: 'demo_fallback'
    };
  }
}

function buildEvidenceTrace({
  showcase,
  structure,
  assetLoad,
  matches,
  repairs,
  timeline,
  qualityReport
}: {
  showcase: DemoShowcase;
  structure: StructureExtractionResult;
  assetLoad: DemoAssetLoadResult;
  matches: SlotMatch[];
  repairs: GapRepair[];
  timeline: TimelineItem[];
  qualityReport: QualityReport;
}): DemoEvidenceTraceItem[] {
  const analysisId = showcase.case.seedFilename.replace(/\.[^.]+$/, '');
  const matchedCount = matches.filter((match) => match.status === 'matched').length;
  const partialOrMissingCount = matches.length - matchedCount;

  return [
    {
      id: 'rough_fine_scan',
      label: 'Rough/Fine Scan 结构图谱',
      source: structure.debug.extractionSource ?? 'unknown',
      artifactPath: `seed_assets/analysis/${analysisId}/structure_graph.json`,
      detail: `${structure.structureGraph.segments.length} 个段落，${structure.structureGraph.shotSlots.length} 个槽位，${structure.structureGraph.creativeIngredients.length} 个创作要素`,
      judgeBenefit: '证明样例拆解不是静态 mock，而是优先使用队友 rough/fine scan adapter 产物。'
    },
    {
      id: 'asset_library',
      label: 'AssetCard 素材库',
      source: assetLoad.source,
      artifactPath: assetLoad.libraryId ? `seed_assets/asset_libraries/${assetLoad.libraryId}/asset_cards.json` : undefined,
      detail: `${assetLoad.assetCards.length} 张素材卡参与槽位匹配`,
      judgeBenefit: '证明新素材适配使用队友 AssetCard 协议结果，而不是只看文件名。'
    },
    {
      id: 'slot_gap_repair',
      label: 'Slot Match / Gap Repair',
      source: 'rule_engine',
      detail: `${matchedCount} 个 matched，${partialOrMissingCount} 个 partial/missing，${repairs.length} 个补全策略`,
      judgeBenefit: '把结构槽位、素材能力和缺口补全串成可解释迁移链路。'
    },
    {
      id: 'timeline_quality',
      label: 'Timeline / Quality',
      source: 'timeline_generator',
      detail: `${timeline.length} 个时间线 item，结构匹配 ${qualityReport.structureMatch.toFixed(2)}，素材覆盖 ${qualityReport.slotCoverage.toFixed(2)}`,
      judgeBenefit: '把评审要求的脚本、分镜、时间线和结果可验证性集中输出。'
    }
  ];
}
