import type { TimelineItem } from '@viral-struct/shared';
import {
  DEFAULT_PROFILE,
  type RenderInput,
  type RenderProfile,
  type RenderSegment,
  type RenderSegmentSource
} from './RenderContract';

export interface CompileOptions {
  profile?: RenderProfile;
  /** Slots the agent marked resolutionStatus:'unresolved' (honest substitutes for missing evidence). */
  unresolvedSlotIds?: string[];
}

// Deterministic background colour per structural role — purely so the skeleton render is visually legible.
const BACKGROUND_BY_ROLE: Record<string, string> = {
  hook: '0x1a1a2e',
  pain_point: '0x16213e',
  selling_point: '0x0f3460',
  proof: '0x533483',
  usage: '0x1b4965',
  comparison: '0x5c3d2e',
  cta: '0xe94560'
};

/**
 * The agent's final deterministic output step: TimelineItem[] -> renderer-neutral RenderInput.
 * Pure (no IO, no clock, no randomness) so the same timeline always compiles to the same input.
 */
export function compileTimelineToRenderInput(timeline: TimelineItem[], options: CompileOptions = {}): RenderInput {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const unresolved = new Set(options.unresolvedSlotIds ?? []);

  const segments: RenderSegment[] = timeline.map((item, index) => {
    const startMs = Math.round(item.start * 1000);
    const endMs = Math.round(item.end * 1000);
    const isUnresolved = unresolved.has(item.slotId);
    const source: RenderSegmentSource = isUnresolved ? 'substitute' : item.assetId ? 'asset' : 'card';
    return {
      id: item.id || `seg_${index + 1}`,
      slotId: item.slotId,
      startMs,
      endMs,
      source,
      assetId: item.assetId,
      cardType: item.packaging?.cardType,
      captionLines: item.subtitles ?? [],
      background: BACKGROUND_BY_ROLE[item.segmentRole] ?? '0x222222',
      transition: item.packaging?.transition,
      unresolvedEvidence: isUnresolved,
      label: `${item.segmentRole}:${source}`
    };
  });

  const totalDurationMs = segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
  return { profile, segments, totalDurationMs };
}
