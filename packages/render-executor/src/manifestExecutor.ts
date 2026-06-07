import { createHash } from 'node:crypto';
import type { RenderExecutor, RenderInput, RenderResult, RenderSegmentManifestEntry } from './RenderContract';
import { buildRenderTrack } from './renderTrack';

/**
 * Deterministic, pixel-free executor: produces an honest render PLAN (frame counts, durations, hash)
 * WITHOUT encoding video. rendered=false makes the absence of pixels explicit (Honesty invariant), so a
 * caller can never mistake a plan for a finished 成片. Used for tests and pixel-less environments.
 */
export class ManifestRenderExecutor implements RenderExecutor {
  readonly name = 'manifest';

  async render(input: RenderInput): Promise<RenderResult> {
    const fps = input.profile.fps;
    const manifest: RenderSegmentManifestEntry[] = input.segments.map((segment) => ({
      id: segment.id,
      slotId: segment.slotId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      frames: framesFor(segment.startMs, segment.endMs, fps),
      source: segment.source,
      unresolvedEvidence: segment.unresolvedEvidence,
      label: segment.label
    }));

    // Frame count reflects the actual rendered track (timeline span), not the sum of overlapping items.
    const track = buildRenderTrack(input);
    const frameCount = track.reduce((sum, slice) => sum + framesFor(slice.startMs, slice.endMs, fps), 0);
    const unresolvedSegmentIds = input.segments.filter((segment) => segment.unresolvedEvidence).map((segment) => segment.id);
    const contentHash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);

    return {
      ok: true,
      rendered: false,
      executor: this.name,
      format: input.profile.format,
      durationMs: input.totalDurationMs,
      frameCount,
      segmentCount: input.segments.length,
      unresolvedSegmentIds,
      manifest,
      contentHash,
      warnings: input.segments.length === 0 ? ['empty timeline: no segments to render'] : []
    };
  }
}

export function framesFor(startMs: number, endMs: number, fps: number): number {
  return Math.max(0, Math.round(((endMs - startMs) / 1000) * fps));
}
