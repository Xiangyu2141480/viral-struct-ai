import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Boundary, TimelineItem } from '@viral-struct/shared';
import { evaluateQuality } from './qualityEvaluator';

const baseTimeline: TimelineItem[] = [
  {
    id: 'tl_1', start: 0, end: 5, segmentRole: 'hook', sourceSegmentId: 'seg_a', slotId: 's1',
    script: '', subtitles: [], visualAction: 'use_matched_asset',
    packaging: { captionStyle: 'x', transition: 'push' }
  },
  {
    id: 'tl_2', start: 5, end: 10, segmentRole: 'cta', sourceSegmentId: 'seg_b', slotId: 's2',
    script: '', subtitles: [], visualAction: 'use_matched_asset',
    packaging: { captionStyle: 'x', transition: 'fade' }
  }
];

test('evaluateQuality omits transitionFidelity when boundaries absent', () => {
  const report = evaluateQuality({ matches: [], timeline: baseTimeline });
  assert.equal(report.transitionFidelity, undefined);
});

test('evaluateQuality returns transitionFidelity=1 when all planned transitions match source boundary family', () => {
  // Source: seg_a → seg_b via morph (maps to motion family).
  // Planned: seg_a item has transition='push' (motion family). Match within family.
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'morph' }
  ];
  const report = evaluateQuality({ matches: [], timeline: baseTimeline, boundaries });
  assert.equal(report.transitionFidelity, 1);
});

test('evaluateQuality returns transitionFidelity=0 when none match', () => {
  // Source: cut (hard family). Planned for seg_a: push (motion family). No match.
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'cut' }
  ];
  const report = evaluateQuality({ matches: [], timeline: baseTimeline, boundaries });
  assert.equal(report.transitionFidelity, 0);
});
