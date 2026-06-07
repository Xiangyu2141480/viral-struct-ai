import type { RenderInput, RenderSegment } from './RenderContract';

export interface RenderTrackSlice {
  startMs: number;
  endMs: number;
  background: string;
  sourceSegmentId: string;
  unresolvedEvidence: boolean;
  captionLines: string[];
  label: string;
  /** Carried from the active segment so the renderer can style cards (title/CTA/...) distinctly. */
  cardType?: string;
  captionStyle?: string;
  segmentRole?: string;
}

/**
 * Flatten the (possibly overlapping) item segments into a SINGLE non-overlapping track covering
 * [0, totalDurationMs). Overlaps resolve last-defined-wins (paint order); gaps fill black.
 *
 * This is the fix for the renderer↔timeline mismatch: items carry real start/end POSITIONS (and the
 * timeline generator may stamp several items with the same segment bounds). Rendering must therefore
 * place segments on a timeline of length = span (max end), NOT concatenate item lengths end-to-end —
 * otherwise overlapping items inflate the encoded duration far beyond the timeline span.
 */
export function buildRenderTrack(input: RenderInput): RenderTrackSlice[] {
  const { segments, totalDurationMs } = input;
  if (segments.length === 0 || totalDurationMs <= 0) return [];

  const points = new Set<number>([0, totalDurationMs]);
  for (const segment of segments) {
    if (segment.startMs >= 0 && segment.startMs <= totalDurationMs) points.add(segment.startMs);
    if (segment.endMs >= 0 && segment.endMs <= totalDurationMs) points.add(segment.endMs);
  }
  const ordered = Array.from(points).sort((a, b) => a - b);

  const slices: RenderTrackSlice[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i]!;
    const end = ordered[i + 1]!;
    if (end <= start) continue;

    let active: RenderSegment | undefined;
    for (const segment of segments) {
      if (segment.startMs <= start && segment.endMs >= end) active = segment; // last by index wins
    }

    if (active) {
      slices.push({
        startMs: start,
        endMs: end,
        background: active.background,
        sourceSegmentId: active.id,
        unresolvedEvidence: active.unresolvedEvidence,
        captionLines: active.captionLines,
        label: active.label,
        cardType: active.cardType,
        captionStyle: active.captionStyle,
        segmentRole: active.segmentRole
      });
    } else {
      slices.push({ startMs: start, endMs: end, background: '0x000000', sourceSegmentId: '__gap__', unresolvedEvidence: false, captionLines: [], label: 'gap' });
    }
  }

  // Merge adjacent slices that resolve to the same source segment.
  const merged: RenderTrackSlice[] = [];
  for (const slice of slices) {
    const last = merged[merged.length - 1];
    if (last && last.sourceSegmentId === slice.sourceSegmentId && last.endMs === slice.startMs) {
      last.endMs = slice.endMs;
    } else {
      merged.push({ ...slice });
    }
  }
  return merged;
}
