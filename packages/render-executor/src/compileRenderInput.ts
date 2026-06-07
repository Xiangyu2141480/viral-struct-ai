import { CARD_REGISTRY, isKnownCardType, type TimelineItem } from '@viral-struct/shared';
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

// Deterministic background colour per structural role — the legible fallback when a segment has no known
// cardType. When the agent DID select a known card, CARD_REGISTRY[cardType].background wins (so card types
// are visually distinct at a glance); this stays the role-based default for substitutes / cardless items.
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
 * Background precedence: a real asset/substitute keeps the role colour (the footage or honest-substitute
 * tone), but a pure CARD segment paints CARD_REGISTRY[cardType].background so title/selling-point/CTA cards
 * read differently. Unknown card ids fall back to the role colour (closed-vocabulary safety).
 */
function backgroundFor(source: RenderSegmentSource, cardType: string | undefined, segmentRole: string): string {
  if (source === 'card' && cardType && isKnownCardType(cardType)) return CARD_REGISTRY[cardType].background;
  return BACKGROUND_BY_ROLE[segmentRole] ?? '0x222222';
}

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
    const cardType = item.packaging?.cardType;
    return {
      id: item.id || `seg_${index + 1}`,
      slotId: item.slotId,
      startMs,
      endMs,
      source,
      assetId: item.assetId,
      cardType,
      captionStyle: item.packaging?.captionStyle,
      segmentRole: item.segmentRole,
      captionLines: item.subtitles ?? [],
      background: backgroundFor(source, cardType, item.segmentRole),
      transition: item.packaging?.transition,
      unresolvedEvidence: isUnresolved,
      label: `${item.segmentRole}:${source}`
    };
  });

  const totalDurationMs = segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
  return { profile, segments, totalDurationMs };
}
