import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetMediaProfile } from '@viral-struct/shared';
import { sliceVideoIntoSegments } from './videoSegmentSlicer';

function media(durationSec: number): AssetMediaProfile {
  return {
    kind: 'video',
    sourceUrl: '/media/fixtures/long.mp4',
    durationSec,
    fps: 30,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    keyframes: [
      { id: 'kf_1', timeSec: durationSec * 0.16, description: 'opening product motion', source: 'sampled_frame' },
      { id: 'kf_2', timeSec: durationSec * 0.33, description: 'product label closeup', source: 'sampled_frame' },
      { id: 'kf_3', timeSec: durationSec * 0.5, description: 'open cap and pour action', source: 'sampled_frame' },
      { id: 'kf_4', timeSec: durationSec * 0.67, description: 'ice lemon refresh benefit', source: 'sampled_frame' },
      { id: 'kf_5', timeSec: durationSec * 0.84, description: 'clean CTA end frame', source: 'sampled_frame' }
    ]
  };
}

test('sliceVideoIntoSegments labels multi-cut segments from segment-local keyframe evidence instead of timeline position', () => {
  const segments = sliceVideoIntoSegments({
    assetId: 'asset_long_video',
    media: media(26.2),
    semanticSummary: 'beverage bottle product rotation open cap pour ice lemon clean CTA end frame',
    suitableSlots: ['opening_attention', 'product_closeup', 'usage_demo', 'benefit_visual', 'cta_visual'],
    qualityScore: 0.82,
    segmentation: {
      durationSec: 26.2,
      shouldSlice: true,
      hardCutCount: 3,
      motionChangeCount: 2,
      visualPeakCount: 2,
      boundaryConfidence: 0.84,
      boundaryCandidates: [
        { timeSec: 5, source: 'hard_cut', confidence: 0.92, score: 0.9, reason: 'opening to closeup cut' },
        { timeSec: 10.5, source: 'motion_regime', confidence: 0.8, score: 0.78, reason: 'closeup to hand action' },
        { timeSec: 16, source: 'hard_cut', confidence: 0.86, score: 0.82, reason: 'usage to benefit cut' },
        { timeSec: 21.2, source: 'hard_cut', confidence: 0.83, score: 0.79, reason: 'benefit to cta cut' }
      ],
      warnings: []
    }
  });

  assert.equal(segments.length, 5);
  assert.equal(segments[0].startSec, 0);
  assert.equal(segments.at(-1)?.endSec, 26.2);
  assert.ok(segments.every((segment) => segment.durationSec >= 3));
  assert.equal(segments[0].label, 'Visual segment 1: opening product motion');
  assert.equal(segments[1].label, 'Visual segment 2: product label closeup');
  assert.equal(segments[2].label, 'Visual segment 3: open cap and pour action');
  assert.equal(segments[3].label, 'Visual segment 4: ice lemon refresh benefit');
  assert.equal(segments[4].label, 'Visual segment 5: clean CTA end frame');
  assert.deepEqual(segments[0].roleHints, ['opening_attention']);
  assert.deepEqual(segments[1].roleHints, ['product_closeup']);
  assert.deepEqual(segments[2].roleHints, ['usage_demo']);
  assert.deepEqual(segments[3].roleHints, ['benefit_visual']);
  assert.deepEqual(segments[4].roleHints, ['cta_visual']);
  assert.ok(segments.some((segment) => segment.actionTags.includes('open_cap')));
  assert.ok(segments.some((segment) => segment.actionTags.includes('pour_to_cup')));
});

test('sliceVideoIntoSegments keeps a continuous long video as one segment when visual scan says not to slice', () => {
  const segments = sliceVideoIntoSegments({
    assetId: 'asset_continuous_video',
    media: media(40),
    semanticSummary: 'single continuous product pan, no shot changes',
    suitableSlots: ['product_closeup'],
    qualityScore: 0.78,
    segmentation: {
      durationSec: 40,
      shouldSlice: false,
      hardCutCount: 0,
      motionChangeCount: 0,
      visualPeakCount: 1,
      boundaryConfidence: 0.12,
      boundaryCandidates: [],
      warnings: ['visual segmentation: continuous clip, no reliable split boundary.']
    }
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0].startSec, 0);
  assert.equal(segments[0].endSec, 40);
  assert.deepEqual(segments[0].roleHints, ['product_closeup']);
  assert.ok(segments[0].warnings?.some((warning) => warning.includes('continuous')));
});

test('sliceVideoIntoSegments merges dense cutpoints until every segment is at least three seconds', () => {
  const segments = sliceVideoIntoSegments({
    assetId: 'asset_dense_video',
    media: media(12),
    semanticSummary: 'dense user montage with useful hard cuts',
    suitableSlots: ['opening_attention', 'usage_demo', 'cta_visual'],
    qualityScore: 0.74,
    segmentation: {
      durationSec: 12,
      shouldSlice: true,
      hardCutCount: 5,
      motionChangeCount: 0,
      visualPeakCount: 1,
      boundaryConfidence: 0.81,
      boundaryCandidates: [
        { timeSec: 1.2, source: 'hard_cut', confidence: 0.95, score: 0.95, reason: 'too close to start' },
        { timeSec: 2.5, source: 'hard_cut', confidence: 0.93, score: 0.93, reason: 'would create short segment' },
        { timeSec: 4.1, source: 'hard_cut', confidence: 0.9, score: 0.9, reason: 'valid cut' },
        { timeSec: 5.4, source: 'hard_cut', confidence: 0.88, score: 0.88, reason: 'too close to previous' },
        { timeSec: 8.3, source: 'hard_cut', confidence: 0.87, score: 0.87, reason: 'valid cut' }
      ],
      warnings: []
    }
  });

  assert.deepEqual(segments.map((segment) => segment.startSec), [0, 4.1, 8.3]);
  assert.equal(segments.at(-1)?.endSec, 12);
  assert.ok(segments.every((segment) => segment.durationSec >= 3));
});

test('sliceVideoIntoSegments does not invent role hints for multi-segment video without local semantic evidence', () => {
  const segments = sliceVideoIntoSegments({
    assetId: 'asset_unknown_video',
    media: {
      ...media(10),
      keyframes: [
        { id: 'kf_1', timeSec: 2, description: 'sampled frame at 2s', source: 'sampled_frame' },
        { id: 'kf_2', timeSec: 7, description: 'sampled frame at 7s', source: 'sampled_frame' }
      ]
    },
    semanticSummary: 'uploaded user video with unknown visible action',
    suitableSlots: ['usage_demo'],
    qualityScore: 0.7,
    segmentation: {
      durationSec: 10,
      shouldSlice: true,
      hardCutCount: 1,
      motionChangeCount: 0,
      visualPeakCount: 0,
      boundaryConfidence: 0.78,
      boundaryCandidates: [
        { timeSec: 5, source: 'hard_cut', confidence: 0.78, score: 0.74, reason: 'scene boundary' }
      ],
      warnings: []
    }
  });

  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].roleHints, []);
  assert.deepEqual(segments[1].roleHints, []);
  assert.ok(segments.every((segment) => segment.warnings?.some((warning) => warning.includes('semantic label unavailable'))));
});
