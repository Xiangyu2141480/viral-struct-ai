import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Boundary, MaterialGap } from '@viral-struct/shared';
import { planGapRepairs } from './gapRepairPlanner';

const gap: MaterialGap = {
  slotId: 'slot_x',
  role: 'opening_attention',
  type: 'missing_opening_visual',
  severity: 'high',
  reason: '没有找到能支撑该结构槽位的素材。',
  impact: 'segment seg_a affected',
  affectedSegmentId: 'seg_a',
  missingIngredients: []
};

test('planGapRepairs without boundaries produces unannotated explanation', () => {
  const [repair] = planGapRepairs([gap], [], { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' });
  assert.equal(repair.strategy, 'text_card');
  assert.ok(!repair.explanation.startsWith('[boundary:'));
});

test('planGapRepairs prepends boundary note when slot segment touches strong boundary', () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'morph', intensity: 'strong' }
  ];
  const [repair] = planGapRepairs(
    [gap],
    [],
    { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' },
    boundaries
  );
  assert.equal(repair.strategy, 'text_card');
  assert.ok(
    repair.explanation.startsWith('[boundary:morph/strong]'),
    `expected boundary prefix, got: ${repair.explanation}`
  );
});

test('planGapRepairs does not annotate for weak boundaries', () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'cut', intensity: 'weak' }
  ];
  const [repair] = planGapRepairs(
    [gap],
    [],
    { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' },
    boundaries
  );
  assert.ok(!repair.explanation.startsWith('[boundary:'));
});
