'use client';

// useProjectStore.ts — single source of truth across Screens 01–04.
//
// FAIL-FAST: each async action calls the dedicated `/api/struct/*` endpoint and,
// if that throws (backend down / route unimplemented / non-2xx), records a rich
// `lastError` (which call + endpoint + HTTP status + body) and RE-THROWS. It does
// NOT silently swap in mock fixtures or report success — so a real failure is
// always visible (red ERROR badge + error banner) and never masked as "live"
// data. `mode` reflects the source of the data currently shown ('mock' initially,
// 'live' after a successful call); a failed call leaves the prior data untouched.

import { create } from 'zustand';
import type {
  AssetSupplyContext,
  ContentBrief,
  DemoEstimate,
  MissingMaterialGenerationJob,
  ProductIntelligence,
  QualityReport,
  SafetyStatus,
  StoryboardFrame,
} from '@viral-struct/shared';
import { analyzeStructAssetManagerCoverage } from '../api/assetManager';
import {
  compile as compileApi,
  exportVideo as exportApi,
  getProduceStatus as getProduceStatusApi,
  nlEdit as nlEditApi,
  startProduce as startProduceApi,
} from '../api/compile';
import { applyStrategy as applyStrategyApi, diagnose as diagnoseApi } from '../api/diagnose';
import { matchMaterials as matchMaterialsApi, uploadMaterials as uploadMaterialsApi } from '../api/materials';
import { parseProduct as parseProductApi } from '../api/product';
import { analyzeSample as analyzeSampleApi } from '../api/sample';
import {
  getBoundaryScanStatus,
  getFineScanStatus,
  getScanStatus,
  startBoundaryScan,
  startFineScan,
  startScan,
  type FineBlockDetail,
} from '../api/scan';
import { getHyperframesStatus, startHyperframesSlot, startHyperframesTransition } from '../api/hyperframes';
import {
  deleteStructure as deleteStructureApi,
  getStructure as getStructureApi,
  listStructures as listStructuresApi,
  saveStructure as saveStructureApi,
  type SavedStructureSummary,
} from '../api/library';
import {
  type InsightRequest,
  checkSafety as checkSafetyApi,
  estimatePerformance as estimatePerformanceApi,
  evaluateQuality as evaluateQualityApi,
  loadLibraryMaterials as loadLibraryMaterialsApi,
  planMaterialJobs as planMaterialJobsApi,
  planStoryboard as planStoryboardApi,
  runDemo as runDemoApi,
} from '../api/insights';
import type { ExportResult, TimelineSeg } from '../api/types';
import {
  COMPILE_VERSIONS,
  type CompileVersion,
  type Diagnosis,
  type Material,
  type ResolutionMethod,
  type RoleKey,
  type SourceVideo,
  type TargetProduct,
} from '../data';

type ApiMode = 'mock' | 'live';

interface ProjectState {
  // ── data ──────────────────────────────────────────────────
  sourceVideo: SourceVideo;
  /** Object URL of the just-uploaded sample video — drives its first-frame cover. */
  sourceVideoPreviewUrl: string | null;
  rawProductDescription: string;
  product: TargetProduct;
  contentBrief: ContentBrief | null;
  productIntelligence: ProductIntelligence | null;
  parseWarnings: string[];
  parseSource: 'llm' | 'deterministic' | null;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  appliedSlots: Record<string, boolean>;
  versions: CompileVersion[];
  selectedVersionId: string;
  timeline: TimelineSeg[] | null;
  exportResult: ExportResult | null;
  assetSupplyContext: AssetSupplyContext | null;
  /** Product reference image url (defaults to the first image material's url).
   *  Used as the produce anchor so AIGC stays close to the real packaging. */
  productImageUrl: string | null;
  /** Saved structures from 结构样例库 (newest first). Empty until loaded/saved. */
  savedStructures: SavedStructureSummary[];

  // ── insights / generation (capability buttons) ─────────────
  qualityReport: QualityReport | null;
  demoEstimate: DemoEstimate | null;
  safetyStatus: SafetyStatus | null;
  storyboardFrames: StoryboardFrame[] | null;
  materialJobs: MissingMaterialGenerationJob[] | null;

