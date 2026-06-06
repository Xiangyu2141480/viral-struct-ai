import type { TimelineItem } from '@viral-struct/shared';

export interface StructureFidelityReport {
  itemCount: number;
  totalDurationMs: number;
  segmentRoleSequence: string[];
}

export function summarizeTimelineStructure(timeline: TimelineItem[]): StructureFidelityReport {
  return {
    itemCount: timeline.length,
    totalDurationMs: timeline.reduce((sum, item) => sum + Math.max(0, item.end - item.start) * 1000, 0),
    segmentRoleSequence: timeline.map((item) => item.segmentRole)
  };
}
