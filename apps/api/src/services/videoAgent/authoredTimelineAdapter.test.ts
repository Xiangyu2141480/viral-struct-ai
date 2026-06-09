import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthoredTimeline } from '@viral-struct/shared';
import { authoredTimelineToTimelineItems } from './authoredTimelineAdapter';

function fixture(): AuthoredTimeline {
  return {
    schemaVersion: '1.0',
    renderProfile: { width: 1080, height: 1920, fps: 30, format: 'mp4' },
    beats: [
      {
        id: 'beat_1',
        segmentRole: 'hook',
        startSeconds: 0,
        endSeconds: 2.5,
        mediaLayers: [
          {
            id: 'media_1',
            media: { id: 'asset_a', type: 'image', assetId: 'a', resolvedPath: '/abs/a.png' },
            fit: 'cover',
            zOrder: 0,
            opacity: 1,
            motion: { kind: 'ken_burns', keyframes: [{ progress: 0, scale: 1, x: 0, y: 0 }, { progress: 1, scale: 1.1, x: 0, y: 0 }] },
            evidence: { tier: 'real', sourceAssetId: 'a' }
          }
        ],
        textElements: [
          { id: 'text_1', type: 'headline', content: ['新品上市'], stylePreset: 'bold_pop_center', zOrder: 10 }
        ],
        transitionOut: { kind: 'zoom' }
      },
      {
        id: 'beat_2',
        segmentRole: 'proof',
        startSeconds: 2.5,
        endSeconds: 5,
        mediaLayers: [],
        textElements: [
          { id: 'text_2', type: 'body', content: ['卖点一', '卖点二'], stylePreset: 'clean_lower_third', zOrder: 10 }
        ],
        // real-proof slot with no real asset → honest substitute
        unresolvedReason: 'real-proof slot has no matching real asset'
      }
    ],
    meta: { beatCount: 2, productName: '某产品' }
  } as AuthoredTimeline;
}

test('adapter maps one TimelineItem per beat, preserving timing + role', () => {
  const items = authoredTimelineToTimelineItems(fixture());
  assert.equal(items.length, 2);
  assert.equal(items[0]!.id, 'beat_1');
  assert.equal(items[0]!.start, 0);
  assert.equal(items[0]!.end, 2.5);
  assert.equal(items[0]!.segmentRole, 'hook');
  assert.equal(items[1]!.segmentRole, 'proof');
});

test('adapter carries the matched real asset id and maps motion/transition packaging', () => {
  const [hook] = authoredTimelineToTimelineItems(fixture());
  assert.equal(hook!.assetId, 'a');
  assert.equal(hook!.packaging.motion, 'crop_zoom'); // ken_burns → crop_zoom
  assert.equal(hook!.packaging.transition, 'zoom_in'); // zoom → zoom_in
  assert.equal(hook!.script, '新品上市');
  assert.ok(hook!.visualAction.includes('real image asset a'));
});

test('adapter marks an unresolved beat as an honest substitute (no fabricated asset)', () => {
  const items = authoredTimelineToTimelineItems(fixture());
  const proof = items[1]!;
  assert.equal(proof.assetId, undefined);
  assert.deepEqual(proof.subtitles, ['卖点一', '卖点二']);
  assert.ok(proof.visualAction.includes('honest substitute'));
});
