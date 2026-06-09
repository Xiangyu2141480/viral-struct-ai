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
  DemoEstimate,
  MissingMaterialGenerationJob,
  QualityReport,
  SafetyStatus,
  StoryboardFrame,
} from '@viral-struct/shared';
import { analyzeStructAssetManagerCoverage } from '../api/assetManager';
import { compile as compileApi, exportVideo as exportApi, nlEdit as nlEditApi } from '../api/compile';
import { applyStrategy as applyStrategyApi, diagnose as diagnoseApi } from '../api/diagnose';
import { matchMaterials as matchMaterialsApi, uploadMaterials as uploadMaterialsApi } from '../api/materials';
import { analyzeSample as analyzeSampleApi } from '../api/sample';
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
  type SourceVideo,
  type TargetProduct,
} from '../data';

type ApiMode = 'mock' | 'live';

interface ProjectState {
  // ── data ──────────────────────────────────────────────────
  sourceVideo: SourceVideo;
  product: TargetProduct;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  appliedSlots: Record<string, boolean>;
  versions: CompileVersion[];
  selectedVersionId: string;
  timeline: TimelineSeg[] | null;
  exportResult: ExportResult | null;
  assetSupplyContext: AssetSupplyContext | null;

  // ── insights / generation (capability buttons) ─────────────
  qualityReport: QualityReport | null;
  demoEstimate: DemoEstimate | null;
  safetyStatus: SafetyStatus | null;
  storyboardFrames: StoryboardFrame[] | null;
  materialJobs: MissingMaterialGenerationJob[] | null;

  // ── status ────────────────────────────────────────────────
  mode: ApiMode;
  analyzing: boolean;
  uploading: boolean;
  matching: boolean;
  diagnosing: boolean;
  compiling: boolean;
  nlApplying: boolean;
  exporting: boolean;
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
  addMaterials: (files: File[]) => Promise<void>;
  setSlot: (materialId: string, slot: string | null) => void;
  applyAssignments: (assignments: Record<string, string | null>) => Promise<void>;
  updateProduct: (product: TargetProduct) => void;
  runDiagnosis: () => Promise<void>;
  applyStrategy: (slotId: string) => Promise<void>;
  selectVersion: (versionId: string) => void;
  compile: () => Promise<void>;
  applyNlEdit: (instruction: string) => Promise<string>;
  exportVideo: (format: string) => Promise<ExportResult>;

  // ── insights / generation actions ─────────────────────────
  evaluateQuality: () => Promise<void>;
  estimatePerformance: () => Promise<void>;
  checkSafety: () => Promise<void>;
  planStoryboard: () => Promise<void>;
  planMaterialJobs: () => Promise<void>;
  loadLibrary: (libraryId: string) => Promise<void>;
  runDemo: () => Promise<void>;
  reset: () => void;
}

/** Normalize a thrown value into a human-readable message. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
  product: BLANK_PRODUCT,
  materials: [] as Material[],
  diagnosis: {} as Record<string, Diagnosis>,
  appliedSlots: {} as Record<string, boolean>,
  versions: COMPILE_VERSIONS,
  selectedVersionId: COMPILE_VERSIONS[0].id,
  timeline: null as TimelineSeg[] | null,
  exportResult: null as ExportResult | null,
  assetSupplyContext: null as AssetSupplyContext | null,
  qualityReport: null as QualityReport | null,
  demoEstimate: null as DemoEstimate | null,
  safetyStatus: null as SafetyStatus | null,
  storyboardFrames: null as StoryboardFrame[] | null,
  materialJobs: null as MissingMaterialGenerationJob[] | null,
  mode: 'mock' as ApiMode,
  analyzing: false,
  uploading: false,
  matching: false,
  diagnosing: false,
  compiling: false,
  nlApplying: false,
  exporting: false,
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

  addMaterials: async (files) => {
    if (files.length === 0) return;
    set({ uploading: true, lastError: null });
    try {
      const { materials, warnings } = await uploadMaterialsApi(files, get().product);
      set({ materials, mode: 'live', warnings: warnings ?? [] });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '素材上传失败 · ' + errMsg(e) });
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
    set({ matching: true, lastError: null });
    // Optimistically apply locally first (keeps UI snappy + is the mock result).
    const local = get().materials.map((m) =>
      m.id in assignments ? { ...m, slot: assignments[m.id] } : m
    );
    try {
      const { materials, warnings } = await matchMaterialsApi({
        sourceVideo: get().sourceVideo,
        materials: local,
        assignments,
      });
      set({ materials, mode: 'live', warnings: warnings ?? [] });
      void get().refreshAssetManagerCoverage();
    } catch (e) {
      set({ lastError: '素材匹配失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ matching: false });
    }
  },

  updateProduct: (product) => {
    set({ product });
    void get().refreshAssetManagerCoverage();
  },

  runDiagnosis: async () => {
    set({ diagnosing: true, lastError: null });
    void get().refreshAssetManagerCoverage();
    try {
      const { diagnosis, warnings } = await diagnoseApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
      });
      set({ diagnosis, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: '缺口诊断失败 · ' + errMsg(e) });
      throw e;
    } finally {
      set({ diagnosing: false });
    }
  },

  applyStrategy: async (slotId) => {
    // Mark applied immediately for responsiveness.
    set((state) => ({ appliedSlots: { ...state.appliedSlots, [slotId]: true }, lastError: null }));
    try {
      const { diagnosis, appliedSlots, warnings } = await applyStrategyApi({
        slotId,
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
    set({ compiling: true, lastError: null });
    try {
      const { version, timeline, warnings } = await compileApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        diagnosis: get().diagnosis,
        versionId: get().selectedVersionId,
      });
      set({ timeline, selectedVersionId: version.id, mode: 'live', warnings: warnings ?? [] });
    } catch (e) {
      set({ lastError: '成片编译失败 · ' + errMsg(e) });
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
      set({ materials, mode: 'live', warnings: warnings ?? [] });
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
