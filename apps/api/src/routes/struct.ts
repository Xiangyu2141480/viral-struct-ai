// struct.ts — /api/struct/* adapter router for the StructMigrate demo UI.
//
// These routes consume the UI's OWN data model (structTypes.ts) and compose the
// real granular pipeline services, translating @viral-struct/shared artifacts ↔
// the UI model via services/structAdapter. This is the single server-side home of
// the shared↔UI translation (mirroring the proven api/assetManager.ts adapter).
// docs/API_CONTRACT.md §10 documents the contract.
//
// Every route degrades on the underlying service's own fallbacks (rule-based /
// template / mock_fallback) and surfaces *Source + warnings honestly; the web
// store additionally falls back to local fixtures if a route is unreachable.

import { Router } from 'express';
import multer, { MulterError } from 'multer';
import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { copyFile, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Request } from 'express';
import { analyzeVideoFile, getSeedVideoPath, getUploadedVideoPath, listSeedVideos } from '../services/videoAnalyzer';
import { extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { runRoughScan } from '../services/roughScanRunner';
import { runFineScan, type FineBlockDetail } from '../services/fineScanRunner';
import { analyzeAssetsWithFallbackResult } from '../services/assetAnalyzer';
import { matchSlotsWithFallback } from '../services/slotMatcher';
import { runDirectorAgent, buildGapResolutionOptions } from '../services/directorAgent';
import { planAigcBeats } from '@viral-struct/video-agent';
import { renderAigcTimeline } from '../services/videoAgent/aigcRenderer';
import { wanConfigFromEnv } from '../services/videoAgent/wanVideoClient';
import { orchestratedToAuthored } from '../services/videoAgent/orchestratedToAuthored';
import { authoredTimelineToTimelineItems } from '../services/videoAgent/authoredTimelineAdapter';
import { renderAuthoredTimeline } from '../services/videoAgent/runVideoAgentPipeline';
import { applyNaturalLanguageEditWithFallback } from '../services/timelineEditor';
import { evaluateQuality } from '../services/qualityEvaluator';
import { checkBrandSafety } from '../services/brandSafetyChecker';
import { estimateDemoAnalytics } from '../services/demoScoringEstimator';
import { planStoryboardFrames } from '../services/storyboardPromptPlanner';
import { planMissingMaterialGenerationJobs } from '../services/missingMaterialGenerationPlanner';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { getDemoShowcase } from '../services/demoShowcase';
import { getRenderDir, getUploadDir } from '../services/videoPaths';
import type { RenderProfile } from '@viral-struct/render-executor';
import type {
  AuthoredComposition,
  AuthoredSegmentRole,
  AuthoredTimeline,
  ContentBrief,
  TimelineItem,
} from '@viral-struct/shared';
import {
  assetCardsToMaterials,
  buildContentBrief,
  buildStructureGraph,
  graphToSourceVideo,
  materialsToAssetCards,
  segsToTimelineItems,
  timelineItemsToSegs,
  toDiagnosisRecord,
  variantToTargetDurationMode,
  versionFromId,
  versionIdToVariant,
  type SlotGapResolution,
} from '../services/structAdapter/structAdapter';
import type { SlotMatch } from '@viral-struct/shared';
import type {
  Diagnosis,
  ExportResult,
  Material,
  ResolutionMethod,
  SourceVideo,
  TargetProduct,
  TimelineSeg,
} from '../services/structAdapter/structTypes';

// Shared multer instance (used by /scan, /sample/analyze, /materials/upload).
// 500MB hard cap per file — a clear Chinese 413 is returned when exceeded.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const upload = multer({ dest: getUploadDir(), limits: { fileSize: MAX_UPLOAD_BYTES } });
export const structRouter = Router();

/**
 * Wrap a multer middleware so a LIMIT_FILE_SIZE (or any multer error) becomes a
 * clear Chinese 413/400 instead of an unhandled error. Keeps the size cap honest
 * and fail-fast across every upload route.
 */
function withUploadGuard(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: `上传文件过大，单个文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB。` });
          return;
        }
        res.status(400).json({ error: `上传失败：${err.message}` });
        return;
      }
      if (err) {
        res.status(400).json({ error: `上传失败：${errorMessage(err)}` });
        return;
      }
      next();
    });
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stable per-session asset dir (NOT swept before produce), under the upload dir. */
function getAssetSessionDir(sessionId: string): string {
  return path.join(getUploadDir(), 'struct_assets', sessionId);
}

function stubProduct(sourceVideo: SourceVideo, materials: Material[]): TargetProduct {
  return {
    name: sourceVideo.title,
    category: sourceVideo.packaging.captions,
    price: '',
    stock: 0,
    asset_count: materials.length,
    industry: '',
  };
}

