import type {
  AuthoredComposition,
  AuthoredTimeline,
  MediaLayer,
  SegmentRole,
  TimelineItem
} from '@viral-struct/shared';
import { beatIsUnresolved } from '@viral-struct/shared';

/**
 * Adapter: ③ video-agent `AuthoredTimeline` → ①-era `TimelineItem[]`.
 *
 * The migration makes ③ the timeline engine, but a few still-useful ①-era consumers eat the flat
 * `TimelineItem[]` shape — transition recipes, the audio plan, and quality evaluation. Rather than rewrite
 * those, this adapter projects ③'s authored beats onto `TimelineItem`. It is a GRANULARITY CHANGE, not a
 * 1:1 map: ③ authors one beat per segment, so the result is per-segment (coarser than the old per-slot
 * timeline). `AuthoredSegmentRole` and `SegmentRole` share identical values, so the role maps directly.
 *
 * This carries no creative authority — ③ already authored the cut; the adapter only re-expresses it so the
 * deterministic transition/audio/quality passes keep working off a single source of truth.
 */

// ③ BeatTransitionSpec.kind → ① packaging.transition
const TRANSITION_MAP: Record<string, NonNullable<TimelineItem['packaging']['transition']>> = {
  cut: 'quick_cut',
  fade: 'fade',
  slide: 'push',
  zoom: 'zoom_in',
  dip: 'fade'
};

// ③ MotionKind → ① packaging.motion
const MOTION_MAP: Record<string, NonNullable<TimelineItem['packaging']['motion']>> = {
  static: 'static',
  ken_burns: 'crop_zoom',
  crop_zoom: 'crop_zoom',
  pan: 'pan',
  push_in: 'push_in',
  pop_scale: 'crop_zoom',
  custom: 'static'
};

export function authoredTimelineToTimelineItems(timeline: AuthoredTimeline): TimelineItem[] {
  return timeline.beats.map((beat) => beatToTimelineItem(beat));
}

function beatToTimelineItem(beat: AuthoredComposition): TimelineItem {
  const primaryMedia = beat.mediaLayers.find((layer) => layer.media.resolvedPath) ?? beat.mediaLayers[0];
  const textLines = beat.textElements.flatMap((text) => text.content).filter(Boolean);
  const headline = beat.textElements.find((text) => text.type === 'headline')?.content.join(' ');
  const transitionKind = beat.transitionOut?.kind;
  const motionKind = primaryMedia?.motion?.kind;

  return {
    id: beat.id,
    start: beat.startSeconds,
    end: beat.endSeconds,
    // AuthoredSegmentRole and SegmentRole are value-identical unions.
    segmentRole: beat.segmentRole as SegmentRole,
    // ③ beats are per-segment and carry no separate slot/segment id; the beat id is the stable handle.
    sourceSegmentId: beat.id,
    slotId: beat.id,
    assetId: primaryMedia?.media.assetId,
    script: headline ?? textLines.join(' '),
    subtitles: textLines,
    visualAction: describeBeatVisual(beat, primaryMedia),
    packaging: {
      captionStyle: beat.textElements[0]?.stylePreset ?? 'clean_lower_third',
      transition: transitionKind ? TRANSITION_MAP[transitionKind] : undefined,
      motion: motionKind ? MOTION_MAP[motionKind] : undefined
    }
  };
}

function describeBeatVisual(beat: AuthoredComposition, primaryMedia: MediaLayer | undefined): string {
  if (beatIsUnresolved(beat)) return 'honest substitute card (missing real evidence)';
  if (primaryMedia?.media.resolvedPath) {
    const motion = primaryMedia.motion?.kind && primaryMedia.motion.kind !== 'static' ? ` with ${primaryMedia.motion.kind} motion` : '';
    return `composite real ${primaryMedia.media.type} asset ${primaryMedia.media.assetId}${motion}`;
  }
  return 'text / colour card';
}
