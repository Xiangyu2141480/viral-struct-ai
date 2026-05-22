'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { VideoAnalysis, ViralStructureGraph } from '@viral-struct/shared';

export type StructureStatus = 'idle' | 'extracting' | 'ready' | 'fallback' | 'error';

export interface StructureDebug {
  fallbackUsed: boolean;
  segmentCount: number;
  evidenceCount: number;
  warnings: string[];
}

interface WorkflowState {
  videoAnalysis: VideoAnalysis | null;
  structureGraph: ViralStructureGraph | null;
  structureStatus: StructureStatus;
  structureError: string | null;
  structureDebug: StructureDebug | null;
  setVideoAnalysis: (videoAnalysis: VideoAnalysis) => void;
  setStructureGraph: (structureGraph: ViralStructureGraph, debug?: StructureDebug) => void;
  setStructureExtracting: () => void;
  setStructureError: (message: string) => void;
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
      setVideoAnalysis: (videoAnalysis) => set({
        videoAnalysis,
        structureGraph: null,
        structureStatus: 'idle',
        structureError: null,
        structureDebug: null
      }),
      setStructureGraph: (structureGraph, debug) => set({
        structureGraph,
        structureStatus: debug?.fallbackUsed ? 'fallback' : 'ready',
        structureError: null,
        structureDebug: debug ?? null
      }),
      setStructureExtracting: () => set({ structureStatus: 'extracting', structureError: null }),
      setStructureError: (message) => set({ structureStatus: 'error', structureError: message }),
      resetWorkflow: () => set({
        videoAnalysis: null,
        structureGraph: null,
        structureStatus: 'idle',
        structureError: null,
        structureDebug: null
      })
    }),
    {
      name: 'viral-struct-ai-workflow',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