  // ── status ────────────────────────────────────────────────
  mode: ApiMode;
  analyzing: boolean;
  /** Real rough scan in progress (upload → VLM structure scan). */
  scanning: boolean;
  /** Human-readable rough-scan progress label (stage + elapsed). */
  scanStage: string;
  /** Per-segment fine-scan progress label, keyed by segment id (a key present = that
   *  segment is in progress). Multiple segments fine-scan CONCURRENTLY and each keeps
   *  its own progress, so analyzing one segment never clobbers another's state. */
  fineScanStages: Record<string, string>;
  /** Per-transition boundary-scan progress label, keyed by transition id (a key present
   *  = that seam is being re-scanned). Independent per seam, like fineScanStages. */
  boundaryScanStages: Record<string, string>;
  /** Per-slot HyperFrames-render progress label, keyed by slot id (a key present = that
   *  slot is being rendered by the HyperFrames Agent). Independent per slot. */
  hyperframesStages: Record<string, string>;
  /** Per-slot HyperFrames preview result (a real MP4 url + source), keyed by slot id. */
  hyperframesPreviews: Record<string, { url: string; source: string }>;
  /** Per-segment deep detail from fine scan, keyed by UI segment id. */
  segmentDetails: Record<string, FineBlockDetail>;
  uploading: boolean;
  parsingProduct: boolean;
  productPhaseHint: string;
  assetPhaseHint: string;
  diagnosisPhaseHint: string;
  compilePhaseHint: string;
  matching: boolean;
  diagnosing: boolean;
  compiling: boolean;
  nlApplying: boolean;
  exporting: boolean;
  /** REAL AIGC produce job in progress (run Director → Wan2.7 render). */
  producing: boolean;
  /** Human-readable produce progress label (stage + elapsed). */
  produceStage: string;
  assetManagerLoading: boolean;
  assetManagerWarnings: string[];
  assetManagerLastError: string | null;
  /** Which capability insight is currently loading (null = idle). */
  insightLoading: string | null;
  loadingDemo: boolean;
  warnings: string[];
  /** Real error message from the last failed API call (null when the last call
   * succeeded or no call has been made yet). Distinguishes a genuine failure
   * from the default-mock state so the UI can surface it instead of swallowing it. */
  lastError: string | null;

  // ── actions ───────────────────────────────────────────────
  dismissWarnings: () => void;
  refreshAssetManagerCoverage: () => Promise<void>;
  analyzeSample: (input: { file?: File; sampleId?: string }) => Promise<void>;
  scanSample: (file: File) => Promise<void>;
  fineScanSegment: (segmentIndex: number, segmentId: string) => Promise<void>;
  /** Re-scan ONE transition seam (boundary_scan.py) to recover its real type. */
  boundaryScanTransition: (transitionIndex: number, transitionId: string) => Promise<void>;
  /** Render ONE slot with the HyperFrames Agent in the background → a real preview MP4. */
  hyperframesFillSlot: (slotId: string) => Promise<void>;
  /** Composite ONE transition seam (ffmpeg xfade over adjacent real assets) → preview MP4. */
  hyperframesFillTransition: (transitionIndex: number, transitionId: string) => Promise<void>;
  addMaterials: (files: File[]) => Promise<void>;
  setSlot: (materialId: string, slot: string | null) => void;
  applyAssignments: (assignments: Record<string, string | null>) => Promise<void>;
  updateProduct: (product: TargetProduct) => void;
  parseProductDescription: (rawInput: string) => Promise<void>;
  runDiagnosis: () => Promise<void>;
  applyStrategy: (slotId: string, method?: ResolutionMethod, payload?: unknown) => Promise<void>;
  selectVersion: (versionId: string) => void;
  compile: () => Promise<void>;
  applyNlEdit: (instruction: string) => Promise<string>;
  exportVideo: (format: string) => Promise<ExportResult>;
  /** Set the product reference image url used as the produce anchor. */
  setProductImageUrl: (url: string | null) => void;
  /** Run the REAL AIGC produce job (Director → Wan2.7); polls until done/error. */
  produce: () => Promise<void>;

  // ── insights / generation actions ─────────────────────────
  evaluateQuality: () => Promise<void>;
  estimatePerformance: () => Promise<void>;
  checkSafety: () => Promise<void>;
  planStoryboard: () => Promise<void>;
  planMaterialJobs: () => Promise<void>;
  loadLibrary: (libraryId: string) => Promise<void>;
  runDemo: () => Promise<void>;

  // ── 结构样例库 persistence actions ─────────────────────────
  loadSavedStructures: () => Promise<void>;
  saveCurrentStructure: (title?: string) => Promise<SavedStructureSummary>;
  openSavedStructure: (id: string) => Promise<void>;
  deleteSavedStructure: (id: string) => Promise<void>;

  reset: () => void;
}

/** Normalize a thrown value into a human-readable message. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The first image material's url, used as the produce anchor (productImageUrl).
 *  Returns null when no image material carries a usable url. */
function firstImageMaterialUrl(materials: Material[]): string | null {
  const img = materials.find((m) => m.kind === 'photo' && typeof m.url === 'string' && m.url.length > 0);
  return img?.url ?? null;
}

/** Resolve the productImageUrl after materials change: keep an explicit existing
 *  anchor if it's still present among the materials, otherwise default to the
 *  first image material's url (so produce always has an anchor when one exists). */
function resolveProductImageUrl(materials: Material[], current: string | null): string | null {
  if (current && materials.some((m) => m.url === current)) return current;
  return firstImageMaterialUrl(materials);
}

/** Canonical role→slot ids the backend (assetCardsToMaterials / CANONICAL_ROLE_SLOT) assigns to
 *  freshly uploaded materials. These are placeholders that do NOT match a real scanned segment id
 *  (e.g. a rough scan produces `seg_block_001…`), so we invert them to remap onto a real segment. */
