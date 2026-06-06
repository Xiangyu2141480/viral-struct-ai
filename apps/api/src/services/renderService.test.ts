import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineItem } from '@viral-struct/shared';
import { ManifestRenderExecutor } from '@viral-struct/render-executor';
import { renderTimeline } from './renderService';

function makeTimeline(): TimelineItem[] {
  return [
    {
      id: 'i1', start: 0, end: 2, segmentRole: 'hook', sourceSegmentId: 's1', slotId: 'slot_a',
      script: 'open', subtitles: ['hi'], visualAction: 'grab', packaging: { captionStyle: 'bold' }
    },
    {
      id: 'i2', start: 2, end: 5, segmentRole: 'cta', sourceSegmentId: 's2', slotId: 'slot_b',
      script: 'buy', subtitles: ['buy now'], visualAction: 'close', packaging: { captionStyle: 'bold' }
    }
  ];
}

test('renderTimeline compiles the timeline and runs it through an injected executor (no ffmpeg)', async () => {
  const result = await renderTimeline({
    timeline: makeTimeline(),
    executorFactory: () => new ManifestRenderExecutor()
  });

  assert.equal(result.render.segmentCount, 2);
  assert.equal(result.render.durationMs, 5000);
  assert.equal(result.render.rendered, false); // manifest executor produces no pixels
  assert.equal(result.mediaUrl, null); // so no servable file URL
});

test('renderTimeline rejects an empty timeline', async () => {
  await assert.rejects(() => renderTimeline({ timeline: [], executorFactory: () => new ManifestRenderExecutor() }));
});
