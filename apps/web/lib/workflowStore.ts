'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AssetCard,
  ContentBrief,
  DemoEstimate,
  GapRepair,
  GapSpecSource,
  MaterialGap,
  MissingMaterialGenerationJob,
  QualityReport,
  ScriptSegment,
  ScriptSource,
  SlotAlignmentSource,
  SlotMatch,
  StoryboardFrame,
  StoryboardShot,
  TimelineItem,
  VideoAnalysis,
  ViralStructureGraph
} from '@viral-struct/shared';

export type StructureStatus = 'idle' | 'extracting' | 'ready' | 'fallback' | 'error';
export type GenerationVariant = 'high_click' | 'high_conversion' | 'premium';
export type AssetSourceKind = 'asset_library' | 'upload_analysis' | 'demo_fallback';
export type TimelineEditType =
  | 'hook_stronger'
  | 'product_info_earlier'
  | 'reduce_subtitles'
  | 'increase_rhythm'
  | 'stronger_cta'
  | 'combined'
  | 'unsupported';

export interface StructureDebug {
  fallbackUsed: boolean;
  extractionSource?: 'rough_fine_scan_artifact' | 'video_analysis_rules' | 'mock_fallback';
  segmentCount: number;
  evidenceCount: number;
  warnings: string[];
}

export interface AssetSourceDebug {
  source: AssetSourceKind;
  libraryId?: string;
  label: string;
}

interface GenerationResult {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}

export interface PipelineTrace {
  alignmentSource?: SlotAlignmentSource;
  gapSpecSource?: GapSpecSource;
  scriptSource?: ScriptSource;
  warnings: string[];
}

export interface TimelineEditChangedItem {
  itemId: string;
  changes: string[];
  before: TimelineItem;
  after: TimelineItem;
}

export interface TimelineEditResult {
  updatedTimeline: TimelineItem[];
  patchSummary: string;
  changedItems: TimelineEditChangedItem[];
  editType: TimelineEditType;
  appliedEditTypes: TimelineEditType[];
  rationale: string;
  warnings: string[];
  supportedEditSuggestions: string[];
}

export type TimelineEditSummaryState = Omit<TimelineEditResult, 'updatedTimeline'>;

const defaultContentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤和校园人群',
  scenario: '午后高温、运动后或饭后解腻',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶畅饮', '冷藏口感更好'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
  stylePreference: '清爽夏日、高点击、快节奏、红色卖点卡'
};

