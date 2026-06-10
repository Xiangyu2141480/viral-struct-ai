import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OrchestratedSlot, SlotFillGap, SlotFillMatched } from '@viral-struct/shared';
import { buildOrchestratedTransitions, planTransition } from './transitionOrchestrator';
import { makeAssets, makeContentBrief } from './testFixtures';

const USER_VISIBLE_TRANSITION_GUARDRAIL_RE =
  /品牌安全|合规|未授权品牌|brand|IP|claims|source-copying|Review|医疗|价格|促销|宣称|不得加入|未经证实/i;

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

test('planTransition emits evidence-aware planner fields for report handoff', () => {
  const from = slot('a', 'opening_attention', 0, matchedFill('asset_open'));
  const to = slot('b', 'usage_demo', 1, matchedFill('asset_usage'));

  const transition = planTransition({
    id: 'transition_001',
    from,
    to,
    productName: base.contentBrief.productName,
    hyperframesWeight: 1
  });

  assert.equal(transition.implementationMode, 'hyperframes');
  assert.equal(transition.assetSupport, 'real_asset_primary');
  assert.equal(typeof transition.confidence, 'number');
  assert.ok((transition.whyThisMode ?? '').length > 0);
  assert.ok((transition.visualAction ?? '').length > 0);
  assert.ok((transition.fallbackStrategy ?? '').length > 0);
  assert.deepEqual(transition.missingTransitionAssets, []);
  assert.ok((transition.whyNot ?? []).some((reason) => reason.includes('AIGC')));
});

test('buildOrchestratedTransitions delegates every adjacent pair to evidence-aware planTransition output', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open')),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage')),
    slot('c', 'cta_visual', 2, gapFill())
  ];

  const transitions = buildOrchestratedTransitions({ slots, ...base });

  assert.equal(transitions.length, 2);
  for (const transition of transitions) {
    assert.ok(transition.implementationMode);
    assert.ok(transition.assetSupport);
    assert.equal(typeof transition.confidence, 'number');
    assert.ok(transition.whyThisMode);
    assert.ok(Array.isArray(transition.whyNot));
    assert.ok(Array.isArray(transition.missingTransitionAssets));
    assert.ok(transition.visualAction);
    assert.ok(transition.fallbackStrategy);
  }
});

test('transition handoff text stays creative and does not expose brand-safety review wording', () => {
  const slots = [
    slot('a', 'opening_attention', 0, matchedFill('asset_open'), ['component_cascade']),
    slot('b', 'usage_demo', 1, matchedFill('asset_usage')),
    slot('c', 'cta_visual', 2, gapFill())
  ];

  const transitions = buildOrchestratedTransitions({ slots, ...base });
  const visibleText = transitions.map((transition) => [
    transition.reason,
    transition.hyperframes?.editingGuidanceNL,
    transition.aigcFrameBridge?.prompt,
    ...(transition.riskNotes ?? [])
  ].filter(Boolean).join('\n')).join('\n');

  assert.match(visibleText, /转场|承接|冷雾|产品|CTA/);
  assert.doesNotMatch(visibleText, USER_VISIBLE_TRANSITION_GUARDRAIL_RE);
});
