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
    motifType: motionTokens?.includes('component_cascade') ? 'kinetic_assembly_reveal' : undefined,
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

test('two plain matched slots with no bridge evidence use a safe cut with explanation', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open')),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'cut');
  assert.ok(t.whyThisMode);
  assert.ok(t.whyNot?.some((entry) => entry.mode === 'hyperframes'));
});

test('both-matched + strong motif avoids AIGC and uses a plan-only particle bridge when real bridge assets are absent', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open'), ['component_cascade']),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'particle_bridge');
  assert.notEqual(t.mode, 'aigc_job_card');
  assert.equal(t.optionalAIGCJobCard?.ownership, 'external_generation_job_card_only');
  assert.equal(t.optionalAIGCJobCard?.planOnly, true);
});

test('legacy hyperframesWeight parameter no longer overrides evidence-aware mode selection', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open'), ['component_cascade']),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage'))
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base, hyperframesWeight: 1 });
  assert.equal(t.mode, 'particle_bridge');
  assert.ok(t.whyThisMode);
});

test('a very short gap on either side becomes a cut and never claims generated media', () => {
  const slots = [
    { ...slot('b', 'usage_demo', 0, matchedFill('asset_usage')), startMs: 0, endMs: 300 },
    { ...slot('c', 'cta_visual', 1, gapFill()), startMs: 300, endMs: 600 }
  ];
  const [t] = buildOrchestratedTransitions({ slots, ...base });
  assert.equal(t.mode, 'cut');
  assert.equal(t.optionalAIGCJobCard?.ownership, 'external_generation_job_card_only');
  assert.ok(t.missingAssets.length > 0);
  assert.doesNotMatch(JSON.stringify(t), /generated media|rendered video|already generated/i);
});

test('infers diverse semantic transition functions and carries planner explanations', () => {
  const slots = [
    slot('opening', 'opening_attention', 0, matchedFill('asset_open')),
    slot('product', 'product_closeup', 1, matchedFill('asset_open')),
    slot('motif', 'usage_demo', 2, matchedFill('asset_usage'), ['component_cascade', 'chaos_to_order']),
    slot('benefit', 'benefit_visual', 3, matchedFill('asset_open')),
    slot('usage', 'usage_demo', 4, matchedFill('asset_usage')),
    slot('cta', 'cta_visual', 5, matchedFill('asset_open'))
  ];

  const transitions = buildOrchestratedTransitions({ slots, ...base, hyperframesWeight: 1 });
  const functions = new Set(transitions.map((transition) => transition.transitionFunction));

  assert.ok(functions.has('problem_to_solution'));
  assert.ok(functions.has('chaos_to_order'));
  assert.ok(functions.has('product_to_cta'));
  assert.ok(functions.size >= 3);

  assert.ok(transitions.every((transition) => transition.whyThisMode));
  assert.ok(transitions.every((transition) => (transition.whyNot?.length ?? 0) > 0));
  const guidance = transitions.map((transition) => transition.visualAction ?? transition.hyperframes?.editingGuidanceNL ?? transition.aigcFrameBridge?.prompt ?? '').join('\n');
  assert.match(guidance, /切换|承接|桥接|卡片|动作|图形|目标品类/);
  assert.doesNotMatch(guidance, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
});
