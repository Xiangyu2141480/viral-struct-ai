import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OrchestratedSlot, SlotFillGap, SlotFillMatched } from '@viral-struct/shared';
import { buildOrchestratedTransitions } from './transitionOrchestrator';
import { makeAssets, makeContentBrief } from './testFixtures';

function matchedFill(assetId: string): SlotFillMatched {
  return {
    kind: 'matched',
    assetId,
    matchQuality: 0.9,
    matchedCriteria: [],
    status: 'matched',
    videoEngineInstruction: '',
    evidence: { matchedIngredients: [], missingIngredients: [], blockingReasons: [] }
  };
}

function gapFill(): SlotFillGap {
  return {
    kind: 'gap',
    reason: 'no asset',
    missing: 'material',
    recommendedOptionId: 'aigc',
    options: [],
    videoEngineInstruction: '',
    evidence: { matchedIngredients: [], missingIngredients: [], blockingReasons: [] }
  };
}

function slot(
  id: string,
  role: string,
  index: number,
  fill: SlotFillMatched | SlotFillGap,
  motionTokens?: string[]
): OrchestratedSlot {
  return {
    slotId: id,
    role,
    index,
    startMs: index * 3000,
    endMs: index * 3000 + 3000,
    motionTokens,
    fill
  };
}

const base = { assetCards: makeAssets(), contentBrief: makeContentBrief() };

test('emits exactly slots.length - 1 transitions', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open')),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage')),
    slot('c', 'cta_visual', 2, gapFill())
  ];
  const transitions = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(transitions.length, 2);
});

test('two plain matched slots (no strong motion) default to a hyperframes transition with NL guidance', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open')),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'hyperframes');
  assert.ok(t.hyperframes);
  assert.ok((t.hyperframes?.editingGuidanceNL.length ?? 0) > 0);
});

test('both-matched + strong motif → aigc_frame_bridge (plan/job-card only, with frame placeholders)', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open'), ['component_cascade']),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'aigc_frame_bridge');
  assert.equal(t.preferredImplementation, 'external_generation');
  assert.equal(t.aigcFrameBridge?.ownership, 'external_generation_job_card_only');
  assert.match(t.aigcFrameBridge?.fromTailFrameRef ?? '', /extract tail frame/);
});

test('hyperframesWeight >= 1 forces hyperframes even for strong pairs', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open'), ['component_cascade']),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base, hyperframesWeight: 1 });
  assert.equal(t.mode, 'hyperframes');
});

test('a gap on either side becomes a cut and never requires frame extraction', () => {
  const slots = [
    slot('b', 'usage_demo', 0, matchedFill('asset_usage')),
    slot('c', 'cta_visual', 1, gapFill())
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'cut');
  assert.equal(t.aigcFrameBridge, undefined);
  assert.ok(t.missingAssets.includes('c asset'));
});
