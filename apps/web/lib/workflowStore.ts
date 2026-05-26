'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  QualityReport,
  ScriptSegment,
  SlotMatch,
  StoryboardShot,
  TimelineItem,
  VideoAnalysis,
  ViralStructureGraph
} from '@viral-struct/shared';

export type StructureStatus = 'idle' | 'extracting' | 'ready' | 'fallback' | 'error';
export type GenerationVariant = 'high_click' | 'high_conversion' | 'premium';

export interface StructureDebug {
  fallbackUsed: boolean;
  segmentCount: number;
  evidenceCount: number;
  warnings: string[];
}

interface GenerationResult {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}

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
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  qualityReport: QualityReport | null;
  generationVariant: GenerationVariant;
  editNotes: string[];
  setVideoAnalysis: (videoAnalysis: VideoAnalysis) => void;
  setStructureGraph: (structureGraph: ViralStructureGraph, debug?: StructureDebug) => void;
  setStructureExtracting: () => void;
  setStructureError: (message: string) => void;
  setContentBrief: (contentBrief: ContentBrief) => void;
  setAssetCards: (assetCards: AssetCard[]) => void;
  setSlotResult: (slotMatches: SlotMatch[], materialGaps: MaterialGap[]) => void;
  setRepairs: (repairs: GapRepair[]) => void;
  setGenerationResult: (result: GenerationResult) => void;
  setQualityReport: (qualityReport: QualityReport) => void;
  setGenerationVariant: (variant: GenerationVariant) => void;
  applyLocalEdit: (instruction: string) => void;
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
      slotMatches: [],
      materialGaps: [],
      repairs: [],
      script: [],
      storyboard: [],
      timeline: [],
      qualityReport: null,
      generationVariant: 'high_click',
      editNotes: [],
      setVideoAnalysis: (videoAnalysis) =>
        set({
          videoAnalysis,
          structureGraph: null,
          structureStatus: 'idle',
          structureError: null,
          structureDebug: null,
          assetCards: [],
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
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
          timeline: [],
          qualityReport: null,
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
          timeline: [],
          qualityReport: null,
          editNotes: []
        }),
      setAssetCards: (assetCards) =>
        set({
          assetCards,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
          editNotes: []
        }),
      setSlotResult: (slotMatches, materialGaps) =>
        set({
          slotMatches,
          materialGaps,
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
          editNotes: []
        }),
      setRepairs: (repairs) =>
        set({
          repairs,
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
          editNotes: []
        }),
      setGenerationResult: ({ script, storyboard, timeline }) =>
        set({
          script,
          storyboard,
          timeline,
          qualityReport: null,
          editNotes: []
        }),
      setQualityReport: (qualityReport) => set({ qualityReport }),
      setGenerationVariant: (generationVariant) =>
        set({
          generationVariant,
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
          editNotes: []
        }),
      applyLocalEdit: (instruction) =>
        set((state) => {
          const normalized = instruction.trim();
          if (!normalized) {
            return state;
          }

          const timeline = state.timeline.map((item, index) => {
            if (normalized.includes('开头') && index === 0) {
              return {
                ...item,
                script: `${item.script} 先用更强标题抓住注意。`,
                packaging: { ...item.packaging, transition: 'zoom_in' as const, motion: 'push_in' as const }
              };
            }

            if (normalized.includes('商品') && item.segmentRole === 'selling_point') {
              return { ...item, script: `${state.contentBrief.productName}：${state.contentBrief.sellingPoints[0] ?? item.script}` };
            }

            if (normalized.includes('节奏')) {
              return { ...item, packaging: { ...item.packaging, transition: 'quick_cut' as const } };
            }

            return item;
          });

          return {
            timeline,
            editNotes: [`自然语言调整：${normalized}`, ...state.editNotes]
          };
        }),
      resetWorkflow: () =>
        set({
          videoAnalysis: null,
          structureGraph: null,
          structureStatus: 'idle',
          structureError: null,
          structureDebug: null,
          contentBrief: defaultContentBrief,
          assetCards: [],
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null,
          generationVariant: 'high_click',
          editNotes: []
        })
    }),
    {
      name: 'viral-struct-ai-workflow',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
