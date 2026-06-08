import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineItem } from '@viral-struct/shared';
import { validateRenderRequestBody } from './render';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'i1',
    start: 0,
    end: 5,
    segmentRole: 'hook',
    sourceSegmentId: 's1',
    slotId: 'slot_a',
    script: 'open',
    subtitles: ['hi'],
    visualAction: 'grab',
    packaging: { captionStyle: 'bold' },
    ...overrides
  };
}

test('validateRenderRequestBody accepts a bounded render request', () => {
  const result = validateRenderRequestBody({
    timeline: [item()],
    profile: { width: 1080, height: 1920, fps: 30, format: 'mp4' }
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.timeline.length, 1);
    assert.equal(result.profile?.width, 1080);
  }
});

test('validateRenderRequestBody rejects oversized render profiles', () => {
  const result = validateRenderRequestBody({
    timeline: [item()],
    profile: { width: 4000, height: 4000, fps: 60, format: 'mp4' }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /profile/i);
  }
});

test('validateRenderRequestBody rejects timelines that exceed the route render cap', () => {
  const result = validateRenderRequestBody({
    timeline: [item({ end: 90 })],
    profile: { width: 1080, height: 1920, fps: 30, format: 'mp4' }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /duration/i);
  }
});

test('validateRenderRequestBody rejects too many timeline items', () => {
  const timeline = Array.from({ length: 101 }, (_, index) => item({
    id: `i${index}`,
    start: index * 0.1,
    end: index * 0.1 + 0.05
  }));

  const result = validateRenderRequestBody({ timeline });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /timeline/i);
  }
});
