import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildHighlightAnimationPlan,
  buildRevealAnimationPlan,
  prefersReducedMotion,
  shouldReduceMotion
} from './animation';

test('shouldReduceMotion follows the media query match result', () => {
  assert.equal(shouldReduceMotion({ matches: true }), true);
  assert.equal(shouldReduceMotion({ matches: false }), false);
  assert.equal(shouldReduceMotion(null), false);
});

test('prefersReducedMotion uses the standard reduced-motion media query', () => {
  const calls: string[] = [];
  const reduced = prefersReducedMotion({
    matchMedia(query) {
      calls.push(query);
      return { matches: true };
    }
  });

  assert.equal(reduced, true);
  assert.deepEqual(calls, ['(prefers-reduced-motion: reduce)']);
});

test('buildRevealAnimationPlan creates a light capped stagger', () => {
  const first = buildRevealAnimationPlan(0);
  const later = buildRevealAnimationPlan(12);

  assert.equal(first.from.opacity, 0);
  assert.equal(first.from.y, 10);
  assert.equal(first.to.opacity, 1);
  assert.equal(first.to.y, 0);
  assert.equal(first.to.duration, 0.42);
  assert.equal(later.to.delay, 0.18);
});

test('buildHighlightAnimationPlan keeps highlight short and reversible', () => {
  const plan = buildHighlightAnimationPlan();

  assert.equal(plan.to.yoyo, true);
  assert.equal(plan.to.repeat, 1);
  assert.equal(plan.to.duration, 0.28);
});