const CANONICAL_SLOT_ROLE: Record<string, RoleKey> = {
  s1: 'hook', s2: 'pain', s3: 'emotion', s4: 'product', s5: 'compare', s6: 'social', s7: 'cta',
};

/** Align freshly-uploaded materials' placeholder slot ids (s1..s7, role-assigned by the backend)
 *  onto the CURRENT source structure's real segment ids, so the structure-migration connections
 *  render immediately after upload — before /materials/match refines them against the real graph.
 *  A material keeps a slot that already names a real segment; a placeholder maps to the first real
 *  segment of the same role; if no segment of that role exists, the slot is cleared so the UI never
 *  draws a connection to a non-existent slot. */
function alignMaterialSlotsToSource(materials: Material[], sourceVideo: SourceVideo): Material[] {
  const segments = sourceVideo.segments;
  if (segments.length === 0) return materials;
  const realIds = new Set(segments.map((s) => s.id));
  const firstByRole = new Map<RoleKey, string>();
  for (const s of segments) if (!firstByRole.has(s.role)) firstByRole.set(s.role, s.id);
  return materials.map((m) => {
    if (!m.slot || realIds.has(m.slot)) return m; // unassigned, or already a real segment id
    const role = CANONICAL_SLOT_ROLE[m.slot];
    const target = role ? firstByRole.get(role) : undefined;
    return { ...m, slot: target ?? null };
  });
}

/** Derive a playable timeline from the structure + diagnosis (mock fallback). */
function deriveTimeline(sourceVideo: SourceVideo, diagnosis: Record<string, Diagnosis>): TimelineSeg[] {
  return sourceVideo.segments.map((seg) => ({
    id: seg.id,
    role: seg.role,
    start: seg.start,
    end: seg.end,
    label: seg.label,
    shot: seg.shot,
    caption: seg.caption,
    fixKind: diagnosis[seg.id]?.fix?.kind ?? null,
  }));
}

/** A valid-but-EMPTY source video. The app seeds NO mock content: screen 01 stays
 *  empty until the user uploads a sample (analyzeSample) or runs the real-backend
 *  一键演示. Screens gate on `segments.length` and show an empty state instead. */
const EMPTY_SOURCE: SourceVideo = {
  id: '', title: '', platform: '', duration: 0, views: '', likes: '',
  finish_rate: 0, ctr: 0, cvr: 0, protocol_version: '',
  segments: [], transitions: [],
  rhythm: { avg_shot: 0, cuts: 0, hook_density: '', bgm_bpm: 0, caption_density: '' },
  packaging: { title_template: '', captions: '', bgm: '', cover: '' },
};
/** Blank product the user fills in — no mock product seeded. */
const BLANK_PRODUCT: TargetProduct = { name: '', category: '', price: '', stock: 0, asset_count: 0, industry: '' };

const initialState = {
  sourceVideo: EMPTY_SOURCE,
  sourceVideoPreviewUrl: null as string | null,
  rawProductDescription: '',
  product: BLANK_PRODUCT,
  contentBrief: null as ContentBrief | null,
  productIntelligence: null as ProductIntelligence | null,
  parseWarnings: [] as string[],
  parseSource: null as 'llm' | 'deterministic' | null,
  materials: [] as Material[],
  diagnosis: {} as Record<string, Diagnosis>,
  appliedSlots: {} as Record<string, boolean>,
  versions: COMPILE_VERSIONS,
  selectedVersionId: COMPILE_VERSIONS[0].id,
  timeline: null as TimelineSeg[] | null,
  exportResult: null as ExportResult | null,
  assetSupplyContext: null as AssetSupplyContext | null,
  productImageUrl: null as string | null,
  savedStructures: [] as SavedStructureSummary[],
  qualityReport: null as QualityReport | null,
  demoEstimate: null as DemoEstimate | null,
  safetyStatus: null as SafetyStatus | null,
  storyboardFrames: null as StoryboardFrame[] | null,
  materialJobs: null as MissingMaterialGenerationJob[] | null,
  mode: 'mock' as ApiMode,
  analyzing: false,
  scanning: false,
  scanStage: '',
  fineScanStages: {} as Record<string, string>,
  boundaryScanStages: {} as Record<string, string>,
  hyperframesStages: {} as Record<string, string>,
  hyperframesPreviews: {} as Record<string, { url: string; source: string }>,
  segmentDetails: {} as Record<string, FineBlockDetail>,
  uploading: false,
  parsingProduct: false,
  productPhaseHint: '',
  assetPhaseHint: '',
  diagnosisPhaseHint: '',
  compilePhaseHint: '',
  matching: false,
  diagnosing: false,
  compiling: false,
  nlApplying: false,
  exporting: false,
  producing: false,
  produceStage: '',
  assetManagerLoading: false,
  assetManagerWarnings: [] as string[],
  assetManagerLastError: null as string | null,
  insightLoading: null as string | null,
  loadingDemo: false,
  warnings: [] as string[],
  lastError: null as string | null,
};

