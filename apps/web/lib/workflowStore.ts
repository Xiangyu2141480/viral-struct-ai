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

const defaultContentBrief: ContentBrief = {
  productName: '便携咖啡杯',
  targetAudience: '通勤上班族',
  scenario: '早高峰通勤路上',
  sellingPoints: ['保温 8 小时', '倒置不漏', '单手开盖'],
  cta: '通勤党想喝热咖啡，就选它。',
  stylePreference: '高点击、快节奏、清晰卖点卡'
};

interface GenerationResult {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}

interface WorkflowState {
  videoAnalysis: VideoAnalysis | null;
  structureGraph: ViralStructureGraph | null;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  qualityReport: QualityReport | null;
  setVideoAnalysis: (videoAnalysis: VideoAnalysis) => void;
  setStructureGraph: (structureGraph: ViralStructureGraph) => void;
  setContentBrief: (contentBrief: ContentBrief) => void;
  setAssetCards: (assetCards: AssetCard[]) => void;
  setSlotResult: (slotMatches: SlotMatch[], materialGaps: MaterialGap[]) => void;
  setRepairs: (repairs: GapRepair[]) => void;
  setGenerationResult: (result: GenerationResult) => void;
  setQualityReport: (qualityReport: QualityReport) => void;
  resetWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set) => ({
      videoAnalysis: null,
      structureGraph: null,
      contentBrief: defaultContentBrief,
      assetCards: [],
      slotMatches: [],
      materialGaps: [],
      repairs: [],
      script: [],
      storyboard: [],
      timeline: [],
      qualityReport: null,
      setVideoAnalysis: (videoAnalysis) =>
        set({
          videoAnalysis,
          structureGraph: null,
          assetCards: [],
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
        }),
      setStructureGraph: (structureGraph) =>
        set({
          structureGraph,
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
        }),
      setContentBrief: (contentBrief) =>
        set({
          contentBrief,
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
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
          qualityReport: null
        }),
      setSlotResult: (slotMatches, materialGaps) =>
        set({
          slotMatches,
          materialGaps,
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
        }),
      setRepairs: (repairs) =>
        set({
          repairs,
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
        }),
      setGenerationResult: ({ script, storyboard, timeline }) =>
        set({
          script,
          storyboard,
          timeline,
          qualityReport: null
        }),
      setQualityReport: (qualityReport) => set({ qualityReport }),
      resetWorkflow: () =>
        set({
          videoAnalysis: null,
          structureGraph: null,
          contentBrief: defaultContentBrief,
          assetCards: [],
          slotMatches: [],
          materialGaps: [],
          repairs: [],
          script: [],
          storyboard: [],
          timeline: [],
          qualityReport: null
        })
    }),
    {
      name: 'viral-struct-ai-workflow',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