interface WorkflowState {
  videoAnalysis: VideoAnalysis | null;
  structureGraph: ViralStructureGraph | null;
  structureStatus: StructureStatus;
  structureError: string | null;
  structureDebug: StructureDebug | null;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  assetSourceDebug: AssetSourceDebug | null;
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  storyboardFrames: StoryboardFrame[];
  storyboardFrameWarnings: string[];
  missingMaterialJobs: MissingMaterialGenerationJob[];
  missingMaterialJobWarnings: string[];
  timeline: TimelineItem[];
  qualityReport: QualityReport | null;
  demoEstimate: DemoEstimate | null;
  pipelineTrace: PipelineTrace;
  generationVariant: GenerationVariant;
  timelineEditSummary: TimelineEditSummaryState | null;
  editNotes: string[];
  setVideoAnalysis: (videoAnalysis: VideoAnalysis) => void;
  setStructureGraph: (structureGraph: ViralStructureGraph, debug?: StructureDebug) => void;
  setStructureExtracting: () => void;
  setStructureError: (message: string) => void;
  setContentBrief: (contentBrief: ContentBrief) => void;
  setAssetCards: (assetCards: AssetCard[], assetSourceDebug?: AssetSourceDebug) => void;
  setSlotResult: (slotMatches: SlotMatch[], materialGaps: MaterialGap[], trace?: Partial<PipelineTrace>) => void;
  setRepairs: (repairs: GapRepair[], trace?: Partial<PipelineTrace>) => void;
  setGenerationResult: (result: GenerationResult, trace?: Partial<PipelineTrace>) => void;
  setStoryboardFrames: (frames: StoryboardFrame[], warnings?: string[]) => void;
  setMissingMaterialJobs: (jobs: MissingMaterialGenerationJob[], warnings?: string[]) => void;
  applyTimelineEditResult: (result: TimelineEditResult) => void;
  setQualityReport: (qualityReport: QualityReport) => void;
  setDemoEstimate: (demoEstimate: DemoEstimate | null) => void;
  setGenerationVariant: (variant: GenerationVariant) => void;
  resetWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set) => ({
      videoAnalysis: null,
      structureGraph: null,
      structureStatus: 'idle',
      structureError: null,
      structureDebug: null,
      contentBrief: defaultContentBrief,
      assetCards: [],
      assetSourceDebug: null,
      slotMatches: [],
      materialGaps: [],
      repairs: [],
      script: [],
      storyboard: [],
      storyboardFrames: [],
      storyboardFrameWarnings: [],
      missingMaterialJobs: [],
      missingMaterialJobWarnings: [],
      timeline: [],
      qualityReport: null,
      demoEstimate: null,
      pipelineTrace: emptyPipelineTrace(),
      generationVariant: 'high_click',
      timelineEditSummary: null,
      editNotes: [],
      setVideoAnalysis: (videoAnalysis) =>
        set({
          videoAnalysis,
          structureGraph: null,
          structureStatus: 'idle',
          structureError: null,
          structureDebug: null,
          assetCards: [],
          assetSourceDebug: null,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: emptyPipelineTrace(),
          timelineEditSummary: null,
          editNotes: []
        }),
      setStructureGraph: (structureGraph, debug) =>
        set({
          structureGraph,
          structureStatus: debug?.fallbackUsed ? 'fallback' : 'ready',
          structureError: null,
          structureDebug: debug ?? null,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: emptyPipelineTrace(),
          timelineEditSummary: null,
          editNotes: []
        }),
      setStructureExtracting: () => set({ structureStatus: 'extracting', structureError: null }),
      setStructureError: (message) => set({ structureStatus: 'error', structureError: message }),
      setContentBrief: (contentBrief) =>
        set({
          contentBrief,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: emptyPipelineTrace(),
          timelineEditSummary: null,
          editNotes: []
        }),
      setAssetCards: (assetCards, assetSourceDebug) =>
        set({
          assetCards,
          assetSourceDebug: assetSourceDebug ?? null,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: emptyPipelineTrace(),
          timelineEditSummary: null,
          editNotes: []
        }),
      setSlotResult: (slotMatches, materialGaps, trace) =>
        set({
          slotMatches,
          materialGaps,
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: mergePipelineTrace(emptyPipelineTrace(), trace),
          timelineEditSummary: null,
          editNotes: []
        }),
      setRepairs: (repairs, trace) =>
        set((state) => ({
          repairs,
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: mergePipelineTrace(state.pipelineTrace, trace),
          timelineEditSummary: null,
          editNotes: []
        })),
      setGenerationResult: ({ script, storyboard, timeline }, trace) =>
        set((state) => ({
          script,
          storyboard,
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline,
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: mergePipelineTrace(state.pipelineTrace, trace),
          timelineEditSummary: null,
          editNotes: []
        })),
      setStoryboardFrames: (storyboardFrames, storyboardFrameWarnings) =>
        set({
          storyboardFrames,
          storyboardFrameWarnings: storyboardFrameWarnings ?? []
        }),
      setMissingMaterialJobs: (missingMaterialJobs, missingMaterialJobWarnings) =>
        set({
          missingMaterialJobs,
          missingMaterialJobWarnings: missingMaterialJobWarnings ?? []
        }),
      applyTimelineEditResult: ({ updatedTimeline, ...summary }) =>
        set((state) => ({
          timeline: updatedTimeline,
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          qualityReport: null,
          demoEstimate: null,
          timelineEditSummary: summary,
          editNotes: [`自然语言改片：${summary.patchSummary}`, ...state.editNotes]
        })),
      setQualityReport: (qualityReport) => set({ qualityReport }),
      setDemoEstimate: (demoEstimate) => set({ demoEstimate }),
      setGenerationVariant: (generationVariant) =>
        set((state) => ({
          generationVariant,
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          missingMaterialJobs: [],
          missingMaterialJobWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: clearGenerationTrace(state.pipelineTrace),
          timelineEditSummary: null,
          editNotes: []
        })),
      resetWorkflow: () =>
        set({
          videoAnalysis: null,
          structureGraph: null,
          structureStatus: 'idle',
          structureError: null,
          structureDebug: null,
          contentBrief: defaultContentBrief,
          assetCards: [],
          assetSourceDebug: null,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          storyboardFrames: [],
          storyboardFrameWarnings: [],
          timeline: [],
          qualityReport: null,
          demoEstimate: null,
          pipelineTrace: emptyPipelineTrace(),
          generationVariant: 'high_click',
          timelineEditSummary: null,
          editNotes: []
        })
    }),
    {
      name: 'viral-struct-ai-workflow',
      storage: createJSONStorage(() => localStorage)
    }
  )
);

function emptyPipelineTrace(): PipelineTrace {
  return { warnings: [] };
}

function mergePipelineTrace(current: PipelineTrace, next?: Partial<PipelineTrace>): PipelineTrace {
  if (!next) return current;
  const warnings = [...current.warnings, ...(next.warnings ?? [])].filter(Boolean);
  return {
    alignmentSource: next.alignmentSource ?? current.alignmentSource,
    gapSpecSource: next.gapSpecSource ?? current.gapSpecSource,
    scriptSource: next.scriptSource ?? current.scriptSource,
    warnings: Array.from(new Set(warnings))
  };
}

function clearGenerationTrace(current: PipelineTrace): PipelineTrace {
  return {
    alignmentSource: current.alignmentSource,
    gapSpecSource: current.gapSpecSource,
    warnings: current.warnings
  };
}
