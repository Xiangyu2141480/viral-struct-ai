import { Router } from 'express';
import type { AssetCard, ContentBrief, GapRepair, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';
import { analyzeAssetsMock } from '../services/assetAnalyzer';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { type DemoShowcase, getDemoShowcase } from '../services/demoShowcase';
import { planGapRepairsWithFallback } from '../services/gapRepairPlanner';
import { evaluateQuality } from '../services/qualityEvaluator';
import { matchSlotsWithFallback } from '../services/slotMatcher';
import { type StructureExtractionResult, extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { generateTimelineWithFallback } from '../services/timelineGenerator';
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
  res.json({ showcase: getDemoShowcase() });
});

demoRouter.post('/run', async (_req, res) => {
  try {
    const showcase = getDemoShowcase();
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
    const slotResult = await matchSlotsWithFallback({
      graph: structure.structureGraph,
      assets: assetLoad.assetCards,
      boundaries
    });
    const repairResult = await planGapRepairsWithFallback({
      gaps: slotResult.gaps,
      assets: assetLoad.assetCards,
      newContent: contentBrief,
      graph: structure.structureGraph,
      boundaries
    });
    const generation = await generateTimelineWithFallback({
      structureGraph: structure.structureGraph,
      newContent: contentBrief,
      matches: slotResult.matches,
      repairs: repairResult.repairs,
      assets: assetLoad.assetCards,
      variant: 'high_click',
      boundaries
    });
    const qualityReport = evaluateQuality({
      matches: slotResult.matches,
      timeline: generation.timeline,
      boundaries
    });

    const llmWarnings = [slotResult.warning, repairResult.warning, generation.warning].filter(
      (w): w is string => Boolean(w)
    );

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
      repairs: repairResult.repairs,
      script: generation.script,
      storyboard: generation.storyboard,
      timeline: generation.timeline,
      qualityReport,
      llmStageSources: {
        alignment: slotResult.alignmentSource,
        gapSpec: repairResult.gapSpecSource,
        script: generation.scriptSource
      },
      llmWarnings,
      evidenceTrace: buildEvidenceTrace({
        showcase,
        structure,
        assetLoad,
        matches: slotResult.matches,
        repairs: repairResult.repairs,
        timeline: generation.timeline,
        qualityReport,
        alignmentSource: slotResult.alignmentSource,
        gapSpecSource: repairResult.gapSpecSource,
        scriptSource: generation.scriptSource
      })
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDemoAssetCards(showcase: ReturnType<typeof getDemoShowcase>): Promise<DemoAssetLoadResult> {
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
  qualityReport,
  alignmentSource,
  gapSpecSource,
  scriptSource
}: {
  showcase: DemoShowcase;
  structure: StructureExtractionResult;
  assetLoad: DemoAssetLoadResult;
  matches: SlotMatch[];
  repairs: GapRepair[];
  timeline: TimelineItem[];
  qualityReport: QualityReport;
  alignmentSource: 'llm_judge' | 'rule_based';
  gapSpecSource: 'llm_generated' | 'rule_based';
  scriptSource: 'llm_generated' | 'template';
}): DemoEvidenceTraceItem[] {
  const analysisId = showcase.case.seedFilename.replace(/\.[^.]+$/, '');
  const matchedCount = matches.filter((match) => match.status === 'matched').length;
  const partialOrMissingCount = matches.length - matchedCount;
  const migrationContractCount = structure.structureGraph.shotSlots.filter(
    (slot) => slot.intent && slot.sourceInstance && slot.acceptanceCriteria
  ).length;
  const transitionFidelity =
    qualityReport.transitionFidelity === undefined
      ? '转场保真 n/a'
      : `转场保真 ${qualityReport.transitionFidelity.toFixed(2)}`;

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
      id: 'migration_contract',
      label: 'Migration Contract 迁移契约',
      source: structure.structureGraph.schemaVersion ?? 'v0',
      artifactPath: `seed_assets/analysis/${analysisId}/structure_graph.json`,
      detail: `${migrationContractCount} 个槽位含迁移契约：可迁移意图 / 源片实例 / 可接受替代标准`,
      judgeBenefit: '证明系统迁移的是结构方法，而不是复制源片具体产品和画面。'
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
      source: `${alignmentSource} + ${gapSpecSource}`,
      detail: `${matchedCount} 个 matched，${partialOrMissingCount} 个 partial/missing，${repairs.length} 个补全策略；对齐来源 ${alignmentSource}；拍摄规格来源 ${gapSpecSource}`,
      judgeBenefit: '把结构槽位、素材能力和缺口补全串成可解释迁移链路，并标注每一段是 LLM 真判断还是规则降级。'
    },
    {
      id: 'timeline_quality',
      label: 'Timeline / Quality',
      source: scriptSource,
      detail: `${timeline.length} 个时间线 item，结构匹配 ${qualityReport.structureMatch.toFixed(2)}，素材覆盖 ${qualityReport.slotCoverage.toFixed(2)}，${transitionFidelity}；脚本来源 ${scriptSource}`,
      judgeBenefit: '把评审要求的脚本、分镜、时间线和结果可验证性集中输出，并标注脚本是 LLM 写的还是模板降级。'
    }
  ];
}
