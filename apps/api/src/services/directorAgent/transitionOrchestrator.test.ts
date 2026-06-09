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

test('infers diverse semantic transition functions with Chinese execution guidance', () => {
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

  assert.ok(functions.has('opening_to_product'));
  assert.ok(functions.has('motif_assembly_bridge'));
  assert.ok(functions.has('usage_to_benefit'));
  assert.ok(functions.has('benefit_to_usage'));
  assert.ok(functions.has('product_to_cta'));
  assert.ok(functions.size >= 4);

  const guidance = transitions.map((transition) => transition.hyperframes?.editingGuidanceNL ?? transition.aigcFrameBridge?.prompt ?? '').join('\n');
  assert.match(guidance, /冰块|柠檬|茶滴|冷雾|开盖|CTA/);
  assert.match(guidance, /转场|承接|擦除|收口|汇聚/);
  assert.doesNotMatch(guidance, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
});
