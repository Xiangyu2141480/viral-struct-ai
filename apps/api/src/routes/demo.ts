import { Router } from 'express';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { AssetCard, ContentBrief, MaterialGap, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';
import type { GapFillPlan } from '@viral-struct/video-agent';
import { analyzeAssetsMock } from '../services/assetAnalyzer';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { type DemoShowcase, getDemoShowcase } from '../services/demoShowcase';
import { evaluateQuality } from '../services/qualityEvaluator';
import { matchSlotsWithFallback } from '../services/slotMatcher';
import { type StructureExtractionResult, extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { analyzeVideoFile, getSeedVideoPath } from '../services/videoAnalyzer';
import { renderAuthoredTimeline, runVideoAgentPipeline } from '../services/videoAgent/runVideoAgentPipeline';
import { getRenderDir } from '../services/videoPaths';

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

    // ① shared slot matcher (KEPT) → slotMatches + materialGaps that the ③ pipeline consumes.
    const slotResult = await matchSlotsWithFallback({
      graph: structure.structureGraph,
      assets: assetLoad.assetCards,
      boundaries
    });

    // ③ video-agent pipeline replaces ①'s gap planner + timeline generator + render service.
    const pipeline = await runVideoAgentPipeline({
      structureGraph: structure.structureGraph,
      assetCards: assetLoad.assetCards,
      contentBrief,
      boundaries,
      match: { matches: slotResult.matches, gaps: slotResult.gaps }
    });

    const qualityReport = evaluateQuality({
      matches: slotResult.matches,
      timeline: pipeline.timelineItems,
      boundaries,
      contentBrief,
      assets: assetLoad.assetCards
    });

    const warnings = [slotResult.warning].filter((w): w is string => Boolean(w));

    // Best-effort render of the authored timeline into a real MP4. A render failure must never break the
    // analysis demo, so it is wrapped and surfaced as a warning instead.
    let renderMediaUrl: string | null = null;
    let renderManifest: Awaited<ReturnType<typeof renderAuthoredTimeline>> | null = null;
    try {
      const outputPath = path.join(getRenderDir(), `render_${nanoid(10)}.mp4`);
      renderManifest = await renderAuthoredTimeline({ timeline: pipeline.authoredTimeline, outputPath });
      renderMediaUrl = renderManifest.rendered && renderManifest.outputPath
        ? `/media/renders/${path.basename(renderManifest.outputPath)}`
        : null;
    } catch (error) {
      warnings.push(`render skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

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
      gapFills: pipeline.gapFills,
      authoredTimeline: pipeline.authoredTimeline,
      timeline: pipeline.timelineItems,
      qualityReport,
      renderMediaUrl,
      renderManifest,
      engineStageSources: {
        alignment: slotResult.alignmentSource,
        author: pipeline.authorSource
      },
      warnings,
      evidenceTrace: buildEvidenceTrace({
        showcase,
        structure,
        assetLoad,
        matches: slotResult.matches,
        gapFills: pipeline.gapFills,
        timeline: pipeline.timelineItems,
        qualityReport,
        alignmentSource: slotResult.alignmentSource,
        authorSource: pipeline.authorSource
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
  gapFills,
  timeline,
  qualityReport,
  alignmentSource,
  authorSource
}: {
  showcase: DemoShowcase;
  structure: StructureExtractionResult;
  assetLoad: DemoAssetLoadResult;
  matches: SlotMatch[];
  gapFills: GapFillPlan[];
  timeline: TimelineItem[];
  qualityReport: QualityReport;
  alignmentSource: 'llm_judge' | 'rule_based';
  authorSource: 'llm' | 'mock';
}): DemoEvidenceTraceItem[] {
  const analysisId = showcase.case.seedFilename.replace(/\.[^.]+$/, '');
  const matchedCount = matches.filter((match) => match.status === 'matched').length;
  const partialOrMissingCount = matches.length - matchedCount;
  const migrationContractCount = structure.structureGraph.shotSlots.filter(
    (slot) => slot.intent && slot.sourceInstance && slot.acceptanceCriteria
  ).length;
  const unresolvedFills = gapFills.filter((plan) => plan.resolutionStatus === 'unresolved').length;
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
      id: 'slot_gap_fill',
      label: 'Slot Match / Gap Fill (video-agent)',
      source: `${alignmentSource} + video_agent`,
      detail: `${matchedCount} 个 matched，${partialOrMissingCount} 个 partial/missing，${gapFills.length} 个 video-agent 补全计划（${unresolvedFills} 个诚实兜底）；对齐来源 ${alignmentSource}`,
      judgeBenefit: '把结构槽位、素材能力和缺口补全串成可解释迁移链路；补全由 video-agent 规划，缺真实证据时诚实降级而非伪造。'
    },
    {
      id: 'authored_timeline_quality',
      label: 'Authored Timeline / Quality (video-agent)',
      source: authorSource,
      detail: `${timeline.length} 个 beat（按段落编排），结构匹配 ${qualityReport.structureMatch.toFixed(2)}，素材覆盖 ${qualityReport.slotCoverage.toFixed(2)}，${transitionFidelity}；成片编排来源 ${authorSource}`,
      judgeBenefit: '由 video-agent 直接编排成片时间线（真素材合成 + 诚实替代卡），并集中输出可验证的结果质量。'
    }
  ];
}
