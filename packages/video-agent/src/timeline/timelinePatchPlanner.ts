import type { TimelineItem } from '@viral-struct/shared';

export interface TimelinePatchPlan {
  instruction: string;
  affectedItemIds: string[];
  reason: string;
}

export function createNoopTimelinePatchPlan(
  instruction: string,
  timeline: TimelineItem[]
): TimelinePatchPlan {
  return {
    instruction,
    affectedItemIds: timeline.map((item) => item.id),
    reason: 'Placeholder patch plan for future natural-language timeline editing.'
  };
}
