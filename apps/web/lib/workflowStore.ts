'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { VideoAnalysis, ViralStructureGraph } from '@viral-struct/shared';

interface WorkflowState {
  videoAnalysis: VideoAnalysis | null;
  structureGraph: ViralStructureGraph | null;
  setVideoAnalysis: (videoAnalysis: VideoAnalysis) => void;
  setStructureGraph: (structureGraph: ViralStructureGraph) => void;
  resetWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set) => ({
      videoAnalysis: null,
      structureGraph: null,
      setVideoAnalysis: (videoAnalysis) => set({ videoAnalysis, structureGraph: null }),
      setStructureGraph: (structureGraph) => set({ structureGraph }),
      resetWorkflow: () => set({ videoAnalysis: null, structureGraph: null })
    }),
    {
      name: 'viral-struct-ai-workflow',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
