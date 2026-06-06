'use client';

// useProjectStore.ts — single source of truth across Screens 01–04.
//
// Each async action calls the dedicated `/api/struct/*` endpoint and, if that
// throws (backend not up yet / route unimplemented), falls back to a local
// derivation from the mock fixtures in ../data.ts. The active path is tracked
// in `mode` ('live' once any call succeeds, otherwise 'mock') and surfaced in
// `warnings`, so the prototype renders end-to-end with or without a backend.

import { create } from 'zustand';
import { compile as compileApi, exportVideo as exportApi, nlEdit as nlEditApi } from '../api/compile';
import { applyStrategy as applyStrategyApi, diagnose as diagnoseApi } from '../api/diagnose';
import { matchMaterials as matchMaterialsApi, uploadMaterials as uploadMaterialsApi } from '../api/materials';
import { analyzeSample as analyzeSampleApi } from '../api/sample';
import type { ExportResult, TimelineSeg } from '../api/types';
import {
  COMPILE_VERSIONS,
  SLOT_DIAGNOSIS,
  SOURCE_VIDEO,
  TARGET_MATERIALS,
  TARGET_PRODUCT,
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

  // ── status ────────────────────────────────────────────────
  mode: ApiMode;
  analyzing: boolean;
  uploading: boolean;
  matching: boolean;
  diagnosing: boolean;
  compiling: boolean;
  nlApplying: boolean;
  exporting: boolean;
  warnings: string[];

  // ── actions ───────────────────────────────────────────────
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
  reset: () => void;
}

const MOCK_NOTE = '后端未连接 · 使用本地示例数据';

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

const initialState = {
  sourceVideo: SOURCE_VIDEO,
  product: TARGET_PRODUCT,
  materials: TARGET_MATERIALS,
  diagnosis: SLOT_DIAGNOSIS,
  appliedSlots: {} as Record<string, boolean>,
  versions: COMPILE_VERSIONS,
  selectedVersionId: COMPILE_VERSIONS[0].id,
  timeline: null as TimelineSeg[] | null,
  exportResult: null as ExportResult | null,
  mode: 'mock' as ApiMode,
  analyzing: false,
  uploading: false,
  matching: false,
  diagnosing: false,
  compiling: false,
  nlApplying: false,
  exporting: false,
  warnings: [] as string[],
};

export const useProjectStore = create<ProjectState>()((set, get) => ({
  ...initialState,

  analyzeSample: async (input) => {
    set({ analyzing: true });
    try {
      const { sourceVideo, warnings } = await analyzeSampleApi(input);
      set({ sourceVideo, mode: 'live', warnings: warnings ?? [] });
    } catch {
      // Fallback: keep the mock sample (optionally retitle to the uploaded file).
      const base = get().sourceVideo;
      const sourceVideo = input.file ? { ...base, title: input.file.name.replace(/\.[^.]+$/, '') } : base;
      set({ sourceVideo, mode: 'mock', warnings: [MOCK_NOTE] });
    } finally {
      set({ analyzing: false });
    }
  },

  addMaterials: async (files) => {
    if (files.length === 0) return;
    set({ uploading: true });
    try {
      const { materials, warnings } = await uploadMaterialsApi(files, get().product);
      set({ materials, mode: 'live', warnings: warnings ?? [] });
    } catch {
      // Fallback: synthesize material cards from the file list.
      const existing = get().materials;
      const synthesized: Material[] = files.map((f, i) => ({
        id: `u${existing.length + i + 1}`,
        kind: f.type.startsWith('image') || /\.(png|jpe?g|webp)$/i.test(f.name) ? 'photo' : 'text',
        subject: f.name.replace(/\.[^.]+$/, ''),
        slot: null,
        quality: 0.7,
        color: '#3d4a3a',
      }));
      set({ materials: [...existing, ...synthesized], mode: 'mock', warnings: [MOCK_NOTE] });
    } finally {
      set({ uploading: false });
    }
  },

  setSlot: (materialId, slot) =>
    set((state) => ({
      materials: state.materials.map((m) => (m.id === materialId ? { ...m, slot } : m)),
    })),

  applyAssignments: async (assignments) => {
    set({ matching: true });
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
    } catch {
      set({ materials: local, mode: 'mock', warnings: [MOCK_NOTE] });
    } finally {
      set({ matching: false });
    }
  },

  updateProduct: (product) => set({ product }),

  runDiagnosis: async () => {
    set({ diagnosing: true });
    try {
      const { diagnosis, warnings } = await diagnoseApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        product: get().product,
      });
      set({ diagnosis, mode: 'live', warnings: warnings ?? [] });
    } catch {
      set({ diagnosis: SLOT_DIAGNOSIS, mode: 'mock', warnings: [MOCK_NOTE] });
    } finally {
      set({ diagnosing: false });
    }
  },

  applyStrategy: async (slotId) => {
    // Mark applied immediately for responsiveness.
    set((state) => ({ appliedSlots: { ...state.appliedSlots, [slotId]: true } }));
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
    } catch {
      set({ mode: 'mock', warnings: [MOCK_NOTE] });
    }
  },

  selectVersion: (selectedVersionId) => set({ selectedVersionId, timeline: null }),

  compile: async () => {
    set({ compiling: true });
    try {
      const { version, timeline, warnings } = await compileApi({
        sourceVideo: get().sourceVideo,
        materials: get().materials,
        diagnosis: get().diagnosis,
        versionId: get().selectedVersionId,
      });
      set({ timeline, selectedVersionId: version.id, mode: 'live', warnings: warnings ?? [] });
    } catch {
      set({ timeline: deriveTimeline(get().sourceVideo, get().diagnosis), mode: 'mock', warnings: [MOCK_NOTE] });
    } finally {
      set({ compiling: false });
    }
  },

  applyNlEdit: async (instruction) => {
    set({ nlApplying: true });
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
    } catch {
      set({ timeline, mode: 'mock', warnings: [MOCK_NOTE] });
      return `已记录改片指令：${instruction}`;
    } finally {
      set({ nlApplying: false });
    }
  },

  exportVideo: async (format) => {
    set({ exporting: true });
    const timeline = get().timeline ?? deriveTimeline(get().sourceVideo, get().diagnosis);
    try {
      const result = await exportApi({ versionId: get().selectedVersionId, format, timeline });
      set({ exportResult: result, mode: 'live', warnings: result.warnings ?? [] });
      return result;
    } catch {
      const result: ExportResult = { jobId: `mock-${Date.now()}`, status: 'done', progress: 100 };
      set({ exportResult: result, mode: 'mock', warnings: [MOCK_NOTE] });
      return result;
    } finally {
      set({ exporting: false });
    }
  },

  reset: () => set({ ...initialState }),
}));
