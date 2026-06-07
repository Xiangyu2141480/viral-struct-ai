import type { TimelineItem } from '@viral-struct/shared';
import type { GapFillPlan } from '../gap-fill/GapFillPlan';

export interface TimelineCompilerInput {
  timeline: TimelineItem[];
  gapFillPlans: GapFillPlan[];
}