export const useProjectStore = create<ProjectState>()((set, get) => ({
  ...initialState,

  dismissWarnings: () => set({ warnings: [], lastError: null }),

  refreshAssetManagerCoverage: async () => {
    // No source yet → nothing to analyze; keep the panel empty (no mock coverage).
    if (get().sourceVideo.segments.length === 0) {
      set({ assetSupplyContext: null, assetManagerWarnings: [], assetManagerLastError: null });
      return;
    }
    set({ assetManagerLoading: true, assetManagerLastError: null });
    try {
      const { assetSupplyContext, warnings } = await analyzeStructAssetManagerCoverage({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
        contentBrief: get().contentBrief,
      });
      set({
        assetSupplyContext: assetSupplyContext ?? null,
        assetManagerWarnings: warnings ?? assetSupplyContext?.warnings ?? [],
        assetManagerLastError: null,
      });
    } catch (e) {
      set({
        assetSupplyContext: null,
        assetManagerWarnings: ['Asset Manager coverage API unavailable · 使用本地素材槽位预览继续演示'],
        assetManagerLastError: errMsg(e),
      });
    } finally {
      set({ assetManagerLoading: false });
    }
  },

  analyzeSample: async (input) => {
    if (input.file) {
      const prevPreview = get().sourceVideoPreviewUrl;
      if (prevPreview) URL.revokeObjectURL(prevPreview);
      set({ sourceVideoPreviewUrl: URL.createObjectURL(input.file) });
    }
    set({ analyzing: true, lastError: null });
    try {
      const { sourceVideo, warnings } = await analyzeSampleApi(input);
      set({ sourceVideo, mode: 'live', warnings: warnings ?? [] });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '样例解析失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ analyzing: false });
    }
  },

  scanSample: async (file) => {
    // Real rough scan: upload → async VLM job → poll → real structure timeline.
    // Keep a local object URL of the uploaded file so its first frame can be shown
    // as the sample-video cover immediately (no wait for a server-rendered poster).
    const prevPreview = get().sourceVideoPreviewUrl;
    if (prevPreview) URL.revokeObjectURL(prevPreview);
    set({ scanning: true, scanStage: '上传视频…', lastError: null, sourceVideoPreviewUrl: URL.createObjectURL(file) });
    try {
      const { jobId } = await startScan(file);
      for (let i = 0; i < 150; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const s = await getScanStatus(jobId);
        if (s.status === 'running') {
          set({ scanStage: (s.stage ?? '扫描中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : '') });
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || '粗扫描失败');
        if (!s.sourceVideo) throw new Error('扫描完成但未返回结构');
        set({ sourceVideo: s.sourceVideo, mode: 'live', warnings: s.warnings ?? [], scanning: false, scanStage: '', segmentDetails: {}, fineScanStages: {}, boundaryScanStages: {}, hyperframesStages: {}, hyperframesPreviews: {} });
        void get().refreshAssetManagerCoverage();
        return;
      }
      throw new Error('粗扫描超时（>5 分钟）');
    } catch (e) {
      set({ scanning: false, scanStage: '', lastError: '粗扫描失败 · ' + errMsg(e) });
      throw e;
    }
  },

  fineScanSegment: async (segmentIndex, segmentId) => {
    // Deep per-segment analysis: visual peak detection + per-peak VLM on the raw video.
    set((st) => ({ fineScanStages: { ...st.fineScanStages, [segmentId]: '排队中' }, lastError: null }));
    try {
      const { jobId } = await startFineScan(get().sourceVideo.id, segmentIndex);
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const s = await getFineScanStatus(jobId);
        if (s.status === 'running') {
          set((st) => ({ fineScanStages: { ...st.fineScanStages, [segmentId]: (s.stage ?? '精扫描中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : '') } }));
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || '精扫描失败');
        if (!s.detail) throw new Error('精扫描完成但未返回明细');
        const detail = s.detail;
        set((st) => {
          const rest = { ...st.fineScanStages };
          delete rest[segmentId];
          return { segmentDetails: { ...st.segmentDetails, [segmentId]: detail }, fineScanStages: rest };
        });
        return;
      }
      throw new Error('精扫描超时（>6 分钟）');
    } catch (e) {
      set((st) => {
        const rest = { ...st.fineScanStages };
        delete rest[segmentId];
        return { fineScanStages: rest, lastError: '精扫描失败 · ' + errMsg(e) };
      });
      throw e;
    }
  },

  boundaryScanTransition: async (transitionIndex, transitionId) => {
    // Re-scan ONE seam: boundary_scan.py → real transition type (叠化/推镜/…) for just
    // this transition. The backend returns an updated copy; splice it in BY ID (so
    // other seams stay untouched). FAIL-FAST on error. Multiple seams can scan at once,
    // each keyed by its own transition id in boundaryScanStages.
    const transition = get().sourceVideo.transitions[transitionIndex];
    if (!transition || transition.id !== transitionId) {
      set({ lastError: '转场扫描失败 · 找不到该转场（结构可能已更新，请重试）' });
      return;
    }
    set((st) => ({ boundaryScanStages: { ...st.boundaryScanStages, [transitionId]: '排队中' }, lastError: null }));
    try {
      const { jobId } = await startBoundaryScan(get().sourceVideo.id, transitionIndex, transition);
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const s = await getBoundaryScanStatus(jobId);
        if (s.status === 'running') {
          set((st) => ({ boundaryScanStages: { ...st.boundaryScanStages, [transitionId]: (s.stage ?? '转场扫描中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : '') } }));
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || '转场扫描失败');
        if (!s.transition) throw new Error('转场扫描完成但未返回结果');
        const updated = s.transition;
        set((st) => {
          const rest = { ...st.boundaryScanStages };
          delete rest[transitionId];
          // Match by id (the index may have shifted) so only this seam is replaced.
          const transitions = st.sourceVideo.transitions.map((t) => (t.id === transitionId ? updated : t));
          return {
            sourceVideo: { ...st.sourceVideo, transitions },
            boundaryScanStages: rest,
            mode: 'live',
            warnings: s.warnings ?? [],
          };
        });
        return;
      }
      throw new Error('转场扫描超时（>6 分钟）');
    } catch (e) {
      set((st) => {
        const rest = { ...st.boundaryScanStages };
        delete rest[transitionId];
        return { boundaryScanStages: rest, lastError: '转场扫描失败 · ' + errMsg(e) };
      });
      throw e;
    }
  },

  hyperframesFillSlot: async (slotId) => {
    // Render ONE slot with the HyperFrames Agent → a real preview MP4. The Director
    // authors this slot's brief server-side; the Agent edits in the background. We poll
    // and store the preview BY slot id, so multiple slots can render concurrently and
    // each keeps its own progress/preview. FAIL-FAST: surface the backend error
    // verbatim; never a fake preview.
    set((st) => ({ hyperframesStages: { ...st.hyperframesStages, [slotId]: '排队中' }, lastError: null }));
    try {
      const { jobId } = await startHyperframesSlot({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
        slotId,
        productImageUrl: get().productImageUrl ?? undefined,
      });
      // Poll ~3s; author→lint→render→critic can take a few minutes → ceiling ~120 polls.
      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const s = await getHyperframesStatus(jobId);
        if (s.status === 'running') {
          set((st) => ({
            hyperframesStages: {
              ...st.hyperframesStages,
              [slotId]: (s.stage ?? 'HyperFrames 剪辑中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : ''),
            },
          }));
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || 'HyperFrames 渲染失败');
        const previewUrl = s.previewUrl;
        if (!previewUrl) throw new Error('HyperFrames 渲染完成但未返回预览');
        const source = s.source ?? 'llm';
        set((st) => {
          const stages = { ...st.hyperframesStages };
          delete stages[slotId];
          return {
            hyperframesStages: stages,
            hyperframesPreviews: { ...st.hyperframesPreviews, [slotId]: { url: previewUrl, source } },
            mode: 'live',
            warnings: s.warnings ?? [],
          };
        });
        return;
      }
      throw new Error('HyperFrames 渲染超时（>6 分钟）');
    } catch (e) {
      set((st) => {
        const stages = { ...st.hyperframesStages };
        delete stages[slotId];
        return { hyperframesStages: stages, lastError: 'HyperFrames 补全失败 · ' + errMsg(e) };
      });
      throw e;
    }
  },

  hyperframesFillTransition: async (transitionIndex, transitionId) => {
    // Composite ONE transition seam (ffmpeg xfade over the two adjacent slots' real
    // assets) → a real preview MP4. Keyed by transition id in the same maps as slot
    // fills (t-ids never collide with s-ids). FAIL-FAST: surface backend error verbatim.
    set((st) => ({ hyperframesStages: { ...st.hyperframesStages, [transitionId]: '排队中' }, lastError: null }));
    try {
      const { jobId } = await startHyperframesTransition({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        transitionIndex,
      });
      // ffmpeg xfade is quick → poll ~2s, ceiling ~60 (2 min).
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const s = await getHyperframesStatus(jobId);
        if (s.status === 'running') {
          set((st) => ({
            hyperframesStages: {
              ...st.hyperframesStages,
              [transitionId]: (s.stage ?? '合成转场中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : ''),
            },
          }));
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || '转场合成失败');
        const previewUrl = s.previewUrl;
        if (!previewUrl) throw new Error('转场合成完成但未返回预览');
        const source = s.source ?? 'mock';
        set((st) => {
          const stages = { ...st.hyperframesStages };
          delete stages[transitionId];
          return {
            hyperframesStages: stages,
            hyperframesPreviews: { ...st.hyperframesPreviews, [transitionId]: { url: previewUrl, source } },
            mode: 'live',
            warnings: s.warnings ?? [],
          };
        });
        return;
      }
      throw new Error('转场合成超时（>2 分钟）');
    } catch (e) {
      set((st) => {
        const stages = { ...st.hyperframesStages };
        delete stages[transitionId];
        return { hyperframesStages: stages, lastError: 'HyperFrames 转场失败 · ' + errMsg(e) };
      });
      throw e;
    }
  },

  addMaterials: async (files) => {
    if (files.length === 0) return;
    set({ uploading: true, lastError: null, assetPhaseHint: '正在请求素材解析接口' });
    try {
      // Pass materials VERBATIM from the API (they carry .url + clip fields) —
      // do NOT strip them. Default the produce anchor to the first image url.
      const { materials, warnings } = await uploadMaterialsApi(files, get().product, {
        rawProductDescription: get().rawProductDescription,
        contentBrief: get().contentBrief,
      });
      // Remap the backend's placeholder slot ids (s1..s7) onto this source's real segment ids so
      // the migration connections appear right away (match refines them later).
      const aligned = alignMaterialSlotsToSource(materials, get().sourceVideo);
      set({
        materials: aligned,
        productImageUrl: resolveProductImageUrl(aligned, get().productImageUrl),
        mode: 'live',
        warnings: warnings ?? [],
        assetPhaseHint: '素材解析接口已返回',
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '素材上传失败 · ' + errMsg(e), assetPhaseHint: '素材解析请求失败' });
      throw e;
    } finally {
      set({ uploading: false });
    }
  },

  setSlot: (materialId, slot) =>
    set((state) => ({
      materials: state.materials.map((m) => (m.id === materialId ? { ...m, slot } : m)),
    })),

  applyAssignments: async (assignments) => {
    set({ matching: true, lastError: null, assetPhaseHint: '正在请求素材槽位匹配接口' });
    // Optimistically apply locally first (keeps UI snappy + is the mock result).
    const local = get().materials.map((m) =>
      m.id in assignments ? { ...m, slot: assignments[m.id] } : m
    );
    try {
      const { materials, warnings } = await matchMaterialsApi({
        sourceVideo: get().sourceVideo,
        materials: local,
        product: get().product,
        contentBrief: get().contentBrief ?? undefined,
        productIntelligence: get().productIntelligence,
        rawProductDescription: get().rawProductDescription,
        assignments,
      });
      set({
        materials,
        productImageUrl: resolveProductImageUrl(materials, get().productImageUrl),
        mode: 'live',
        warnings: warnings ?? [],
        assetPhaseHint: '素材槽位匹配接口已返回',
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '素材匹配失败 · ' + errMsg(e), assetPhaseHint: '素材槽位匹配请求失败' });
      throw e;
    } finally {
      set({ matching: false });
    }
  },

  updateProduct: (product) => {
    set({ product });
    void get().refreshAssetManagerCoverage();
  },

  parseProductDescription: async (rawInput) => {
    const rawProductDescription = rawInput.trim();
    if (rawProductDescription.length < 10) {
      set({
        rawProductDescription,
        lastError: '产品描述至少需要 10 个字符',
        productPhaseHint: '产品描述过短，尚未提交解析',
      });
      return;
    }
    set({
      rawProductDescription,
      parsingProduct: true,
      lastError: null,
      productPhaseHint: '正在请求产品描述解析接口',
    });
    try {
      const result = await parseProductApi({ rawInput: rawProductDescription });
      set({
        rawProductDescription,
        product: result.product,
        contentBrief: result.contentBrief,
        productIntelligence: result.productIntelligence ?? null,
        parseWarnings: result.parseWarnings ?? result.warnings ?? [],
        parseSource: result.source,
        warnings: result.warnings ?? [],
        mode: 'live',
        productPhaseHint: result.source === 'llm' ? '产品描述解析已返回（LLM）' : '产品描述解析已返回（确定性兜底）',
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({
        lastError: '产品描述解析失败 · ' + errMsg(e),
        productPhaseHint: '产品描述解析请求失败',
      });
      throw e;
    } finally {
      set({ parsingProduct: false });
    }
  },

  runDiagnosis: async () => {
    set({ diagnosing: true, lastError: null, diagnosisPhaseHint: '正在请求缺口诊断接口' });
    void get().refreshAssetManagerCoverage();
    try {
      const { diagnosis, warnings } = await diagnoseApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
        contentBrief: get().contentBrief ?? undefined,
        productIntelligence: get().productIntelligence,
        rawProductDescription: get().rawProductDescription,
      });
      set({ diagnosis, mode: 'live', warnings: warnings ?? [], diagnosisPhaseHint: '缺口诊断接口已返回' });
    } catch (e) {
      set({ lastError: '缺口诊断失败 · ' + errMsg(e), diagnosisPhaseHint: '缺口诊断请求失败' });
      throw e;
    } finally {
      set({ diagnosing: false });
    }
  },

  applyStrategy: async (slotId, method, payload) => {
    // Mark applied immediately for responsiveness.
    set((state) => ({ appliedSlots: { ...state.appliedSlots, [slotId]: true }, lastError: null }));
    try {
      const { diagnosis, appliedSlots, warnings } = await applyStrategyApi({
        slotId,
        method,
        payload,
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        diagnosis: get().diagnosis,
      });
      const applied: Record<string, boolean> = { ...get().appliedSlots };
      appliedSlots.forEach((s) => (applied[s] = true));
      set({ diagnosis, appliedSlots: applied, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      // Roll back the optimistic "applied" flag — the strategy did NOT apply.
      set((state) => ({ appliedSlots: { ...state.appliedSlots, [slotId]: false } }));
      set({ lastError: '补全策略应用失败 · ' + errMsg(e) });
      throw e;
    }
  },

  selectVersion: (selectedVersionId) => set({ selectedVersionId, timeline: null }),

  compile: async () => {
    set({ compiling: true, lastError: null, compilePhaseHint: '正在请求 Director 编排接口' });
    try {
      const { version, timeline, warnings } = await compileApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        diagnosis: get().diagnosis,
        versionId: get().selectedVersionId,
        product: get().product,
        contentBrief: get().contentBrief ?? undefined,
        productIntelligence: get().productIntelligence,
        rawProductDescription: get().rawProductDescription,
      });
      set({ timeline, selectedVersionId: version.id, mode: 'live', warnings: warnings ?? [], compilePhaseHint: 'Director 编排接口已返回' });
    } catch (e) {
      set({ lastError: '成片编译失败 · ' + errMsg(e), compilePhaseHint: 'Director 编排请求失败' });
      throw e;
    } finally {
      set({ compiling: false });
    }
  },

  applyNlEdit: async (instruction) => {
    set({ nlApplying: true, lastError: null });
    const timeline = get().timeline ?? deriveTimeline(get().sourceVideo, get().diagnosis);
    try {
      const res = await nlEditApi({
        instruction,
        versionId: get().selectedVersionId,
        sourceVideo: get().sourceVideo,
        timeline,
      });
      set({ timeline: res.timeline, mode: 'live', warnings: res.warnings ?? [] });
      return res.patchSummary;
    } catch (e) {
      set({ lastError: '自然语言改片失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ nlApplying: false });
    }
  },

  exportVideo: async (format) => {
    set({ exporting: true, lastError: null });
    const timeline = get().timeline ?? deriveTimeline(get().sourceVideo, get().diagnosis);
    try {
      const result = await exportApi({ versionId: get().selectedVersionId, format, timeline });
      set({ exportResult: result, mode: 'live', warnings: result.warnings ?? [] });
      return result;
    } catch (e) {
      set({ lastError: '导出失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ exporting: false });
    }
  },

  setProductImageUrl: (url) => set({ productImageUrl: url }),

  produce: async () => {
    // REAL AIGC produce: start the job → poll until done (downloadUrl when rendered)
    // or error. FAIL-FAST: on error record lastError verbatim and re-throw — never
    // a fake download link. Honors the DASHSCOPE-missing honest error from backend.
    set({ producing: true, produceStage: '排队中', lastError: null });
    try {
      const { jobId } = await startProduceApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
        contentBrief: get().contentBrief ?? undefined,
        productIntelligence: get().productIntelligence,
        rawProductDescription: get().rawProductDescription,
        productImageUrl: get().productImageUrl ?? undefined,
        versionId: get().selectedVersionId,
      });
      // Poll every ~3s. Wan2.7 generation takes minutes → ceiling of 200 polls (~10min).
      const maxPolls = 200;
      // Tolerate transient status-poll failures: a network blip shouldn't kill a
      // ~10-min job. Only abort after 3 CONSECUTIVE failures (reset on any success).
      const maxConsecutiveErrors = 3;
      let consecutiveErrors = 0;
      for (let i = 0; i < maxPolls; i++) {
        // Cancellation: anything that sets producing:false (reset / new run / navigate
        // away) stops this loop so it can't clobber later exportResult/mode/produceStage.
        if (!get().producing) return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        let s: Awaited<ReturnType<typeof getProduceStatusApi>>;
        try {
          s = await getProduceStatusApi(jobId);
          consecutiveErrors = 0;
        } catch (pollError) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= maxConsecutiveErrors) throw pollError;
          continue;
        }
        if (s.status === 'running') {
          set({ produceStage: (s.stage ?? '生成中') + (s.elapsedSec ? ` · ${s.elapsedSec}s` : '') });
          continue;
        }
        if (s.status === 'error') throw new Error(s.error || '成片生成失败');
        // status === 'done': may or may not have a real downloadUrl (honest gate).
        const result: ExportResult = {
          jobId,
          status: s.downloadUrl ? 'done' : 'failed',
          progress: 100,
          downloadUrl: s.downloadUrl,
          warnings: s.warnings ?? [],
        };
        set({ exportResult: result, mode: 'live', warnings: s.warnings ?? [], producing: false, produceStage: '' });
        return;
      }
      throw new Error('成片生成超时（>10 分钟）');
    } catch (e) {
      set({ producing: false, produceStage: '', lastError: '成片生成失败 · ' + errMsg(e) });
      throw e;
    }
  },

  evaluateQuality: async () => {
    set({ insightLoading: 'quality', lastError: null });
    try {
      const { qualityReport, warnings } = await evaluateQualityApi(buildInsightRequest(get()));
      set({ qualityReport, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: '质量评估失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ insightLoading: null });
    }
  },

  estimatePerformance: async () => {
    set({ insightLoading: 'estimate', lastError: null });
    try {
      const { demoEstimate, warnings } = await estimatePerformanceApi(buildInsightRequest(get()));
      set({ demoEstimate, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: '预测评分失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ insightLoading: null });
    }
  },

  checkSafety: async () => {
    set({ insightLoading: 'safety', lastError: null });
    try {
      const { safetyStatus } = await checkSafetyApi(buildInsightRequest(get()));
      set({ safetyStatus, mode: 'live' });
    } catch (e) {
      set({ lastError: '安全检查失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ insightLoading: null });
    }
  },

  planStoryboard: async () => {
    set({ insightLoading: 'storyboard', lastError: null });
    try {
      const { frames, warnings } = await planStoryboardApi(buildInsightRequest(get()));
      set({ storyboardFrames: frames, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: '分镜规划失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ insightLoading: null });
    }
  },

  planMaterialJobs: async () => {
    set({ insightLoading: 'materialJobs', lastError: null });
    try {
      const { jobs, warnings } = await planMaterialJobsApi(buildInsightRequest(get()));
      set({ materialJobs: jobs, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: 'AIGC 生成规划失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ insightLoading: null });
    }
  },

  loadLibrary: async (libraryId) => {
    set({ uploading: true, lastError: null });
    try {
      const { materials, warnings } = await loadLibraryMaterialsApi(libraryId);
      // Same placeholder-slot remap as upload, so a loaded library lights up the migration view.
      const aligned = alignMaterialSlotsToSource(materials, get().sourceVideo);
      set({
        materials: aligned,
        productImageUrl: resolveProductImageUrl(aligned, get().productImageUrl),
        mode: 'live',
        warnings: warnings ?? [],
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '示例素材库加载失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ uploading: false });
    }
  },

  runDemo: async () => {
    set({ loadingDemo: true, lastError: null });
    try {
      const bundle = await runDemoApi();
      set({
        sourceVideo: bundle.sourceVideo,
        product: bundle.product,
        materials: bundle.materials,
        productImageUrl: resolveProductImageUrl(bundle.materials, get().productImageUrl),
        diagnosis: bundle.diagnosis,
        timeline: bundle.timeline,
        selectedVersionId: bundle.version?.id ?? get().selectedVersionId,
        appliedSlots: {},
        mode: 'live',
        warnings: bundle.warnings ?? [],
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '一键演示失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ loadingDemo: false });
    }
  },

  loadSavedStructures: async () => {
    try {
      const structures = await listStructuresApi();
      set({ savedStructures: structures });
    } catch (e) {
      // Don't crash the library screen — surface the error but keep the prior list.
      set({ lastError: '结构样例库加载失败 · ' + errMsg(e) });
    }
  },

  saveCurrentStructure: async (title) => {
    // FAIL-FAST: nothing scanned yet → don't POST an empty structure.
    if (get().sourceVideo.segments.length === 0) {
      const msg = '请先扫描一个视频再保存';
      set({ lastError: msg });
      throw new Error(msg);
    }
    set({ lastError: null });
    try {
      const summary = await saveStructureApi({
        sourceVideo: get().sourceVideo,
        segmentDetails: get().segmentDetails,
        title,
      });
      set((st) => ({ savedStructures: [summary, ...st.savedStructures] }));
      return summary;
    } catch (e) {
      set({ lastError: '保存结构失败 · ' + errMsg(e) });
      throw e;
    }
  },

  openSavedStructure: async (id) => {
    set({ lastError: null });
    try {
      const rec = await getStructureApi(id);
      // Load the saved structure as a FRESH migration start: keep its source +
      // fine-scan detail, but reset all downstream working state (materials,
      // diagnosis, applied slots, timeline, export, in-flight fine scans).
      set({
        sourceVideo: rec.sourceVideo,
        segmentDetails: rec.segmentDetails ?? {},
        mode: 'live',
        materials: [],
        diagnosis: {},
        appliedSlots: {},
        timeline: null,
        exportResult: null,
        fineScanStages: {},
        boundaryScanStages: {},
      });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '载入结构失败 · ' + errMsg(e) });
      throw e;
    }
  },

  deleteSavedStructure: async (id) => {
    set({ lastError: null });
    try {
      await deleteStructureApi(id);
      set((st) => ({ savedStructures: st.savedStructures.filter((s) => s.id !== id) }));
    } catch (e) {
      set({ lastError: '删除结构失败 · ' + errMsg(e) });
      throw e;
    }
  },

  reset: () => set({ ...initialState }),
}));

/** Build the shared evaluation/generation request from current store state. */
function buildInsightRequest(state: ProjectState): InsightRequest {
  return {
    sourceVideo: state.sourceVideo,
    materials: state.materials,
    product: state.product,
    timeline: state.timeline ?? undefined,
    versionId: state.selectedVersionId,
  };
}
