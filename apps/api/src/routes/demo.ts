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
import { renderTimeline } from '../services/renderService';
import {
  authoredRenderEnabled,
  authoredRenderFromContext,
  rewriteAssetCardUrlsToDisk
} from '../services/authoredRenderService';
import {
  hyperframesRenderEnabled,
  hyperframesRenderFromContext
} from '../services/hyperframesRenderService';
import type { EditConstraints, VideoEditContext } from '@viral-struct/video-agent';

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
      boundaries,
      contentBrief,
      assets: assetLoad.assetCards
    });

    const llmWarnings = [slotResult.warning, repairResult.warning, generation.warning].filter(
      (w): w is string => Boolean(w)
    );

    // Best-effort render of the migrated timeline into a real MP4. A render failure must never break the
    // analysis demo, so it is wrapped and surfaced as a warning instead.
    let renderMediaUrl: string | null = null;
    let renderManifest: Awaited<ReturnType<typeof renderTimeline>>['render'] | null = null;
    let renderDurationCheck: Awaited<ReturnType<typeof renderTimeline>>['durationCheck'] = null;
    try {
      const rendered = await renderTimeline({ timeline: generation.timeline });
      renderMediaUrl = rendered.mediaUrl;
      renderManifest = rendered.render;
      renderDurationCheck = rendered.durationCheck;
    } catch (error) {
      llmWarnings.push(`render skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Optional authored real-pixel render (flag-gated, additive). Composites the user's REAL asset
    // media via the LLM Director (or the deterministic mock author when no LLM creds exist). A failure
    // here must never break the demo, so it is wrapped and surfaced as a warning.
    // Optional real-pixel renders (flag-gated, additive). Both build the SAME inherited VideoEditContext
    // and must never break the demo on failure. The authored path composites via ffmpeg; the HyperFrames
    // path has the LLM author an HTML+GSAP composition that HyperFrames renders (rich motion/effects).
    let authoredRenderMediaUrl: string | null = null;
    let authoredRenderManifest: Awaited<ReturnType<typeof authoredRenderFromContext>>['render'] | null = null;
    let authoredRenderSource: 'llm' | 'mock' | null = null;
    let authoredRenderTrace: Awaited<ReturnType<typeof authoredRenderFromContext>>['trace'] | null = null;
    let hyperframesRenderMediaUrl: string | null = null;
    let hyperframesRenderSource: 'llm' | 'mock' | null = null;
    let hyperframesRenderLint: Awaited<ReturnType<typeof hyperframesRenderFromContext>>['lint'] | null = null;
    if (authoredRenderEnabled() || hyperframesRenderEnabled()) {
      const sourceAspectRatio = structure.structureGraph.meta.aspectRatio;
      const aspectRatio = narrowAspectRatio(sourceAspectRatio);
      if (sourceAspectRatio !== aspectRatio) {
        llmWarnings.push(`render: aspectRatio "${sourceAspectRatio}" coerced to "${aspectRatio}".`);
      }
      const constraints: EditConstraints = {
        aspectRatio,
        allowAigc: false,
        allowHumanGeneration: false,
        allowedClaimSources: [],
        forbiddenClaims: []
      };
      const editContext: VideoEditContext = {
        projectId: showcase.case.id,
        structureGraph: structure.structureGraph,
        contentBrief,
        assetCards: rewriteAssetCardUrlsToDisk(assetLoad.assetCards),
        slotMatches: slotResult.matches,
        materialGaps: slotResult.gaps,
        gapRepairs: repairResult.repairs,
        timeline: generation.timeline,
        qualityReport,
        constraints
      };
      if (authoredRenderEnabled()) {
        try {
          const authored = await authoredRenderFromContext(editContext);
          authoredRenderMediaUrl = authored.mediaUrl;
          authoredRenderManifest = authored.render;
          authoredRenderSource = authored.source;
          authoredRenderTrace = authored.trace;
        } catch (error) {
          llmWarnings.push(`authored render skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (hyperframesRenderEnabled()) {
        try {
          const hf = await hyperframesRenderFromContext(editContext);
          hyperframesRenderMediaUrl = hf.mediaUrl;
          hyperframesRenderSource = hf.source;
          hyperframesRenderLint = hf.lint;
          if (!hf.rendered) {
            llmWarnings.push(`hyperframes render skipped${hf.lint.errors.length ? ` (lint): ${hf.lint.errors.join('; ')}` : ''}`);
          }
        } catch (error) {
          llmWarnings.push(`hyperframes render skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
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
      repairs: repairResult.repairs,
      script: generation.script,
      storyboard: generation.storyboard,
      timeline: generation.timeline,
      qualityReport,
      renderMediaUrl,
      renderManifest,
      renderDurationCheck,
      authoredRenderMediaUrl,
      authoredRenderManifest,
      authoredRenderSource,
      authoredRenderTrace,
      hyperframesRenderMediaUrl,
      hyperframesRenderSource,
      hyperframesRenderLint,
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

function narrowAspectRatio(value: string | undefined): EditConstraints['aspectRatio'] {
  return value === '16:9' || value === '1:1' ? value : '9:16';
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
