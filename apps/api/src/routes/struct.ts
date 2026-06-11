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
import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Request } from 'express';
import { analyzeVideoFile, getSeedVideoPath, getUploadedVideoPath, listSeedVideos } from '../services/videoAnalyzer';
import { extractStructureFromVideoAnalysis } from '../services/structureExtractor';
import { runRoughScan, getScanDataDir } from '../services/roughScanRunner';
import { runFineScan, runFineScanBatch, type FineBlockDetail } from '../services/fineScanRunner';
import { runBoundaryScan } from '../services/boundaryScanRunner';
import { analyzeAssetsWithFallbackResult } from '../services/assetAnalyzer';
import { matchSlotsWithFallback } from '../services/slotMatcher';
import { runDirectorAgent, buildGapResolutionOptions } from '../services/directorAgent';
import { translateCategoryEquivalents } from '../services/directorAgent/categoryEquivalentTranslator';
import { deriveSourceIdentityBanlist } from '../services/directorAgent/sourceIdentityBanlist';
import { parseContentBrief } from '../services/productIntelligence/contentBriefParser';
import { analyzeProductIntelligence } from '../services/productIntelligence/productIntelligenceAnalyzer';
import { enrichSourceVideoWithFineScan } from '../services/structAdapter/fineScanMotifAdapter';
import { planAigcBeats } from '@viral-struct/video-agent';
import { renderAigcTimeline } from '../services/videoAgent/aigcRenderer';
import { wanConfigFromEnv } from '../services/videoAgent/wanVideoClient';
import { orchestratedToAuthored } from '../services/videoAgent/orchestratedToAuthored';
import { authoredTimelineToTimelineItems } from '../services/videoAgent/authoredTimelineAdapter';
import { renderAuthoredTimeline } from '../services/videoAgent/runVideoAgentPipeline';
import { renderHyperframesForSlot } from '../services/hyperframesSlotRenderer';
import { renderTransitionPreview, transitionDurationMs } from '../services/transitionRenderer';
import { rewriteAssetCardUrlsToDisk } from '../services/authoredRenderService';
import { applyNaturalLanguageEditWithFallback } from '../services/timelineEditor';
import { evaluateQuality } from '../services/qualityEvaluator';
import { checkBrandSafety } from '../services/brandSafetyChecker';
import { estimateDemoAnalytics } from '../services/demoScoringEstimator';
import { planStoryboardFrames } from '../services/storyboardPromptPlanner';
import { planMissingMaterialGenerationJobs } from '../services/missingMaterialGenerationPlanner';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { saveScan, listScans, getScan } from '../services/db/scanRepository';
import { saveMatchSet, getMatchSet } from '../services/db/matchRepository';
import { appendLibraryCards, readLibraryCards, listLibraries } from '../services/db/assetLibraryRepository';
import { getDemoShowcase } from '../services/demoShowcase';
import { getPipelineDataDir, getRenderDir, getUploadDir } from '../services/videoPaths';
import {
  deleteStructure,
  getStructure,
  getStructureArtifacts,
  listStructures,
  saveStructure,
} from '../services/structLibraryStore';
import type { RenderProfile } from '@viral-struct/render-executor';
import type {
  AuthoredComposition,
  AuthoredSegmentRole,
  AuthoredTimeline,
  ContentBrief,
  MotionToken,
  ProductIntelligence,
  TimelineItem,
  ViralMotifAnnotation,
} from '@viral-struct/shared';
import { ContentBriefSchema, ProductIntelligenceSchema } from '@viral-struct/shared';
import {
  assetCardsToMaterials,
  boundaryToUiTransition,
  boundaryTypeToUi,
  buildContentBrief,
  buildStructureGraph,
  graphToSourceVideo,
  materialsToAssetCards,
  segsToTimelineItems,
  techniqueTagsToBoundaryType,
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
  Transition,
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

/** Uploaded asset session dirs awaiting cleanup, keyed by dir path. Swept after ~2h
 *  so the stable per-session copies created in /materials/upload don't leak on disk. */
const assetSessionDirs = new Map<string, { dir: string; createdAt: number }>();

function sweepAssetSessionDirs(): void {
  const now = Date.now();
  for (const [dir, entry] of assetSessionDirs) {
    if (now - entry.createdAt > 2 * 60 * 60_000) {
      assetSessionDirs.delete(dir);
      void rm(entry.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
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

const ProductParseRequestSchema = z.object({
  rawInput: z.string().trim().min(10, 'rawInput must be at least 10 characters'),
});

function contentBriefToProduct(contentBrief: ContentBrief, rawProductDescription?: string): TargetProduct {
  return {
    name: contentBrief.productName,
    category: contentBrief.category ?? contentBrief.scenario,
    price: '',
    stock: 0,
    asset_count: 0,
    industry: contentBrief.targetAudience,
    description: rawProductDescription,
    sellingPoints: contentBrief.sellingPoints,
    cta: contentBrief.cta,
    stylePreference: contentBrief.stylePreference,
  };
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseContentBriefPayload(value: unknown, warnings: string[]): ContentBrief | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = ContentBriefSchema.safeParse(parseJsonMaybe(value));
  if (!parsed.success) {
    warnings.push(`contentBrief 无效，已回退到 product 推断：${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return undefined;
  }
  return parsed.data;
}

function parseProductIntelligencePayload(value: unknown, warnings: string[]): ProductIntelligence | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = ProductIntelligenceSchema.safeParse(parseJsonMaybe(value));
  if (!parsed.success) {
    warnings.push(`productIntelligence 无效，已忽略：${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return undefined;
  }
  return parsed.data;
}

function resolveProductAndBrief(
  body: {
    product?: TargetProduct;
    contentBrief?: unknown;
    productIntelligence?: unknown;
    rawProductDescription?: unknown;
  },
  sourceVideo: SourceVideo,
  materials: Material[],
  warnings: string[]
) {
  const contentBriefFromBody = parseContentBriefPayload(body.contentBrief, warnings);
  const rawProductDescription =
    typeof body.rawProductDescription === 'string' && body.rawProductDescription.trim()
      ? body.rawProductDescription.trim()
      : undefined;
  const product =
    body.product ??
    (contentBriefFromBody
      ? contentBriefToProduct(contentBriefFromBody, rawProductDescription)
      : stubProduct(sourceVideo, materials));
  const contentBrief = contentBriefFromBody ?? buildContentBrief(product, sourceVideo);
  const productIntelligence = parseProductIntelligencePayload(body.productIntelligence, warnings);
  return { product, contentBrief, productIntelligence };
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
/* POST /api/struct/product/parse — user's natural-language product brief -> structured brief. */
structRouter.post('/product/parse', async (req, res) => {
  const parsedRequest = ProductParseRequestSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    res.status(400).json({ error: parsedRequest.error.issues[0]?.message ?? 'rawInput is invalid' });
    return;
  }

  try {
    const { rawInput } = parsedRequest.data;
    const parsedBrief = await parseContentBrief({ rawInput });
    const product = contentBriefToProduct(parsedBrief.contentBrief, rawInput);
    const productIntel = await analyzeProductIntelligence({ contentBrief: parsedBrief.contentBrief });
    const warnings = [...parsedBrief.warnings, ...productIntel.warnings];

    res.json({
      product,
      contentBrief: parsedBrief.contentBrief,
      productIntelligence: productIntel.productIntelligence,
      warnings,
      parseWarnings: warnings,
      source: parsedBrief.source,
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

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
  /**
   * When true, the entry's files are LIBRARY-OWNED (persisted under getStructLibraryDir
   * via a reopened structure). The TTL sweep evicts the in-memory entry but must NOT
   * unlink/delete its files — otherwise reopening would destroy the persisted source.
   */
  keepFiles?: boolean;
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

interface FineAllJob {
  status: ScanJobStatus;
  stage?: string;
  total: number;
  /** Per-segment-id fine detail (== rough block id) once done. */
  details?: Record<string, FineBlockDetail>;
  warnings?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const fineAllJobs = new Map<string, FineAllJob>();

interface BoundaryJob {
  status: ScanJobStatus;
  stage?: string;
  transitionIndex: number;
  /** The re-scanned UI transition (real type + evidence), spliced in by the store. */
  transition?: Transition;
  warnings?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const boundaryJobs = new Map<string, BoundaryJob>();

interface HyperframesJob {
  status: ScanJobStatus;
  stage?: string;
  /** Slot id (for slot fills) or transition id (for transition fills). */
  targetId: string;
  /** Absolute preview URL of the rendered beat/transition MP4 (when done). */
  previewUrl?: string;
  source?: 'llm' | 'mock';
  warnings?: string[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}
const hyperframesJobs = new Map<string, HyperframesJob>();

function sweepScanJobs(): void {
  const now = Date.now();
  for (const [id, job] of scanJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) scanJobs.delete(id);
  }
  for (const [id, job] of fineJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) fineJobs.delete(id);
  }
  for (const [id, job] of fineAllJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) fineAllJobs.delete(id);
  }
  for (const [id, job] of boundaryJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) boundaryJobs.delete(id);
  }
  for (const [id, job] of hyperframesJobs) {
    if (job.finishedAt && now - job.finishedAt > 30 * 60_000) hyperframesJobs.delete(id);
  }
  // Evict retained scan inputs after 60 min (free disk: raw video + work dir).
  // LIBRARY-OWNED entries (keepFiles) are evicted from the Map but their files are
  // NEVER deleted — those source.<ext>/rough.json live under getStructLibraryDir().
  for (const [id, art] of scanArtifacts) {
    if (now - art.createdAt > 60 * 60_000) {
      scanArtifacts.delete(id);
      if (art.keepFiles) continue;
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
      // runRoughScan probes duration itself (ffprobe) — no full analyzeVideoFile pre-pass.
      const { graph, warnings, roughScanPath, workDir } = await runRoughScan(filePath, videoId, setStage);
      const defaultedFields: string[] = [];
      const sourceVideo = graphToSourceVideo(graph, { videoId, title, defaultedFields });
      // Retain the raw video + rough output so a follow-up fine scan can reuse them.
      scanArtifacts.set(videoId, { videoPath: filePath, roughScanPath, workDir, createdAt: Date.now() });
      // Persist the scan result (sourceVideo + structure graph) so the case-video
      // structure survives restart and is queryable via /api/struct/db/scans.
      const persistWarnings: string[] = [];
      try {
        await saveScan({ videoId, title, sourceVideo, source: 'rough_scan', structureGraph: graph, videoPath: filePath, roughScanPath });
      } catch (e) {
        persistWarnings.push(`扫描结果入库失败：${errorMessage(e)}`);
      }
      scanJobs.set(jobId, {
        status: 'done',
        sourceVideo,
        warnings: [
          ...warnings,
          ...persistWarnings,
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

/* ─── POST /api/struct/scan/:videoId/fine-all — fine-scan ALL segments in ONE process ──
   fine_scan.py parallelizes across blocks (block_workers) + within a block (candidate_workers) behind a
   shared HTTP semaphore, so one batch process is far faster than clicking each segment (serial single-block
   processes) and uses ~one process worth of memory. Async; poll GET /scan/fine-all/:jobId. */
structRouter.post('/scan/:videoId/fine-all', async (req, res) => {
  const { videoId } = req.params;
  const artifacts = scanArtifacts.get(videoId);
  if (!artifacts) {
    res.status(404).json({ error: '找不到该视频的扫描数据（可能已过期，请重新上传并粗扫描）。' });
    return;
  }
  let blockIds: string[];
  try {
    const rough = JSON.parse(await readFile(artifacts.roughScanPath, 'utf-8')) as { contentBlocks?: Array<{ id?: string }> };
    blockIds = (rough.contentBlocks ?? []).map((b) => b.id).filter((id): id is string => Boolean(id));
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
    return;
  }
  if (blockIds.length === 0) {
    res.status(400).json({ error: '该视频没有可精扫描的段落。' });
    return;
  }

  sweepScanJobs();
  const jobId = randomUUID();
  fineAllJobs.set(jobId, { status: 'running', stage: '排队中', total: blockIds.length, startedAt: Date.now() });
  res.status(202).json({ jobId, total: blockIds.length });

  void (async () => {
    const setStage = (stage: string) => {
      const j = fineAllJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    const startedAt = fineAllJobs.get(jobId)?.startedAt ?? Date.now();
    try {
      const { details, warnings } = await runFineScanBatch(
        artifacts.videoPath,
        artifacts.roughScanPath,
        videoId,
        blockIds,
        artifacts.workDir,
        setStage,
      );
      fineAllJobs.set(jobId, { status: 'done', total: blockIds.length, details, warnings, startedAt, finishedAt: Date.now() });
    } catch (error) {
      fineAllJobs.set(jobId, { status: 'error', total: blockIds.length, error: errorMessage(error), startedAt, finishedAt: Date.now() });
    }
  })();
});

structRouter.get('/scan/fine-all/:jobId', (req, res) => {
  const job = fineAllJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'fine-all scan job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    total: job.total,
    details: job.details,
    warnings: job.warnings,
    error: job.error,
    elapsedSec,
  });
});

/* ─── POST /api/struct/scan/:videoId/boundary — boundary-scan ONE transition seam ──
   The web rough scan does NOT run boundary_scan.py, so graph.boundaries is absent and
   the UI synthesizes all-硬切 seams. This re-scans ONE seam on demand to recover its
   real transition type (叠化/推镜/…). Reuses the rough scan's retained raw video + rough
   output. Async (microscope clip + VLM, ~30–60s). Body: { transitionIndex, transition }.
   Poll GET /scan/boundary/:jobId. The UI transition at index i maps to rough boundary
   `boundary_{i+1:03d}` (the seam between block i and i+1 — same indexing as the offline
   _build_boundaries in extract_structure_graph.py). */

/** UI transition index i → rough scan boundary id (1-based, zero-padded to 3). */
function boundaryIdForIndex(index: number): string {
  return `boundary_${String(index + 1).padStart(3, '0')}`;
}

structRouter.post('/scan/:videoId/boundary', async (req, res) => {
  const { videoId } = req.params;
  const artifacts = scanArtifacts.get(videoId);
  if (!artifacts) {
    res.status(404).json({ error: '找不到该视频的扫描数据（可能已过期，请重新上传并粗扫描）。' });
    return;
  }
  const body = (req.body ?? {}) as { transitionIndex?: unknown; transition?: Partial<Transition> };
  const transitionIndex = Number(body.transitionIndex);
  if (!Number.isInteger(transitionIndex) || transitionIndex < 0) {
    res.status(400).json({ error: 'transitionIndex（转场序号）缺失或无效。' });
    return;
  }
  const tr = body.transition;
  if (!tr || typeof tr.id !== 'string' || typeof tr.from !== 'string' || typeof tr.to !== 'string') {
    res.status(400).json({ error: 'transition（待扫描的转场对象）缺失或无效。' });
    return;
  }

  const boundaryId = boundaryIdForIndex(transitionIndex);
  try {
    const rough = JSON.parse(await readFile(artifacts.roughScanPath, 'utf-8')) as {
      boundaryCandidates?: Array<{ id?: string }>;
    };
    const exists = (rough.boundaryCandidates ?? []).some((b) => b?.id === boundaryId);
    if (!exists) {
      res.status(400).json({ error: `该转场（${boundaryId}）在粗扫描中无对应边界候选，无法精扫描。` });
      return;
    }
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
    return;
  }

  sweepScanJobs();
  const jobId = randomUUID();
  boundaryJobs.set(jobId, { status: 'running', stage: '排队中', transitionIndex, startedAt: Date.now() });
  res.status(202).json({ jobId });

  const from = tr.from;
  const to = tr.to;
  const at = typeof tr.at === 'number' ? tr.at : 0;
  const id = tr.id;

  void (async () => {
    const setStage = (stage: string) => {
      const j = boundaryJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    const startedAt = boundaryJobs.get(jobId)?.startedAt ?? Date.now();
    try {
      const { candidate } = await runBoundaryScan(artifacts.videoPath, artifacts.roughScanPath, boundaryId, artifacts.workDir, setStage);
      // No transition unit detected → an honest content hard-cut (硬切 is its ceiling).
      // Otherwise classify techniqueTags → shared type → UI type (beats skipped → no 卡点).
      const uiType = candidate.exists
        ? boundaryTypeToUi(techniqueTagsToBoundaryType(candidate.techniqueTags))
        : '硬切';
      const transition = boundaryToUiTransition({ id, from, to, at, type: uiType, evidence: candidate.visualChange, scanned: true });

      const warnings: string[] = [];
      if (!candidate.exists) {
        warnings.push('Boundary Scan：此处为内容硬切，无独立转场单元（硬切是其天花板）');
      } else {
        const conf = typeof candidate.confidence === 'number' ? ` · 置信度 ${Math.round(candidate.confidence * 100)}%` : '';
        warnings.push(`Boundary Scan：识别为「${uiType}」${conf}${candidate.visualChange ? ` · ${candidate.visualChange}` : ''}`);
      }
      boundaryJobs.set(jobId, { status: 'done', transitionIndex, transition, warnings, startedAt, finishedAt: Date.now() });
    } catch (error) {
      boundaryJobs.set(jobId, { status: 'error', transitionIndex, error: errorMessage(error), startedAt, finishedAt: Date.now() });
    }
  })();
});

structRouter.get('/scan/boundary/:jobId', (req, res) => {
  const job = boundaryJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'boundary scan job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    transitionIndex: job.transitionIndex,
    transition: job.transition,
    warnings: job.warnings,
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
    const uploadWarnings: string[] = [];
    const contentBrief = parseContentBriefPayload(req.body?.contentBrief, uploadWarnings);
    const rawProductDescription =
      typeof req.body?.rawProductDescription === 'string' && req.body.rawProductDescription.trim()
        ? req.body.rawProductDescription.trim()
        : undefined;
    const textBrief =
      rawProductDescription ??
      (contentBrief
        ? [
            contentBrief.productName,
            contentBrief.category,
            contentBrief.targetAudience,
            contentBrief.scenario,
            ...(contentBrief.sellingPoints ?? []),
            contentBrief.cta,
            contentBrief.stylePreference,
          ].filter(Boolean).join(' · ')
        : product
          ? [product.description, product.name, product.category, product.industry, ...(product.sellingPoints ?? []), product.cta, product.price]
              .filter(Boolean)
              .join(' · ')
          : undefined);

    const result = await analyzeAssetsWithFallbackResult({ files, textBrief });
    const materials = assetCardsToMaterials(result.assetCards);
    const warnings = [...uploadWarnings, ...(result.warnings ?? [])];

    // T4: persist each uploaded file into a STABLE per-session dir so its url
    // survives to /produce (multer's temp dest could be reused/cleaned). Rewrite
    // each Material.url that points at an uploaded temp path to the stable copy.
    const pathRewrites = new Map<string, string>();
    if (files.length) {
      sweepAssetSessionDirs();
      const sessionDir = getAssetSessionDir(randomUUID());
      mkdirSync(sessionDir, { recursive: true });
      // Track this dir so it can be swept ~2h later (free disk: stable asset copies).
      assetSessionDirs.set(sessionDir, { dir: sessionDir, createdAt: Date.now() });
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

/* ─── POST /api/struct/materials/reshoot — 补拍视频入素材库 + 解析 ───────────────
   A reshoot/补拍 clip is analyzed into AssetCard(s) and APPENDED into a named asset
   library (renumbered ids, stable urls). The clip now lives in the library, so a
   re-load (loadAssetLibrary / GET /db/libraries/:id) re-reads the re-analyzed set.
   Body (multipart): assets[] (files), libraryId (target), textBrief? */
structRouter.post('/materials/reshoot', withUploadGuard(upload.array('assets')), async (req, res) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    const libraryId = String(req.body?.libraryId ?? '').trim();
    if (!libraryId) {
      res.status(400).json({ error: 'libraryId（目标素材库）必填' });
      return;
    }
    if (!files.length) {
      res.status(400).json({ error: '请上传至少一个补拍素材' });
      return;
    }
    const textBrief = typeof req.body?.textBrief === 'string' ? req.body.textBrief : undefined;

    // Analyze the reshoot clips into AssetCards (deterministic local analysis first).
    const result = await analyzeAssetsWithFallbackResult({ files, textBrief });
    const warnings = [...(result.warnings ?? [])];

    // Stabilize each uploaded file so the card url survives (mirror /materials/upload).
    const pathRewrites = new Map<string, string>();
    sweepAssetSessionDirs();
    const sessionDir = getAssetSessionDir(randomUUID());
    mkdirSync(sessionDir, { recursive: true });
    assetSessionDirs.set(sessionDir, { dir: sessionDir, createdAt: Date.now() });
    for (const file of files) {
      const ext = path.extname(file.originalname) || path.extname(file.path);
      const stablePath = path.join(sessionDir, `${path.basename(file.path)}${ext}`);
      try {
        await copyFile(file.path, stablePath);
        pathRewrites.set(file.path, stablePath);
        void unlink(file.path).catch(() => {});
      } catch (copyError) {
        warnings.push(`补拍素材落盘失败（${file.originalname}）：${errorMessage(copyError)}`);
      }
    }
    const stabilizedCards = result.assetCards.map((c) =>
      c.url && pathRewrites.has(c.url) ? { ...c, url: pathRewrites.get(c.url)! } : c,
    );

    // Append (renumbered) into the library + persist.
    const updated = await appendLibraryCards(libraryId, stabilizedCards);
    res.json({
      libraryId,
      added: stabilizedCards.length,
      cardCount: updated.length,
      materials: assetCardsToMaterials(updated),
      warnings: [...warnings, `已将 ${stabilizedCards.length} 个补拍素材并入素材库 ${libraryId}（共 ${updated.length} 个）`],
    });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── GET /api/struct/db/* — read the file-backed pipeline DB ─────────────────── */
structRouter.get('/db/scans', async (_req, res) => {
  try {
    res.json({ scans: await listScans() });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});
structRouter.get('/db/scans/:id', async (req, res) => {
  try {
    const scan = await getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: 'scan not found' });
      return;
    }
    res.json({ scan });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});
structRouter.get('/db/libraries', async (_req, res) => {
  try {
    res.json({ libraries: await listLibraries() });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});
structRouter.get('/db/libraries/:id', async (req, res) => {
  try {
    const cards = await readLibraryCards(req.params.id);
    res.json({ libraryId: req.params.id, cardCount: cards.length, materials: assetCardsToMaterials(cards) });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});
structRouter.get('/db/matches/:projectId', async (req, res) => {
  try {
    const matchSet = await getMatchSet(req.params.projectId);
    if (!matchSet) {
      res.status(404).json({ error: 'match set not found' });
      return;
    }
    res.json({ matchSet });
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

    const warnings: string[] = [];
    const { product } = resolveProductAndBrief(req.body ?? {}, sourceVideo, incoming, warnings);
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

    if (matchResult.warning) warnings.push(matchResult.warning);
    if (matchResult.alignmentSource === 'rule_based') warnings.push('槽位对齐使用规则降级（非 LLM judge）');
    res.json({ materials, warnings });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/** Best-effort: drop a complete diagnose bundle into pipeline_data/04_diagnoses/<projectId>.json so the
 *  teammate's sample-data demo can consume real link output. Never throws (a capture failure must not break
 *  the diagnose response); see pipeline_data/README.md. */
async function capturePipelineDiagnosis(snapshot: {
  projectId: string;
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  diagnosis: Record<string, Diagnosis>;
  warnings: string[];
}): Promise<void> {
  try {
    const dir = path.join(getPipelineDataDir(), '04_diagnoses');
    await mkdir(dir, { recursive: true });
    const safe = (snapshot.projectId || 'project').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'project';
    const file = path.join(dir, `${safe}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ capturedAt: new Date().toISOString(), ...snapshot }, null, 2), 'utf-8');
    await rename(tmp, file);
  } catch {
    /* capture is best-effort */
  }
}

/* ─── POST /api/struct/diagnose — four-state diagnosis per slot ─── */
structRouter.post('/diagnose', async (req, res) => {
  try {
    const rawSourceVideo = req.body?.sourceVideo as SourceVideo;
    const materials = (req.body?.materials ?? []) as Material[];
    const segmentDetails = req.body?.segmentDetails as Record<string, FineBlockDetail> | undefined;
    if (!rawSourceVideo?.segments) {
      res.status(400).json({ error: 'sourceVideo with segments is required' });
      return;
    }

    const warnings: string[] = [];
    // Trunk (#79): product + brief + product intelligence threaded from /product/parse (parse-once;
    // consistent with upload/match/compile/produce, no repeated LLM parse in the diagnose hot path).
    const { product, contentBrief, productIntelligence } = resolveProductAndBrief(
      req.body ?? {},
      rawSourceVideo,
      materials,
      warnings,
    );

    // Grafted from main: fold the FINE-SCAN detail (transferableMotifs / exploded_assembly / revealMode) into
    // the source so the matcher + director see the abstract structure — each fine-scanned segment's shot text
    // is enriched and assembly/cascade beats get a kinetic motif (→ 由散到聚 prompts). No-op without a fine scan.
    const { sourceVideo, motifBySegmentId, motionTokensBySegmentId, enrichedSegmentCount } =
      enrichSourceVideoWithFineScan(rawSourceVideo, segmentDetails, product.category);
    if (enrichedSegmentCount > 0) warnings.push(`已用精扫描结果增强 ${enrichedSegmentCount} 个镜头的迁移结构`);

    const graph = buildStructureGraph(sourceVideo);
    const assetCards = materialsToAssetCards(materials, sourceVideo, product);

    const matchResult = await matchSlotsWithFallback({ graph, assets: assetCards, boundaries: graph.boundaries });


    // Real per-gap 3-option resolution (T1): for each slot derive its tier
    // (matched/partial/gap) and ask the Director Agent for the full
    // reshoot + HyperFrames + AIGC menu (with a recommendation). A throw from one
    // slot's option builder must NOT 500 the whole diagnosis — fall back to the base
    // synthesized fill (toDiagnosisRecord handles an absent slotResolutions).
    let slotResolutions: Record<string, SlotGapResolution> | undefined;
    try {
      slotResolutions = await buildSlotResolutions({
        graph,
        matches: matchResult.matches,
        assetCards,
        contentBrief,
        productIntelligence,
        motifBySegmentId,
        motionTokensBySegmentId,
        warnings,
      });
    } catch (resolutionError) {
      slotResolutions = undefined;
      warnings.push(`3-option 方案生成失败，已回退到基础诊断：${errorMessage(resolutionError)}`);
    }

    const diagnosis = toDiagnosisRecord({
      sourceVideo,
      matches: matchResult.matches,
      gaps: matchResult.gaps,
      repairs: [],
      materials,
      slotResolutions,
    });

    if (matchResult.warning) warnings.push(matchResult.warning);
    if (matchResult.alignmentSource === 'rule_based') warnings.push('槽位对齐使用规则降级（非 LLM judge）');

    // Persist the slot↔asset matching for this project (素材匹配字段 store; idempotent upsert).
    try {
      await saveMatchSet({
        projectId: sourceVideo.id,
        matches: matchResult.matches.map((m) => ({
          slotId: m.slotId,
          assetId: m.assetId ?? null,
          quality: m.quality ?? m.score,
          fillStatus: m.status,
        })),
      });
    } catch (e) {
      warnings.push(`匹配结果入库失败：${errorMessage(e)}`);
    }

    // Capture the full diagnose bundle for the teammate's sample-data demo (best-effort, non-blocking).
    void capturePipelineDiagnosis({ projectId: sourceVideo.id, sourceVideo, materials, product, diagnosis, warnings });

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

    const payloadWarnings: string[] = [];
    const { product, contentBrief, productIntelligence } = resolveProductAndBrief(req.body ?? {}, sourceVideo, materials, payloadWarnings);
    const graph = buildStructureGraph(sourceVideo);
    const assetCards = materialsToAssetCards(materials, sourceVideo, product);

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
        ...(productIntelligence ? { structuralCompression: { productIntelligence } } : {}),
        // The UI-synthesized graph (buildStructureGraph) carries no borrowed-source identity
        // — productInSource is a placeholder — so there is nothing to ban. Pass [] to skip the
        // mandatory-LLM source-identity banlist (which would otherwise return empty and throw),
        // mirroring /diagnose's buildSlotResolutions.
        sourceBannedTerms: [],
      },
    });
    const authored = orchestratedToAuthored(orchestrated, { assetCards });
    const timelineItems = authoredTimelineToTimelineItems(authored);

    const timeline = timelineItemsToSegs(timelineItems, { sourceVideo, diagnosis });
    const version = versionFromId(versionId);
    const warnings = [...new Set([...payloadWarnings, ...orchestrated.warnings])];

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
  // Piggyback the uploaded-asset-dir cleanup on the produce sweep cadence.
  sweepAssetSessionDirs();
  const now = Date.now();
  for (const [id, job] of produceJobs) {
    if (job.finishedAt && now - job.finishedAt > 60 * 60_000) {
      produceJobs.delete(id);
      // Also delete this job's render artifacts so finished produce files/beat dirs
      // don't leak on disk after the in-memory job is evicted.
      const renderDir = getRenderDir();
      void rm(path.join(renderDir, `produce_${id}.mp4`), { force: true }).catch(() => {});
      void rm(path.join(renderDir, `produce_${id}_beats`), { recursive: true, force: true }).catch(() => {});
    }
  }
}

structRouter.post('/produce', (req, res) => {
  const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
  if (!sourceVideo?.segments?.length) {
    res.status(400).json({ error: 'sourceVideo with segments is required' });
    return;
  }
  const materials = (req.body?.materials ?? []) as Material[];
  const payloadWarnings: string[] = [];
  const { product, contentBrief, productIntelligence } = resolveProductAndBrief(req.body ?? {}, sourceVideo, materials, payloadWarnings);
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

      const warnings: string[] = [...payloadWarnings];
      // (b) rebuild graph/assetCards/contentBrief, then run the Director Agent →
      // OrchestratedTimeline (the asset-bearing plan, NOT the UI-stripped segs).
      setStage('准备结构与素材');
      const graph = buildStructureGraph(sourceVideo);
      const assetCards = materialsToAssetCards(materials, sourceVideo, product);
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
          ...(productIntelligence ? { structuralCompression: { productIntelligence } } : {}),
          // Synthesized UI graph carries no borrowed-source identity → skip the mandatory-LLM
          // banlist (empty result would throw). See /compile for the full rationale.
          sourceBannedTerms: [],
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

/* ─── POST /api/struct/hyperframes/slot — render ONE slot with the HyperFrames Agent ──
   The user picked 「HyperFrames 补全」 for this slot in the gap-fill studio. The Director
   authors the per-slot brief and the (narrowed) HyperFrames engine renders JUST this beat
   into a real MP4 for preview — no whole-ad authoring, no new pixels (real assets only).
   Async (author→lint→render→critic, ~30–120s). Poll GET /hyperframes/:jobId.
   Body: { sourceVideo, materials, product, slotId, productImageUrl? }. */
structRouter.post('/hyperframes/slot', (req, res) => {
  const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
  if (!sourceVideo?.segments?.length) {
    res.status(400).json({ error: 'sourceVideo with segments is required' });
    return;
  }
  const slotId = typeof req.body?.slotId === 'string' ? req.body.slotId : '';
  if (!slotId) {
    res.status(400).json({ error: 'slotId（待补全的槽位）缺失' });
    return;
  }
  const materials = (req.body?.materials ?? []) as Material[];
  const product = (req.body?.product as TargetProduct) ?? stubProduct(sourceVideo, materials);
  const productImageUrl =
    typeof req.body?.productImageUrl === 'string' && req.body.productImageUrl ? req.body.productImageUrl : undefined;

  sweepScanJobs();
  const jobId = randomUUID();
  hyperframesJobs.set(jobId, { status: 'running', stage: '排队中', targetId: slotId, startedAt: Date.now() });
  // Capture the absolute media base BEFORE going async (req is request-scoped).
  const mediaBase = `${req.protocol}://${req.get('host')}`;
  res.status(202).json({ jobId });

  void (async () => {
    const startedAt = hyperframesJobs.get(jobId)?.startedAt ?? Date.now();
    const setStage = (stage: string) => {
      const j = hyperframesJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    try {
      const result = await renderHyperframesForSlot({ sourceVideo, materials, product, slotId, productImageUrl, onStage: setStage });
      if (!result.rendered || !result.mediaUrl) {
        hyperframesJobs.set(jobId, {
          status: 'error',
          targetId: slotId,
          error: result.warnings[0] ?? 'HyperFrames 渲染失败（未产出 MP4）',
          warnings: result.warnings,
          startedAt,
          finishedAt: Date.now(),
        });
        return;
      }
      hyperframesJobs.set(jobId, {
        status: 'done',
        targetId: slotId,
        previewUrl: `${mediaBase}${result.mediaUrl}`,
        source: result.source,
        warnings: result.warnings,
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (error) {
      hyperframesJobs.set(jobId, { status: 'error', targetId: slotId, error: errorMessage(error), startedAt, finishedAt: Date.now() });
    }
  })();
});

/** Resolve a Material.url (absolute uploaded disk path, or /media/demo-assets web path)
 *  to an on-disk file ffmpeg can read. Returns null when it can't be located. */
function resolveMaterialDiskPath(url: string): string | null {
  if (existsSync(url)) return url;
  const [rewritten] = rewriteAssetCardUrlsToDisk([{ url }]);
  if (rewritten?.url && existsSync(rewritten.url)) return rewritten.url;
  return null;
}

/* ─── POST /api/struct/hyperframes/transition — composite ONE seam's transition ──
   Non-generative HyperFrames transition: take the two adjacent slots' REAL assigned
   assets and ffmpeg-xfade them with the seam's real type (from Boundary Scan) + a
   content-aware duration → a real "首尾帧形变转场" preview MP4 (no new pixels).
   Async. Poll GET /hyperframes/:jobId. Body: { sourceVideo, materials, transitionIndex }. */
structRouter.post('/hyperframes/transition', (req, res) => {
  const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
  if (!sourceVideo?.transitions?.length) {
    res.status(400).json({ error: 'sourceVideo with transitions is required' });
    return;
  }
  const transitionIndex = Number(req.body?.transitionIndex);
  if (!Number.isInteger(transitionIndex) || transitionIndex < 0 || transitionIndex >= sourceVideo.transitions.length) {
    res.status(400).json({ error: 'transitionIndex（转场序号）缺失或越界' });
    return;
  }
  const tr = sourceVideo.transitions[transitionIndex];
  const materials = (req.body?.materials ?? []) as Material[];
  const fromMat = materials.find((m) => m.slot === tr.from);
  const toMat = materials.find((m) => m.slot === tr.to);
  if (!fromMat?.url || !toMat?.url) {
    const missing = !fromMat?.url ? tr.from : tr.to;
    res.status(400).json({ error: `需要先在「素材」给槽位 ${String(missing).toUpperCase()} 分配一个素材，才能合成这条转场` });
    return;
  }
  const fromPath = resolveMaterialDiskPath(fromMat.url);
  const toPath = resolveMaterialDiskPath(toMat.url);
  if (!fromPath || !toPath) {
    res.status(400).json({ error: '相邻槽位素材无法定位到磁盘文件（可能已过期，请重新上传素材）' });
    return;
  }

  sweepScanJobs();
  const jobId = randomUUID();
  hyperframesJobs.set(jobId, { status: 'running', stage: '排队中', targetId: tr.id, startedAt: Date.now() });
  const mediaBase = `${req.protocol}://${req.get('host')}`;
  res.status(202).json({ jobId });

  void (async () => {
    const startedAt = hyperframesJobs.get(jobId)?.startedAt ?? Date.now();
    const setStage = (stage: string) => {
      const j = hyperframesJobs.get(jobId);
      if (j && j.status === 'running') j.stage = stage;
    };
    try {
      const durationMs = transitionDurationMs(tr.type, sourceVideo.rhythm?.avg_shot);
      const result = await renderTransitionPreview({
        fromPath,
        toPath,
        uiType: tr.type,
        durationMs,
        outDir: getRenderDir(),
        onStage: setStage,
      });
      if (!result.rendered || !result.mediaUrl) {
        hyperframesJobs.set(jobId, {
          status: 'error',
          targetId: tr.id,
          error: result.warnings[0] ?? '转场合成失败',
          warnings: result.warnings,
          startedAt,
          finishedAt: Date.now(),
        });
        return;
      }
      hyperframesJobs.set(jobId, {
        status: 'done',
        targetId: tr.id,
        previewUrl: `${mediaBase}${result.mediaUrl}`,
        source: 'mock',
        warnings: [
          `转场「${tr.type}」· xfade ${result.transition} · ${result.durationSec.toFixed(2)}s · 真实素材`,
          ...result.warnings,
        ],
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (error) {
      hyperframesJobs.set(jobId, { status: 'error', targetId: tr.id, error: errorMessage(error), startedAt, finishedAt: Date.now() });
    }
  })();
});

structRouter.get('/hyperframes/:jobId', (req, res) => {
  const job = hyperframesJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'hyperframes job not found（任务可能已过期）' });
    return;
  }
  const elapsedSec = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  res.json({
    status: job.status,
    stage: job.stage,
    targetId: job.targetId,
    previewUrl: job.previewUrl,
    source: job.source,
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
async function buildSlotResolutions(input: {
  graph: ReturnType<typeof buildStructureGraph>;
  matches: SlotMatch[];
  assetCards: ReturnType<typeof materialsToAssetCards>;
  contentBrief: ContentBrief;
  productIntelligence?: ProductIntelligence;
  /** Per-segment kinetic motif + motion tokens derived from the fine scan (assembly/cascade beats). */
  motifBySegmentId?: Map<string, ViralMotifAnnotation>;
  motionTokensBySegmentId?: Map<string, MotionToken[]>;
  /** Collects non-fatal warnings (e.g. a degraded source-leak banlist) for the caller to surface. */
  warnings?: string[];
}): Promise<Record<string, SlotGapResolution>> {
  const { graph, matches, assetCards, contentBrief, productIntelligence, motifBySegmentId, motionTokensBySegmentId } =
    input;
  // #76: the 3-option briefs are driven by an LLM-translated category-equivalent
  // vocabulary (no deterministic fallback). Build it ONCE; if the LLM is unavailable
  // this throws and the /diagnose caller falls back to the base 4-state diagnosis.
  // productIntelligence (when present) grounds the vocab in the product's real benefits/
  // sensory cues/usage rituals so the per-slot actions are specific, not category-generic.
  const vocab = await translateCategoryEquivalents({ contentBrief, productIntelligence, assetCards });

  // Source-leak guardrail: derive the SCANNED source video's identity terms (e.g. macbook/laptop/键盘, or a
  // beverage source's 冰块/柠檬) ONCE from the structure graph so the per-slot prompts strip them — the same
  // banlist the orchestrated director uses. Best-effort: the synthesized UI graph can carry thin source
  // evidence (the derivation throws on an empty banlist); on failure we degrade to [] and warn rather than
  // 500 the diagnosis. This replaces the previously hardcoded `sourceBannedTerms: []` that left the leak
  // sanitizers inert (see containsSourceSpecificTerm / safePromptText in gapResolutionOptionsBuilder).
  let sourceBannedTerms: readonly string[] = [];
  try {
    sourceBannedTerms = (await deriveSourceIdentityBanlist({ structureGraph: graph })).terms;
  } catch (e) {
    input.warnings?.push(`源身份禁忌词派生失败，已降级为不过滤（可能残留源词）：${errorMessage(e)}`);
  }

  const matchBySlot = new Map(matches.map((m) => [m.slotId, m]));
  const referenceAssetIds = assetCards.map((c) => c.id);
  const out: Record<string, SlotGapResolution> = {};

  for (const slot of graph.shotSlots) {
    const match = matchBySlot.get(slot.id);
    const tier: 'matched' | 'partial' | 'gap' =
      match?.status === 'matched' ? 'matched' : match?.status === 'partial' ? 'partial' : 'gap';
    // Fine-scan-derived abstract structure for THIS beat (assembly/cascade → kinetic branch + motion tokens).
    const segmentId = slot.segmentId ?? slot.id;
    const motif = motifBySegmentId?.get(segmentId);
    const motionTokens = motionTokensBySegmentId?.get(segmentId);
    const { options, recommendedOptionId } = buildGapResolutionOptions({
      slot,
      tier,
      contentBrief,
      referenceAssetIds,
      chosenAssetId: tier === 'gap' ? undefined : match?.assetId,
      vocab,
      ...(motif ? { motif } : {}),
      ...(motionTokens && motionTokens.length ? { motionTokens } : {}),
      // Secondary source-leak guard: the scanned source's identity terms (derived once above) so each slot's
      // sanitizers actually strip them. The vocab translator forbids cross-CATEGORY terms, but it cannot catch
      // a specific source video's residue (e.g. a stale 由散汇聚 motif) — this banlist does.
      sourceBannedTerms,
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
        // Synthesized UI graph carries no borrowed-source identity → skip the mandatory-LLM
        // banlist (empty result would throw). See /compile for the full rationale.
        sourceBannedTerms: [],
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

/* ============================================================
   STRUCT LIBRARY ROUTES — persist a scanned SourceVideo structure into the
   real "结构样例库" (a JSON-file-backed store under getStructLibraryDir(), which
   persists across server restarts) so it can be reopened later.
   ============================================================ */

/* ─── POST /api/struct/structures — save a scanned structure into the library ─── */
structRouter.post('/structures', async (req, res) => {
  try {
    const sourceVideo = req.body?.sourceVideo as SourceVideo | undefined;
    if (!sourceVideo?.segments?.length) {
      res.status(400).json({ error: 'sourceVideo with a non-empty segments array is required' });
      return;
    }
    const segmentDetails = req.body?.segmentDetails as Record<string, FineBlockDetail> | undefined;
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;

    // Persist the ORIGINAL source video + rough.json alongside the structure when the
    // scan's retained inputs are still available — this lets a reopened structure run
    // 精扫描 again. If they've already expired, the structure still saves (without the
    // video) and the response carries an honest warning.
    const artifacts = scanArtifacts.get(sourceVideo.id);

    try {
      const summary = await saveStructure({
        sourceVideo,
        segmentDetails,
        title,
        sourceVideoPath: artifacts?.videoPath,
        roughScanPath: artifacts?.roughScanPath,
      });
      if (summary.hasVideo) {
        res.status(201).json(summary);
      } else {
        res.status(201).json({
          ...summary,
          warning: '原视频已不可用，未随结构持久化；载入后将无法重新精扫描',
        });
      }
    } catch (validationError) {
      // saveStructure throws on invalid input (e.g. no segments) → honest 400.
      res.status(400).json({ error: errorMessage(validationError) });
    }
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── GET /api/struct/structures — list saved structures (summaries) ─── */
structRouter.get('/structures', async (_req, res) => {
  try {
    const structures = await listStructures();
    res.json({ structures });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── GET /api/struct/structures/:id — load one full saved structure ─── */
structRouter.get('/structures/:id', async (req, res) => {
  try {
    const structure = await getStructure(req.params.id);
    if (!structure) {
      res.status(404).json({ error: '结构样例不存在（可能已被删除）。' });
      return;
    }

    // Re-register the persisted source video + rough.json into the in-memory scan-
    // artifacts map (keyed by the structure's sourceVideo.id) so a reopened structure
    // can run 精扫描 on any segment again. The fine-scan workDir is a FRESH writable tmp
    // dir under getScanDataDir() (sweepable) — NOT the library subdir — and keepFiles
    // protects the library-owned source.<ext>/rough.json from the TTL sweep's unlink.
    if (structure.hasVideo) {
      const artifacts = await getStructureArtifacts(req.params.id);
      if (artifacts) {
        const workDir = path.join(getScanDataDir(), structure.sourceVideo.id);
        mkdirSync(workDir, { recursive: true });
        scanArtifacts.set(structure.sourceVideo.id, {
          videoPath: artifacts.videoPath,
          roughScanPath: artifacts.roughScanPath,
          workDir,
          createdAt: Date.now(),
          keepFiles: true,
        });
      }
    }

    res.json(structure);
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

/* ─── DELETE /api/struct/structures/:id — remove a saved structure ─── */
structRouter.delete('/structures/:id', async (req, res) => {
  try {
    const ok = await deleteStructure(req.params.id);
    if (!ok) {
      res.status(404).json({ ok: false, error: '结构样例不存在（无法删除）。' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
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
    // A throw from one slot's option builder must NOT 500 the whole demo — fall back
    // to the base synthesized fill (toDiagnosisRecord handles an absent slotResolutions).
    let slotResolutions: Record<string, SlotGapResolution> | undefined;
    try {
      slotResolutions = await buildSlotResolutions({
        graph,
        matches: matchResult.matches,
        assetCards: cards,
        contentBrief,
        warnings,
      });
    } catch (resolutionError) {
      slotResolutions = undefined;
      warnings.push(`3-option 方案生成失败，已回退到基础诊断：${errorMessage(resolutionError)}`);
    }
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
        // Synthesized UI graph carries no borrowed-source identity → skip the mandatory-LLM
        // banlist (empty result would throw). See /compile for the full rationale.
        sourceBannedTerms: [],
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
