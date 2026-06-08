import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineItem } from '@viral-struct/shared';
import { compileTimelineToRenderInput } from './compileRenderInput';
import { ManifestRenderExecutor } from './manifestExecutor';
import { buildRenderTrack } from './renderTrack';
import { computeVideoTrim } from './authoredFfmpegExecutor';

function makeTimeline(): TimelineItem[] {
  return [
    {
      id: 'i1',
      start: 0,
      end: 2,
      segmentRole: 'hook',
      sourceSegmentId: 's1',
      slotId: 'slot_a',
      script: 'open',
      subtitles: ['hi'],
      visualAction: 'grab attention',
      packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut' }
    },
    {
      id: 'i2',
      start: 2,
      end: 5,
      segmentRole: 'cta',
      sourceSegmentId: 's2',
      slotId: 'slot_b',
      assetId: 'asset_1',
      script: 'buy now',
      subtitles: ['buy now'],
      visualAction: 'close',
      packaging: { captionStyle: 'bold' }
    }
  ];
}

test('compiles a timeline to a renderer-neutral RenderInput deterministically', () => {
  const timeline = makeTimeline();
  const input = compileTimelineToRenderInput(timeline, { unresolvedSlotIds: ['slot_a'] });

  assert.equal(input.segments.length, 2);
  assert.equal(input.totalDurationMs, 5000);

  const first = input.segments[0];
  assert.equal(first?.startMs, 0);
  assert.equal(first?.endMs, 2000);
  assert.equal(first?.unresolvedEvidence, true);
  assert.equal(first?.source, 'substitute'); // unresolved evidence overrides asset/card source

  const second = input.segments[1];
  assert.equal(second?.source, 'asset'); // has an assetId and is not unresolved
  assert.equal(second?.unresolvedEvidence, false);

  // Pure function: identical inputs -> identical output (Determinism invariant).
  assert.deepEqual(compileTimelineToRenderInput(timeline, { unresolvedSlotIds: ['slot_a'] }), input);
});

test('manifest executor produces an honest, pixel-free render plan', async () => {
  const input = compileTimelineToRenderInput(makeTimeline(), { unresolvedSlotIds: ['slot_a'] });
  const result = await new ManifestRenderExecutor().render(input);

  assert.equal(result.ok, true);
  assert.equal(result.rendered, false); // honest: no pixels were produced
  assert.equal(result.segmentCount, 2);
  assert.equal(result.durationMs, 5000);
  assert.equal(result.frameCount, (2 + 3) * 30); // 5s at 30fps
  assert.deepEqual(result.unresolvedSegmentIds, ['i1']); // the substitute segment is surfaced for QualityReport
});

test('manifest render is hash-stable for the same input', async () => {
  const input = compileTimelineToRenderInput(makeTimeline());
  const a = await new ManifestRenderExecutor().render(input);
  const b = await new ManifestRenderExecutor().render(input);
  assert.equal(a.contentHash, b.contentHash);
});

test('an empty timeline yields a valid empty plan with a warning, not a crash', async () => {
  const input = compileTimelineToRenderInput([]);
  const result = await new ManifestRenderExecutor().render(input);
  assert.equal(result.segmentCount, 0);
  assert.equal(result.frameCount, 0);
  assert.ok(result.warnings.length > 0);
});

test('overlapping items flatten to one track whose duration is the span, not the sum (renderer↔timeline fix)', async () => {
  // 3 items share the same [0,4] segment bounds (as timelineGenerator stamps them) + 1 item [4,6].
  // Span = 6s. Naive concat would (wrongly) be 4+4+4+2 = 14s.
  const overlapping: TimelineItem[] = [
    { id: 'a1', start: 0, end: 4, segmentRole: 'hook', sourceSegmentId: 'seg1', slotId: 's1', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } },
    { id: 'a2', start: 0, end: 4, segmentRole: 'hook', sourceSegmentId: 'seg1', slotId: 's2', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } },
    { id: 'a3', start: 0, end: 4, segmentRole: 'hook', sourceSegmentId: 'seg1', slotId: 's3', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } },
    { id: 'b1', start: 4, end: 6, segmentRole: 'cta', sourceSegmentId: 'seg2', slotId: 's4', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } }
  ];
  const input = compileTimelineToRenderInput(overlapping);
  assert.equal(input.totalDurationMs, 6000); // span, not 14000

  const result = await new ManifestRenderExecutor().render(input);
  assert.equal(result.durationMs, 6000);
  // frame count must equal the SPAN (6s), not the overlapping sum (14s)
  assert.equal(result.frameCount, Math.round((6000 / 1000) * input.profile.fps));
  assert.equal(result.segmentCount, 4); // original items still accounted for in the manifest
});

test('buildRenderTrack tiles [0, span] exactly: collapses overlaps and fills gaps', () => {
  const withGap: TimelineItem[] = [
    { id: 'x1', start: 0, end: 2, segmentRole: 'hook', sourceSegmentId: 's', slotId: 'sa', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } },
    { id: 'x2', start: 3, end: 5, segmentRole: 'cta', sourceSegmentId: 's', slotId: 'sb', script: '', subtitles: [], visualAction: '', packaging: { captionStyle: 'b' } }
  ]; // gap from 2s to 3s
  const input = compileTimelineToRenderInput(withGap);
  const track = buildRenderTrack(input);

  const tiled = track.reduce((sum, slice) => sum + (slice.endMs - slice.startMs), 0);
  assert.equal(tiled, input.totalDurationMs); // non-overlapping, no gaps, exactly covers [0, span]
  assert.ok(track.some((slice) => slice.sourceSegmentId === '__gap__')); // the 2-3s gap is filled
});

// --- Video source-range trim math (the "honor endSec" seam) ---

test('computeVideoTrim: no range → read the whole beat from t=0, no pad', () => {
  assert.deepEqual(computeVideoTrim(3), { ss: 0, readDuration: 3, padDuration: 0 });
});

test('computeVideoTrim: a chosen sub-range ≥ the beat plays the beat from the in-point', () => {
  // clip [8,12] = 4s ≥ 3s beat → seek to 8, read 3s, no pad
  assert.deepEqual(computeVideoTrim(3, 8, 12), { ss: 8, readDuration: 3, padDuration: 0 });
});

test('computeVideoTrim: a sub-range shorter than the beat holds the last frame (tpad) for the remainder', () => {
  // clip [8,10] = 2s < 4s beat → read 2s, hold the last frame for the missing 2s
  const r = computeVideoTrim(4, 8, 10);
  assert.equal(r.ss, 8);
  assert.equal(r.readDuration, 2);
  assert.equal(Number(r.padDuration.toFixed(3)), 2);
});

test('computeVideoTrim: startSec only (no out-point) reads beat length from the in-point', () => {
  assert.deepEqual(computeVideoTrim(3, 5), { ss: 5, readDuration: 3, padDuration: 0 });
});
