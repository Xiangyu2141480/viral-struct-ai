import { Router } from 'express';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { AssetCard, ContentBrief, MaterialGap, OrchestratedTimeline, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';
import { analyzeAssetsMock } from '../services/assetAnalyzer';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { type DemoShowcase, getDemoShowcase } from '../services/demoShowcase';
import { evaluateQuality } from '../services/qualityEvaluator';
import { matchSlotsWithFallback } from '../services/slotMatcher';
import { type StructureExtractionResult, extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { analyzeVideoFile, getSeedVideoPath } from '../services/videoAnalyzer';
import { renderAuthoredTimeline } from '../services/videoAgent/runVideoAgentPipeline';
import { runDirectorAgent } from '../services/directorAgent';
import { orchestratedToAuthored } from '../services/videoAgent/orchestratedToAuthored';
import { authoredTimelineToTimelineItems } from '../services/videoAgent/authoredTimelineAdapter';
import { buildDeterministicPreset } from '../services/motifs/categoryPresetProvider';
import { getRenderDir } from '../services/videoPaths';
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

    // ① shared slot matcher (KEPT) → slotMatches + materialGaps that the ③ pipeline consumes.
    const slotResult = await matchSlotsWithFallback({
      graph: structure.structureGraph,
      assets: assetLoad.assetCards,
      boundaries
    });

    // ② Director Agent (plan-only): transfer the viral structure onto the product, propose per-beat
    // enhancement channels (reshoot / hyperframes / aigc), and emit the Video Agent handoff. This is the
    // real scan → assetcard → director → video-agent chain (it replaces the mock-author shortcut).
    const categoryPreset = buildDeterministicPreset({
      category: contentBrief.category ?? contentBrief.productName,
      availableAssets: assetLoad.assetCards.map((card) => card.id)
    });
    const orchestratedTimeline = await runDirectorAgent({
      projectId: showcase.case.id,
      structureGraph: structure.structureGraph,
      assetCards: assetLoad.assetCards,
      contentBrief,
      categoryPreset,
      boundaries
    });

    // ③ Video Agent handoff: project the director's plan into a renderable AuthoredTimeline + flat items.
    const authoredTimeline = orchestratedToAuthored(orchestratedTimeline, { assetCards: assetLoad.assetCards });
    const timelineItems = authoredTimelineToTimelineItems(authoredTimeline);
    const authorSource = orchestratedTimeline.meta.matchSource;

    const qualityReport = evaluateQuality({
      matches: slotResult.matches,
      timeline: timelineItems,
      boundaries,
      contentBrief,
      assets: assetLoad.assetCards
    });

    const warnings = [slotResult.warning, ...orchestratedTimeline.warnings].filter((w): w is string => Boolean(w));

    // Best-effort render of the authored timeline into a real MP4. A render failure must never break the
    // analysis demo, so it is wrapped and surfaced as a warning instead.
    let renderMediaUrl: string | null = null;
    let renderManifest: Awaited<ReturnType<typeof renderAuthoredTimeline>> | null = null;
    try {
      const outputPath = path.join(getRenderDir(), `render_${nanoid(10)}.mp4`);
      renderManifest = await renderAuthoredTimeline({ timeline: authoredTimeline, outputPath });
      renderMediaUrl = renderManifest.rendered && renderManifest.outputPath
        ? `/media/renders/${path.basename(renderManifest.outputPath)}`
        : null;
    } catch (error) {
      warnings.push(`render skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Optional real-pixel renders (flag-gated, additive; default OFF). Both inherit a VideoEditContext from
    // the analysis pipeline and must never break the demo on failure. The authored path composites real
    // pixels via ffmpeg; the HyperFrames path has the LLM author an HTML+GSAP composition HyperFrames renders.
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
        warnings.push(`render: aspectRatio "${sourceAspectRatio}" coerced to "${aspectRatio}".`);
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
        timeline: timelineItems,
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
          warnings.push(`authored render skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (hyperframesRenderEnabled()) {
        try {
          const hf = await hyperframesRenderFromContext(editContext);
          hyperframesRenderMediaUrl = hf.mediaUrl;
          hyperframesRenderSource = hf.source;
          hyperframesRenderLint = hf.lint;
          if (!hf.rendered) {
            warnings.push(`hyperframes render skipped${hf.lint.errors.length ? ` (lint): ${hf.lint.errors.join('; ')}` : ''}`);
          }
        } catch (error) {
          warnings.push(`hyperframes render skipped: ${error instanceof Error ? error.message : String(error)}`);
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
      orchestratedTimeline,
      authoredTimeline,
      timeline: timelineItems,
      qualityReport,
      renderMediaUrl,
      renderManifest,
      authoredRenderMediaUrl,
      authoredRenderManifest,
      authoredRenderSource,
      authoredRenderTrace,
      hyperframesRenderMediaUrl,
      hyperframesRenderSource,
      hyperframesRenderLint,
      engineStageSources: {
        alignment: slotResult.alignmentSource,
        author: authorSource
      },
      warnings,
      evidenceTrace: buildEvidenceTrace({
        showcase,
        structure,
        assetLoad,
        matches: slotResult.matches,
        orchestratedTimeline,
        timeline: timelineItems,
        qualityReport,
        alignmentSource: slotResult.alignmentSource
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
  orchestratedTimeline,
  timeline,
  qualityReport,
  alignmentSource
}: {
  showcase: DemoShowcase;
  structure: StructureExtractionResult;
  assetLoad: DemoAssetLoadResult;
  matches: SlotMatch[];
  orchestratedTimeline: OrchestratedTimeline;
  timeline: TimelineItem[];
  qualityReport: QualityReport;
  alignmentSource: 'llm_judge' | 'rule_based';
}): DemoEvidenceTraceItem[] {
  const analysisId = showcase.case.seedFilename.replace(/\.[^.]+$/, '');
  const matchedCount = matches.filter((match) => match.status === 'matched').length;
  const partialOrMissingCount = matches.length - matchedCount;
  const migrationContractCount = structure.structureGraph.shotSlots.filter(
    (slot) => slot.intent && slot.sourceInstance && slot.acceptanceCriteria
  ).length;
  const authorSource = orchestratedTimeline.meta.matchSource;
  const generationRequired = orchestratedTimeline.slots.filter(
    (slot) => slot.fill.kind === 'gap' || slot.fillStatus === 'missing_generation_required'
  ).length;
  const enhancementOptionSlots = orchestratedTimeline.slots.filter(
    (slot) => (slot.fill.options ?? []).length > 0
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
      id: 'slot_gap_fill',
      label: 'Slot Match / Gap Resolution (director)',
      source: `${alignmentSource} + director_agent`,
      detail: `${matchedCount} 个 matched，${partialOrMissingCount} 个 partial/missing，${enhancementOptionSlots} 个 beat 带导演增强选项（reshoot/hyperframes/aigc），其中 ${generationRequired} 个需生成补全；对齐来源 ${alignmentSource}`,
      judgeBenefit: '把结构槽位、素材能力和缺口补全串成可解释迁移链路；由 Director Agent 逐 beat 规划增强通道，缺真实证据时诚实降级而非伪造。'
    },
    {
      id: 'authored_timeline_quality',
      label: 'Authored Timeline / Quality (director → video-agent)',
      source: authorSource,
      detail: `${timeline.length} 个 beat（导演按结构编排 + 逐 beat 增强指引），结构匹配 ${qualityReport.structureMatch.toFixed(2)}，素材覆盖 ${qualityReport.slotCoverage.toFixed(2)}，${transitionFidelity}；匹配来源 ${authorSource}`,
      judgeBenefit: '由 Director Agent 编排成片时间线并交接给 Video Agent（真素材合成 + 诚实替代卡），集中输出可验证的结果质量。'
    }
  ];
}
