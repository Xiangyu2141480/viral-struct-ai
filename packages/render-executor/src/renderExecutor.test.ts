import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineItem } from '@viral-struct/shared';
import { compileTimelineToRenderInput } from './compileRenderInput';
import { ManifestRenderExecutor } from './manifestExecutor';

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