/* ─── GET /api/struct/sample/seeds — list seed videos for the picker ─── */
structRouter.get('/sample/seeds', async (_req, res) => {
  try {
    const videos = await listSeedVideos();
    res.json({ videos });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/sample/analyze — video → SourceVideo (StructureIR) ─── */
structRouter.post('/sample/analyze', withUploadGuard(upload.single('video')), async (req, res) => {
  try {
    const warnings: string[] = [];
    let videoId: string;
    let filePath: string | null;
    let title: string | undefined;

    if (req.file) {
      videoId = req.file.filename;
      filePath = req.file.path;
      title = req.file.originalname.replace(/\.[^.]+$/, '');
    } else {
      const sampleId = typeof req.body?.sampleId === 'string' && req.body.sampleId ? req.body.sampleId : null;
      if (sampleId) {
        videoId = sampleId;
        filePath = await getSeedVideoPath(sampleId);
        title = sampleId.replace(/\.[^.]+$/, '');
        if (!filePath) {
          res.status(400).json({ error: `seed video is not allowed or does not exist: ${sampleId}` });
          return;
        }
      } else {
        // No file and no sampleId — default to the first available seed video.
        const seeds = await listSeedVideos();
        if (!seeds.length) {
          res.status(400).json({ error: 'No video provided and no seed videos are available.' });
          return;
        }
        videoId = seeds[0].filename;
        title = seeds[0].displayName ?? seeds[0].filename;
        filePath = await getSeedVideoPath(seeds[0].filename);
        warnings.push(`未指定样例，默认分析 seed：${title}`);
      }
    }

    const manualTranscript = typeof req.body?.manualTranscript === 'string' ? req.body.manualTranscript : undefined;
    const analysis = await analyzeVideoFile({ videoId, filePath: filePath!, manualTranscript });
    if (analysis.analysisSource === 'mock_fallback') warnings.push('视频解析降级为 mock_fallback（ffmpeg 不可用或解析失败）');
    if (analysis.warnings?.length) warnings.push(...analysis.warnings);

    const structure = await extractStructureFromVideoAnalysis(analysis);
    if (structure.debug?.fallbackUsed) warnings.push('结构抽取降级为 mock 结构图');
    if (structure.debug?.warnings?.length) warnings.push(...structure.debug.warnings);

    const defaultedFields: string[] = [];
    const sourceVideo = graphToSourceVideo(structure.structureGraph, { videoId, title, defaultedFields });
    warnings.push('播放数据（点击率/完播/点赞）非真实测量，仅结构与转场为真实分析结果');
    if (defaultedFields.length) warnings.push('部分节奏/包装字段未检测，已留空');

    res.json({ sourceVideo, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/scan — REAL rough scan as an async job ──────────────────
   Upload a video → run the actual Python rough scan (ffmpeg preview → rough_scan.py
   VLM → structure graph) → poll GET /scan/:jobId for the real timeline. Async
   because the VLM scan takes ~30s–2min. */

type ScanJobStatus = 'running' | 'done' | 'error';
interface ScanJob {
  status: ScanJobStatus;
  stage?: string;
  sourceVideo?: SourceVideo;
  warnings?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const scanJobs = new Map<string, ScanJob>();

interface ScanArtifacts {
  videoPath: string;
  roughScanPath: string;
  workDir: string;
  createdAt: number;
}
/** Retained per-video scan inputs (raw video + rough output) for follow-up fine scans. */
const scanArtifacts = new Map<string, ScanArtifacts>();

interface FineJob {
  status: ScanJobStatus;
  stage?: string;
  segmentIndex: number;
  detail?: FineBlockDetail;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const fineJobs = new Map<string, FineJob>();

function sweepScanJobs(): void {
  const now = Date.now();
  for (const [id, job] of scanJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) scanJobs.delete(id);
  }
  for (const [id, job] of fineJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) fineJobs.delete(id);
  }
  // Evict retained scan inputs after 60 min (free disk: raw video + work dir).
  for (const [id, art] of scanArtifacts) {
    if (now - art.createdAt > 60 * 60_000) {
      scanArtifacts.delete(id);
      void unlink(art.videoPath).catch(() => {});
      void rm(art.workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

structRouter.post('/scan', withUploadGuard(upload.single('video')), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '请上传一个视频文件。' });
    return;
  }
  sweepScanJobs();
  const videoId = req.file.filename;
  const filePath = req.file.path;
  const title = req.file.originalname.replace(/\.[^.]+$/, '');
  const jobId = randomUUID();
  scanJobs.set(jobId, { status: 'running', stage: '排队中', startedAt: Date.now() });
  res.status(202).json({ jobId });

  void (async () => {
    const setStage = (stage: string) => {
      const j = scanJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    const startedAt = scanJobs.get(jobId)?.startedAt ?? Date.now();
    try {
      setStage('读取视频信息');
      const analysis = await analyzeVideoFile({ videoId, filePath });
      const { graph, warnings, roughScanPath, workDir } = await runRoughScan(filePath, videoId, analysis.metadata.duration, setStage);
      const defaultedFields: string[] = [];
      const sourceVideo = graphToSourceVideo(graph, { videoId, title, defaultedFields });
      // Retain the raw video + rough output so a follow-up fine scan can reuse them.
      scanArtifacts.set(videoId, { videoPath: filePath, roughScanPath, workDir, createdAt: Date.now() });
      scanJobs.set(jobId, {
        status: 'done',
        sourceVideo,
        warnings: [
          ...warnings,
          '结构来自真实 rough scan（VLM 逐镜头解析），非启发式模板',
          '播放数据（点击率/完播/点赞）非真实测量',
          ...(defaultedFields.length ? ['部分节奏/包装字段未检测，已留空'] : []),
        ],
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (error) {
      scanJobs.set(jobId, { status: 'error', error: errorMessage(error), startedAt, finishedAt: Date.now() });
      void unlink(filePath).catch(() => {}); // failed → nothing to retain
    }
  })();
});

structRouter.get('/scan/:jobId', (req, res) => {
  const job = scanJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'scan job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    sourceVideo: job.sourceVideo,
    warnings: job.warnings,
    error: job.error,
    elapsedSec,
  });
});

/* ─── POST /api/struct/scan/:videoId/fine — fine-scan ONE segment (deep detail) ──
   Reuses the rough scan's retained raw video + rough output. Async (per-block VLM,
   ~30–60s). Body: { segmentIndex }. Poll GET /scan/fine/:jobId. */

structRouter.post('/scan/:videoId/fine', async (req, res) => {
  const { videoId } = req.params;
  const artifacts = scanArtifacts.get(videoId);
  if (!artifacts) {
    res.status(404).json({ error: '找不到该视频的扫描数据（可能已过期，请重新上传并粗扫描）。' });
    return;
  }
  const segmentIndex = Number((req.body as { segmentIndex?: unknown })?.segmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    res.status(400).json({ error: 'segmentIndex（段落序号）缺失或无效。' });
    return;
  }

  let blockId: string;
  try {
    const rough = JSON.parse(await readFile(artifacts.roughScanPath, 'utf-8')) as { contentBlocks?: Array<{ id?: string }> };
    const blocks = rough.contentBlocks ?? [];
    const block = blocks[segmentIndex];
    if (!block?.id) {
      res.status(400).json({ error: '段落序号超出范围。' });
      return;
    }
    blockId = block.id;
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
    return;
  }

  sweepScanJobs();
  const jobId = randomUUID();
  fineJobs.set(jobId, { status: 'running', stage: '排队中', segmentIndex, startedAt: Date.now() });
  res.status(202).json({ jobId });

  void (async () => {
    const setStage = (stage: string) => {
      const j = fineJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    const startedAt = fineJobs.get(jobId)?.startedAt ?? Date.now();
    try {
      const { detail } = await runFineScan(artifacts.videoPath, artifacts.roughScanPath, videoId, blockId, artifacts.workDir, setStage);
      fineJobs.set(jobId, { status: 'done', segmentIndex, detail, startedAt, finishedAt: Date.now() });
    } catch (error) {
      fineJobs.set(jobId, { status: 'error', segmentIndex, error: errorMessage(error), startedAt, finishedAt: Date.now() });
    }
  })();
});

structRouter.get('/scan/fine/:jobId', (req, res) => {
  const job = fineJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'fine scan job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    segmentIndex: job.segmentIndex,
    detail: job.detail,
    error: job.error,
    elapsedSec,
  });
});

/* ─── POST /api/struct/materials/upload — assets → Material[] ─── */
structRouter.post('/materials/upload', withUploadGuard(upload.array('assets')), async (req, res) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    let product: TargetProduct | undefined;
    try {
      product = req.body?.product ? (JSON.parse(req.body.product) as TargetProduct) : undefined;
    } catch {
      product = undefined;
    }
    const textBrief = product
      ? [product.name, product.category, product.industry, product.price].filter(Boolean).join(' · ')
      : undefined;

    const result = await analyzeAssetsWithFallbackResult({ files, textBrief });
    const materials = assetCardsToMaterials(result.assetCards);
    const warnings = [...(result.warnings ?? [])];

    // T4: persist each uploaded file into a STABLE per-session dir so its url
    // survives to /produce (multer's temp dest could be reused/cleaned). Rewrite
    // each Material.url that points at an uploaded temp path to the stable copy.
    const pathRewrites = new Map<string, string>();
    if (files.length) {
      const sessionDir = getAssetSessionDir(randomUUID());
      mkdirSync(sessionDir, { recursive: true });
      for (const file of files) {
        const ext = path.extname(file.originalname) || path.extname(file.path);
        const stablePath = path.join(sessionDir, `${path.basename(file.path)}${ext}`);
        try {
          await copyFile(file.path, stablePath);
          pathRewrites.set(file.path, stablePath);
          void unlink(file.path).catch(() => {}); // free the temp copy; stable copy is authoritative
        } catch (copyError) {
          warnings.push(`素材落盘失败（${file.originalname}）：${errorMessage(copyError)}，将沿用临时路径`);
        }
      }
    }
    const stableMaterials = materials.map((m) =>
      m.url && pathRewrites.has(m.url) ? { ...m, url: pathRewrites.get(m.url) } : m,
    );

    if (result.assetCards.some((c) => c.analysisSource === 'mock_filename_rules')) {
      warnings.push('素材分析降级为文件名规则（mock_filename_rules）');
    }
    res.json({ materials: stableMaterials, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/materials/match — auto-match + apply assignments ─── */
structRouter.post('/materials/match', async (req, res) => {
  try {
    const sourceVideo = req.body?.sourceVideo as SourceVideo;
    const incoming = (req.body?.materials ?? []) as Material[];
    const assignments = (req.body?.assignments ?? {}) as Record<string, string | null>;
    if (!sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }

    const product = stubProduct(sourceVideo, incoming);
    const graph = buildStructureGraph(sourceVideo);
    const assetCards = materialsToAssetCards(incoming, sourceVideo, product);
    const matchResult = await matchSlotsWithFallback({ graph, assets: assetCards, boundaries: graph.boundaries });

    // Auto-suggest a slot for each material from its best SlotMatch, then let
    // any explicit user assignment win.
    const slotByAsset = new Map<string, string>();
    for (const m of matchResult.matches) {
      if (m.assetId && (m.status === 'matched' || m.status === 'partial')) slotByAsset.set(m.assetId, m.slotId);
    }
    const materials: Material[] = incoming.map((m) => {
      if (m.id in assignments) return { ...m, slot: assignments[m.id] };
      const auto = slotByAsset.get(m.id);
      return auto ? { ...m, slot: auto } : m;
    });

    const warnings = matchResult.warning ? [matchResult.warning] : [];
    if (matchResult.alignmentSource === 'rule_based') warnings.push('槽位对齐使用规则降级（非 LLM judge）');
    res.json({ materials, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/diagnose — four-state diagnosis per slot ─── */
structRouter.post('/diagnose', async (req, res) => {
  try {
    const sourceVideo = req.body?.sourceVideo as SourceVideo;
    const materials = (req.body?.materials ?? []) as Material[];
    const product = (req.body?.product as TargetProduct) ?? stubProduct(sourceVideo, materials);
    if (!sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }

    const graph = buildStructureGraph(sourceVideo);
    const assetCards = materialsToAssetCards(materials, sourceVideo, product);
    const contentBrief = buildContentBrief(product, sourceVideo);

    const matchResult = await matchSlotsWithFallback({ graph, assets: assetCards, boundaries: graph.boundaries });

    // Real per-gap 3-option resolution (T1): for each slot derive its tier
    // (matched/partial/gap) and ask the Director Agent for the full
    // reshoot + HyperFrames + AIGC menu (with a recommendation).
    const slotResolutions = buildSlotResolutions({
      graph,
      matches: matchResult.matches,
      assetCards,
      contentBrief,
    });

    const diagnosis = toDiagnosisRecord({
      sourceVideo,
      matches: matchResult.matches,
      gaps: matchResult.gaps,
      repairs: [],
      materials,
      slotResolutions,
    });

    const warnings: string[] = [];
    if (matchResult.warning) warnings.push(matchResult.warning);
    if (matchResult.alignmentSource === 'rule_based') warnings.push('槽位对齐使用规则降级（非 LLM judge）');

    res.json({ diagnosis, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

const RESOLUTION_METHODS: readonly ResolutionMethod[] = ['reshoot', 'hyperframes', 'aigc'];
const RESOLUTION_METHOD_NAMES: Record<ResolutionMethod, string> = {
  reshoot: '补拍',
  hyperframes: 'HyperFrames 卡片',
  aigc: 'AIGC 生成',
};
function parseResolutionMethod(value: unknown): ResolutionMethod | null {
  return typeof value === 'string' && (RESOLUTION_METHODS as readonly string[]).includes(value)
    ? (value as ResolutionMethod)
    : null;
}

/* ─── POST /api/struct/strategy/apply — apply the chosen repair method to a slot ─── */
structRouter.post('/strategy/apply', async (req, res) => {
  try {
    const slotId = String(req.body?.slotId ?? '');
    const diagnosis = { ...((req.body?.diagnosis ?? {}) as Record<string, Diagnosis>) };
    if (!slotId || !diagnosis[slotId]) {
      res.status(400).json({ error: 'slotId and a diagnosis containing it are required' });
      return;
    }
    const current = diagnosis[slotId];

    // T2: honor the chosen method ('reshoot' | 'hyperframes' | 'aigc'). When the
    // request omits `method`, fall back to the slot's Director recommendation, then
    // to its strategy. Fail-fast if a method is supplied but invalid.
    const requested = req.body?.method;
    let method: ResolutionMethod | null;
    if (requested === undefined || requested === null || requested === '') {
      method = current.recommended ?? parseResolutionMethod(current.strategy) ?? 'hyperframes';
    } else {
      method = parseResolutionMethod(requested);
      if (!method) {
        res.status(400).json({ error: `method 无效：必须是 reshoot / hyperframes / aigc 之一（收到：${String(requested)}）` });
        return;
      }
    }
    const payload = req.body?.payload;

    // Applying the chosen strategy lifts the slot to 已满足 (the gap is now covered by
    // the chosen repair). Persist chosenMethod/payload so compile/produce can honor it.
    diagnosis[slotId] = {
      ...current,
      state: 'filled',
      gap_reason: '—',
      chosenMethod: method,
      ...(payload !== undefined ? { chosenPayload: payload } : {}),
      strategy: method,
      impact: {
        ...current.impact,
        pct: 0,
        note: `已应用补全策略：${RESOLUTION_METHOD_NAMES[method]} · ${current.impact.note}`,
      },
    };
    res.json({ diagnosis, appliedSlots: [slotId], method, warnings: [] });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/compile — version → timeline ─── */
structRouter.post('/compile', async (req, res) => {
  try {
    const sourceVideo = req.body?.sourceVideo as SourceVideo;
    const materials = (req.body?.materials ?? []) as Material[];
    const diagnosis = (req.body?.diagnosis ?? {}) as Record<string, Diagnosis>;
    const versionId = String(req.body?.versionId ?? 'click');
    if (!sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }

    const product = stubProduct(sourceVideo, materials);
    const graph = buildStructureGraph(sourceVideo);
    const assetCards = materialsToAssetCards(materials, sourceVideo, product);
    const contentBrief: ContentBrief = buildContentBrief(product, sourceVideo);

    // ② Director Agent (plan-only) → ③ Video Agent handoff: transfer the source
    // structure onto the product, then project the plan into the flat TimelineItem[]
    // the UI timeline consumes. useLlmMatcher:false keeps it deterministic/offline.
    const orchestrated = await runDirectorAgent({
      projectId: sourceVideo.id,
      structureGraph: graph,
      assetCards,
      contentBrief,
      boundaries: graph.boundaries,
      options: {
        targetDurationMode: variantToTargetDurationMode(versionIdToVariant(versionId)),
        useLlmMatcher: false,
      },
    });
    const authored = orchestratedToAuthored(orchestrated, { assetCards });
    const timelineItems = authoredTimelineToTimelineItems(authored);

    const timeline = timelineItemsToSegs(timelineItems, { sourceVideo, diagnosis });
    const version = versionFromId(versionId);
    const warnings = [...new Set(orchestrated.warnings)];

    res.json({ version, timeline, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/nl-edit — natural-language timeline edit ─── */
structRouter.post('/nl-edit', async (req, res) => {
  try {
    const instruction = String(req.body?.instruction ?? '');
    const segs = (req.body?.timeline ?? []) as TimelineSeg[];
    const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
    if (!Array.isArray(segs) || segs.length === 0) {
      res.status(400).json({ error: 'timeline (non-empty) is required', timeline: [], patchSummary: 'Timeline 缺失' });
      return;
    }

    const items = segsToTimelineItems(segs);
    const result = await applyNaturalLanguageEditWithFallback({ instruction, timeline: items });
    const timeline = timelineItemsToSegs(result.timeline, { sourceVideo });

    // Synthesize the UI's required patchSummary string from the structured patches
    // (the new editor returns patches/operations, not a prebuilt summary).
    const patchSummary = result.patches.length
      ? result.patches.map((p) => p.reason).join('；')
      : result.operations.length
        ? '指令已识别，但未产生实际改动'
        : '未识别该改片指令';

    const warnings = [...(result.warning ? [result.warning] : [])];
    if (result.operations.length === 0) {
      warnings.push('未识别的改片指令，支持：减少字幕 / 增强节奏 / 商品信息提前 / 开头更抓人');
    }

    res.json({ timeline, patchSummary, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/export + GET /api/struct/export/:jobId ─── */
const exportJobs = new Map<string, ExportResult>();
let exportSeq = 0;

function profileFromFormat(format: string): { profile?: RenderProfile; warnings: string[] } {
  const warnings: string[] = [];
  if (/mov|prores/i.test(format)) {
    warnings.push('MOV / ProRes 暂未支持，已回退为 MP4 1080×1920');
    return { profile: { width: 1080, height: 1920, fps: 30, format: 'mp4' }, warnings };
  }
  if (/720/.test(format)) return { profile: { width: 720, height: 1280, fps: 30, format: 'mp4' }, warnings };
  if (/1080/.test(format)) return { profile: { width: 1080, height: 1920, fps: 30, format: 'mp4' }, warnings };
  return { profile: undefined, warnings };
}

function absoluteMediaUrl(req: Request, mediaUrl: string): string {
  return /^https?:\/\//i.test(mediaUrl) ? mediaUrl : `${req.protocol}://${req.get('host')}${mediaUrl}`;
}

const DEFAULT_EXPORT_PROFILE: RenderProfile = { width: 1080, height: 1920, fps: 30, format: 'mp4' };

/**
 * Map the UI's asset-stripped TimelineItem[] into an AuthoredTimeline for the
 * Video Agent renderer. The incoming segs carry no assetId (the UI strips media
 * before export), so EVERY beat is marked `unresolvedReason` → the renderer paints
 * the honest substitute card. This is inherently plan-only: no real pixels exist to
 * composite, so the export stays honest about producing no MP4.
 */
function timelineItemsToAuthored(
  items: TimelineItem[],
  opts: { profile: RenderProfile },
): AuthoredTimeline {
  const beats: AuthoredComposition[] = items.map((item, i) => {
    const startSeconds = Math.max(0, item.start);
    const endSeconds = Math.max(startSeconds + 0.1, item.end);
    const captions = (item.subtitles ?? []).filter(Boolean);
    return {
      id: item.id || `beat_${i + 1}`,
      segmentRole: item.segmentRole as AuthoredSegmentRole,
      startSeconds,
      endSeconds,
      mediaLayers: [],
      textElements: captions.length
        ? [{ id: `${item.id || `beat_${i + 1}`}_text`, type: 'headline', content: captions, zOrder: 10 }]
        : [],
      unresolvedReason: 'export plan-only: timeline is asset-stripped, no real media to composite',
    };
  });
  return {
    schemaVersion: '1.0',
    renderProfile: { width: opts.profile.width, height: opts.profile.height, fps: opts.profile.fps, format: 'mp4' },
    beats,
    meta: { beatCount: beats.length },
  };
}

structRouter.post('/export', async (req, res) => {
  try {
    const segs = (req.body?.timeline ?? []) as TimelineSeg[];
    const format = String(req.body?.format ?? 'MP4 · 1080×1920');
    if (!Array.isArray(segs) || segs.length === 0) {
      res.status(400).json({ error: 'timeline (non-empty) is required' });
      return;
    }

    const items = segsToTimelineItems(segs);
    const { profile, warnings } = profileFromFormat(format);
    const jobId = `exp_${Date.now().toString(36)}_${exportSeq++}`;

    let result: ExportResult;
    try {
      const authored = timelineItemsToAuthored(items, { profile: profile ?? DEFAULT_EXPORT_PROFILE });
      const renderDir = getRenderDir();
      mkdirSync(renderDir, { recursive: true });
      const render = await renderAuthoredTimeline({
        timeline: authored,
        outputPath: path.join(renderDir, `render_${jobId}_${nanoid(8)}.mp4`),
      });
      const mediaUrl = render.rendered && render.outputPath ? `/media/renders/${path.basename(render.outputPath)}` : null;
      if (mediaUrl) {
        result = {
          jobId,
          status: 'done',
          progress: 100,
          downloadUrl: absoluteMediaUrl(req, mediaUrl),
          warnings: [...warnings, ...(render.warnings ?? [])],
        };
      } else {
        // Honest: no real pixels were produced (plan-only). No fake download link.
        result = {
          jobId,
          status: 'done',
          progress: 100,
          warnings: [
            ...warnings,
            '渲染为计划态（plan-only），未产出真实 MP4，暂无可下载文件',
            ...(render.warnings ?? []),
          ],
        };
      }
    } catch (renderError) {
      // A render failure (e.g. ffmpeg unavailable) must never break export.
      // Surface it honestly as a plan-only job with no fake download link.
      result = {
        jobId,
        status: 'done',
        progress: 100,
        warnings: [
          ...warnings,
          `渲染不可用，已生成时间线计划但未产出 MP4：${errorMessage(renderError)}`,
        ],
      };
    }
    exportJobs.set(jobId, result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

structRouter.get('/export/:jobId', (req, res) => {
  const result = exportJobs.get(req.params.jobId);
  if (!result) {
    res.status(404).json({ jobId: req.params.jobId, status: 'failed', progress: 0, warnings: ['export job not found'] });
    return;
  }
  res.json(result);
});

/* ─── POST /api/struct/produce + GET /api/struct/produce/:jobId ────────────────
   REAL AIGC produce (T3): rebuild the shared context, run the Director Agent to get
   the OrchestratedTimeline (NOT the asset-stripped UI segs), plan AIGC beats and
   render them via Wan2.7. Async (generation takes minutes); mirrors the /scan job
   pattern. HONEST-GATE: if DASHSCOPE_API_KEY is unset the job fails with a clear
   message and never produces a fake MP4. */

type ProduceJobStatus = 'running' | 'done' | 'error';
interface ProduceJob {
  status: ProduceJobStatus;
  stage?: string;
  downloadUrl?: string;
  warnings?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const produceJobs = new Map<string, ProduceJob>();

function sweepProduceJobs(): void {
  const now = Date.now();
  for (const [id, job] of produceJobs) {
    if (job.finishedAt && now - job.finishedAt > 60 * 60_000) produceJobs.delete(id);
  }
}

structRouter.post('/produce', (req, res) => {
  const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
  if (!sourceVideo?.segments?.length) {
    res.status(400).json({ error: 'sourceVideo with segments is required' });
    return;
  }
  const materials = (req.body?.materials ?? []) as Material[];
  const product = (req.body?.product as TargetProduct) ?? stubProduct(sourceVideo, materials);
  const productImageUrl =
    typeof req.body?.productImageUrl === 'string' && req.body.productImageUrl ? req.body.productImageUrl : undefined;
  const versionId = String(req.body?.versionId ?? 'click');

  sweepProduceJobs();
  const jobId = randomUUID();
  produceJobs.set(jobId, { status: 'running', stage: '排队中', startedAt: Date.now() });
  // Capture the absolute media base BEFORE going async (req is request-scoped).
  const mediaBase = `${req.protocol}://${req.get('host')}`;
  res.status(202).json({ jobId });

  void (async () => {
    const startedAt = produceJobs.get(jobId)?.startedAt ?? Date.now();
    const setStage = (stage: string) => {
      const j = produceJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    const fail = (error: string) => {
      produceJobs.set(jobId, { status: 'error', error, startedAt, finishedAt: Date.now() });
    };
    try {
      // (a) HONEST-GATE: verify generation is configured BEFORE doing any work.
      let cfg: ReturnType<typeof wanConfigFromEnv>;
      try {
        cfg = wanConfigFromEnv();
      } catch {
        fail('成片生成未配置：缺少 DASHSCOPE_API_KEY（请在 apps/api/.env 配置后重试）');
        return;
      }

      const warnings: string[] = [];
      // (b) rebuild graph/assetCards/contentBrief, then run the Director Agent →
      // OrchestratedTimeline (the asset-bearing plan, NOT the UI-stripped segs).
      setStage('准备结构与素材');
      const graph = buildStructureGraph(sourceVideo);
      const assetCards = materialsToAssetCards(materials, sourceVideo, product);
      const contentBrief = buildContentBrief(product, sourceVideo);
      if (assetCards.every((c) => !c.url)) {
        warnings.push('无可用真实素材（素材均无 url），AIGC 将以纯生成兜底，效果可能下降');
      }
      if (!productImageUrl) {
        warnings.push('未提供产品参考图（productImageUrl），AIGC 生成可能偏离真实包装');
      }

      setStage('运行导演 Agent（编排时间线）');
      const orchestrated = await runDirectorAgent({
        projectId: sourceVideo.id,
        structureGraph: graph,
        assetCards,
        contentBrief,
        boundaries: graph.boundaries,
        options: {
          targetDurationMode: variantToTargetDurationMode(versionIdToVariant(versionId)),
          useLlmMatcher: false,
        },
      });
      warnings.push(...new Set(orchestrated.warnings));

      // (c) plan AIGC beats → render via Wan2.7 (ported from scripts/render_director_aigc.mts).
      setStage('规划 AIGC 分镜');
      const plans = planAigcBeats({
        timeline: orchestrated,
        assetCards,
        productImageUrl,
        productName: contentBrief.productName,
        resolution: '720P',
      });

      setStage('生成并合成成片（Wan2.7，耗时较长）');
      const renderDir = getRenderDir();
      mkdirSync(renderDir, { recursive: true });
      const outputPath = path.join(renderDir, `produce_${jobId}.mp4`);
      const workDir = path.join(renderDir, `produce_${jobId}_beats`);
      const result = await renderAigcTimeline({ plans, outputPath, cfg, workDir, concurrency: 4 });

      const renderWarnings = [...warnings, ...result.warnings];
      if (result.rendered) {
        const downloadUrl = `${mediaBase}/media/renders/${path.basename(result.outputPath)}`;
        produceJobs.set(jobId, {
          status: 'done',
          downloadUrl,
          warnings: renderWarnings,
          startedAt,
          finishedAt: Date.now(),
        });
      } else {
        // Honest: no real MP4 was produced. Surface warnings, no fake download link.
        produceJobs.set(jobId, {
          status: 'done',
          warnings: [...renderWarnings, '成片未渲染成功（无可合成的真实片段或合成失败），暂无可下载文件'],
          startedAt,
          finishedAt: Date.now(),
        });
      }
    } catch (error) {
      fail(errorMessage(error));
    }
  })();
});

structRouter.get('/produce/:jobId', (req, res) => {
  const job = produceJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'produce job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    downloadUrl: job.downloadUrl,
    warnings: job.warnings,
    error: job.error,
    elapsedSec,
  });
});

/**
 * Build the REAL per-slot 3-option resolution menu (reshoot + HyperFrames + AIGC)
 * for every shotSlot in the graph (T1). Each slot's tier is derived from the match
 * result: matched → covered (the three options are alternatives); partial → augment;
 * missing → a true gap. The Director Agent authors the full option payload.
 */
function buildSlotResolutions(input: {
  graph: ReturnType<typeof buildStructureGraph>;
  matches: SlotMatch[];
  assetCards: ReturnType<typeof materialsToAssetCards>;
  contentBrief: ContentBrief;
}): Record<string, SlotGapResolution> {
  const { graph, matches, assetCards, contentBrief } = input;
  const matchBySlot = new Map(matches.map((m) => [m.slotId, m]));
  const referenceAssetIds = assetCards.map((c) => c.id);
  const out: Record<string, SlotGapResolution> = {};

  for (const slot of graph.shotSlots) {
    const match = matchBySlot.get(slot.id);
    const tier: 'matched' | 'partial' | 'gap' =
      match?.status === 'matched' ? 'matched' : match?.status === 'partial' ? 'partial' : 'gap';
    const { options, recommendedOptionId } = buildGapResolutionOptions({
      slot,
      tier,
      contentBrief,
      referenceAssetIds,
      chosenAssetId: tier === 'gap' ? undefined : match?.assetId,
    });
    out[slot.id] = { options, recommendedOptionId };
  }

  return out;
}

/* ============================================================
   CAPABILITY ROUTES — surface the remaining backend functions to
   UI buttons. Each takes the UI model (sourceVideo / materials /
   optional compiled timeline) and composes the real shared pipeline.
   ============================================================ */

/** Re-derive the full shared-protocol context from the UI model. */
async function composeSharedContext(body: {
  sourceVideo: SourceVideo;
  materials?: Material[];
  product?: TargetProduct;
  timeline?: TimelineSeg[];
  versionId?: string;
}) {
  const sourceVideo = body.sourceVideo;
  const materials = body.materials ?? [];
  const product = body.product ?? stubProduct(sourceVideo, materials);
  const graph = buildStructureGraph(sourceVideo);
  const assetCards = materialsToAssetCards(materials, sourceVideo, product);
  const contentBrief = buildContentBrief(product, sourceVideo);
  const matchResult = await matchSlotsWithFallback({ graph, assets: assetCards, boundaries: graph.boundaries });

  // Gap repairs are now folded into the Director Agent's per-beat plan; downstream
  // capability routes tolerate an empty repairs list (every repair-derived field has
  // a fallback). When a compiled timeline is supplied we reuse it verbatim; otherwise
  // we derive one via the director → authored → flat-items handoff (plan-only).
  let timelineItems: TimelineItem[];
  let timelineWarning: string | undefined;
  if (Array.isArray(body.timeline) && body.timeline.length) {
    timelineItems = segsToTimelineItems(body.timeline);
  } else {
    const orchestrated = await runDirectorAgent({
      projectId: sourceVideo.id,
      structureGraph: graph,
      assetCards,
      contentBrief,
      boundaries: graph.boundaries,
      options: {
        targetDurationMode: variantToTargetDurationMode(versionIdToVariant(body.versionId)),
        useLlmMatcher: false,
      },
    });
    const authored = orchestratedToAuthored(orchestrated, { assetCards });
    timelineItems = authoredTimelineToTimelineItems(authored);
    timelineWarning = orchestrated.warnings.length ? [...new Set(orchestrated.warnings)].join('；') : undefined;
  }

  return { graph, assetCards, contentBrief, matchResult, repairs: [], timelineItems, timelineWarning, boundaries: graph.boundaries };
}

/* ─── POST /api/struct/quality — self-check scorecard (QualityReport) ─── */
structRouter.post('/quality', async (req, res) => {
  try {
    if (!req.body?.sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }
    const ctx = await composeSharedContext(req.body);
    const qualityReport = evaluateQuality({
      matches: ctx.matchResult.matches,
      timeline: ctx.timelineItems,
      boundaries: ctx.boundaries,
      contentBrief: ctx.contentBrief,
      assets: ctx.assetCards,
    });
    res.json({ qualityReport, warnings: qualityReport.warnings ?? [] });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/estimate — offline viral-potential estimate ─── */
structRouter.post('/estimate', async (req, res) => {
  try {
    if (!req.body?.sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }
    const ctx = await composeSharedContext(req.body);
    const qualityReport = evaluateQuality({
      matches: ctx.matchResult.matches,
      timeline: ctx.timelineItems,
      boundaries: ctx.boundaries,
      contentBrief: ctx.contentBrief,
      assets: ctx.assetCards,
    });
    const demoEstimate = estimateDemoAnalytics({
      structureGraph: ctx.graph,
      contentBrief: ctx.contentBrief,
      slotMatches: ctx.matchResult.matches,
      materialGaps: ctx.matchResult.gaps,
      repairs: ctx.repairs,
      timeline: ctx.timelineItems,
      qualityReport,
      generationVariant: versionIdToVariant(req.body?.versionId),
    });
    res.json({ demoEstimate, warnings: [] });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/safety — brand / IP / claim safety guardrail ─── */
structRouter.post('/safety', (req, res) => {
  try {
    const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
    const product = req.body?.product as TargetProduct | undefined;
    const timeline = (req.body?.timeline ?? []) as TimelineSeg[];
    const captions = timeline.length
      ? timeline.map((s) => s.caption).filter(Boolean)
      : (sourceVideo?.segments ?? []).map((s) => s.caption).filter(Boolean);
    const shots = timeline.length
      ? timeline.map((s) => s.shot).filter(Boolean)
      : (sourceVideo?.segments ?? []).map((s) => s.shot).filter(Boolean);

    const safetyStatus = checkBrandSafety({
      prompt: [product?.name, product?.industry, product?.category].filter(Boolean).join('\n'),
      script: captions.join('\n'),
      packaging: sourceVideo?.packaging?.captions ?? '',
      shotSpec: shots.join('\n'),
    });
    res.json({
      safetyStatus,
      disclaimer: 'Deterministic demo guardrail only. This is not legal advice and does not call an external brand safety service.',
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/storyboard — prompt-ready storyboard frames ─── */
structRouter.post('/storyboard', async (req, res) => {
  try {
    if (!req.body?.sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }
    const ctx = await composeSharedContext(req.body);
    const result = planStoryboardFrames({
      timeline: ctx.timelineItems,
      structureGraph: ctx.graph,
      contentBrief: ctx.contentBrief,
      assetCards: ctx.assetCards,
      slotMatches: ctx.matchResult.matches,
      materialGaps: ctx.matchResult.gaps,
      repairs: ctx.repairs,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── POST /api/struct/material-jobs — AIGC generation specs for gaps ─── */
structRouter.post('/material-jobs', async (req, res) => {
  try {
    if (!req.body?.sourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }
    const ctx = await composeSharedContext(req.body);
    const result = planMissingMaterialGenerationJobs({
      materialGaps: ctx.matchResult.gaps,
      repairs: ctx.repairs,
      timeline: ctx.timelineItems,
      contentBrief: ctx.contentBrief,
      aspectRatio: '9:16',
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── GET /api/struct/materials/library/:libraryId — load a prebuilt library ─── */
structRouter.get('/materials/library/:libraryId', async (req, res) => {
  try {
    const assetCards = await loadAssetLibrary(req.params.libraryId);
    res.json({ materials: assetCardsToMaterials(assetCards), warnings: [`已加载素材库：${req.params.libraryId}`] });
  } catch (error) {
    res.status(400).json({ error: `素材库加载失败：${errorMessage(error)}` });
  }
});

/* ─── GET /api/struct/demo — one-click: run the full demo into the UI model ─── */
structRouter.get('/demo', async (_req, res) => {
  try {
    const warnings: string[] = [];
    const showcase = getDemoShowcase();
    const filePath = await getSeedVideoPath(showcase.case.seedFilename);
    if (!filePath) {
      res.status(500).json({ error: `Demo seed video not found: ${showcase.case.seedFilename}` });
      return;
    }
    const analysis = await analyzeVideoFile({
      videoId: showcase.case.seedFilename,
      filePath,
      manualTranscript: showcase.case.manualTranscript,
    });
    if (analysis.analysisSource === 'mock_fallback') warnings.push('视频解析降级为 mock_fallback');
    const structure = await extractStructureFromVideoAnalysis(analysis);
    const defaultedFields: string[] = [];
    const sourceVideo = graphToSourceVideo(structure.structureGraph, {
      videoId: showcase.case.seedFilename,
      title: showcase.case.title,
      defaultedFields,
    });
    if (defaultedFields.length) warnings.push('部分节奏/包装字段未检测，已留空');

    const product: TargetProduct = {
      name: showcase.case.productName,
      category: showcase.case.scenario,
      price: '—',
      stock: 0,
      asset_count: 0,
      industry: showcase.case.targetAudience,
    };

    // T5: a failed example-library load must be VISIBLE, not silently swallowed.
    let assetCards: Awaited<ReturnType<typeof loadAssetLibrary>> = [];
    try {
      assetCards = await loadAssetLibrary(showcase.case.assetLibraryId);
    } catch (libError) {
      warnings.push(`示例素材库加载失败：${errorMessage(libError)}，演示将以 0 素材继续`);
    }
    const materials = assetCardsToMaterials(assetCards);
    product.asset_count = materials.length;

    const diagReq = { sourceVideo, materials, product };
    const graph = buildStructureGraph(sourceVideo);
    const cards = materialsToAssetCards(materials, sourceVideo, product);
    const contentBrief = buildContentBrief(product, sourceVideo);
    const matchResult = await matchSlotsWithFallback({ graph, assets: cards, boundaries: graph.boundaries });
    const slotResolutions = buildSlotResolutions({
      graph,
      matches: matchResult.matches,
      assetCards: cards,
      contentBrief,
    });
    const diagnosis = toDiagnosisRecord({
      sourceVideo, matches: matchResult.matches, gaps: matchResult.gaps, repairs: [], materials, slotResolutions,
    });
    const orchestrated = await runDirectorAgent({
      projectId: sourceVideo.id,
      structureGraph: graph,
      assetCards: cards,
      contentBrief,
      boundaries: graph.boundaries,
      options: {
        targetDurationMode: variantToTargetDurationMode('high_click'),
        useLlmMatcher: false,
      },
    });
    const authored = orchestratedToAuthored(orchestrated, { assetCards: cards });
    const timelineItems = authoredTimelineToTimelineItems(authored);
    const timeline = timelineItemsToSegs(timelineItems, { sourceVideo, diagnosis });

    if (matchResult.alignmentSource === 'rule_based') warnings.push('槽位对齐使用规则降级');
    warnings.push(...new Set(orchestrated.warnings));
    void diagReq;

    res.json({
      sourceVideo,
      product,
      materials,
      diagnosis,
      version: versionFromId('click'),
      timeline,
      showcaseTitle: showcase.case.title,
      warnings,
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});
