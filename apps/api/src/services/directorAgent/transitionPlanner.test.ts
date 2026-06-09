import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief, OrchestratedSlot, SlotFillGap, SlotFillMatched } from '@viral-struct/shared';
import { planTransition } from './transitionPlanner';

function contentBrief(): ContentBrief {
  return {
    productName: 'Test Product',
    category: 'generic',
    targetAudience: 'young consumers',
    scenario: 'short-form product ad',
    sellingPoints: ['clear benefit'],
    cta: 'Try it now',
    stylePreference: 'clean energetic edit'
  };
}

function asset(id: string, overrides: Partial<AssetCard> = {}): AssetCard {
  return {
    id,
    type: 'video',
    url: `/${id}.mp4`,
    detectedObjects: ['product'],
    suitableSlots: ['usage_demo'],
    qualityScore: 0.82,
    ...overrides
  };
}

function matchedFill(assetId: string, evidence: Partial<SlotFillMatched['evidence']> = {}): SlotFillMatched {
  return {
    kind: 'matched',
    assetId,
    matchQuality: 0.9,
    matchedCriteria: [],
    status: 'matched',
    videoEngineInstruction: '',
    evidence: {
      matchedIngredients: evidence.matchedIngredients ?? [],
      missingIngredients: evidence.missingIngredients ?? [],
      blockingReasons: evidence.blockingReasons ?? [],
      coverageStatus: evidence.coverageStatus
    }
  };
}

function partialFill(assetId: string, missingIngredients: string[] = []): SlotFillMatched {
  return {
    ...matchedFill(assetId, { missingIngredients, coverageStatus: missingIngredients.length ? 'weak' : 'covered' }),
    status: 'partial',
    matchQuality: 0.62,
    missingCriteria: missingIngredients
  };
}

function gapFill(missing = 'bridge material'): SlotFillGap {
  return {
    kind: 'gap',
    reason: 'no asset',
    missing,
    recommendedOptionId: 'aigc',
    options: [],
    videoEngineInstruction: '',
    evidence: {
      matchedIngredients: [],
      missingIngredients: [missing],
      blockingReasons: [],
      coverageStatus: 'insufficient'
    }
  };
}

function slot(args: {
  id: string;
  role: string;
  index: number;
  fill: SlotFillMatched | SlotFillGap;
  durationMs?: number;
  intent?: string;
  motionTokens?: string[];
  motifType?: string;
}): OrchestratedSlot {
  const durationMs = args.durationMs ?? 3000;
  return {
    slotId: args.id,
    role: args.role,
    index: args.index,
    startMs: args.index * durationMs,
    endMs: args.index * durationMs + durationMs,
    fillStatus: args.fill.kind === 'gap' ? 'missing_generation_required' : args.fill.status === 'matched' ? 'matched' : 'partial_asset_support',
    transferableIntent: args.intent,
    motifType: args.motifType,
    motionTokens: args.motionTokens,
    fill: args.fill
  };
}

function baseContext(from: OrchestratedSlot, to: OrchestratedSlot, assetCards: AssetCard[] = []) {
  return {
    projectId: 'test_project',
    sourceVideoId: 'test_source',
    targetCategory: 'generic',
    targetBrief: contentBrief(),
    fromSlot: from,
    toSlot: to,
    fromFillStatus: from.fillStatus,
    toFillStatus: to.fillStatus,
    fromAssetIds: from.fill.kind === 'matched' ? [from.fill.assetId] : [],
    toAssetIds: to.fill.kind === 'matched' ? [to.fill.assetId] : [],
    assetCards,
    missingIngredients: [...(from.fill.evidence.missingIngredients ?? []), ...(to.fill.evidence.missingIngredients ?? [])],
    safetyConstraints: { sourceTerms: ['MacBook', 'keyboard', 'trackpad', 'laptop', 'rocket'] }
  };
}

test('same role pair uses action evidence to select match_cut', () => {
  const from = slot({
    id: 'from_usage',
    role: 'usage_demo',
    index: 0,
    fill: matchedFill('asset_open'),
    intent: 'hand begins opening product',
    motionTokens: ['hand_action', 'open_cap']
  });
  const to = slot({
    id: 'to_usage',
    role: 'usage_demo',
    index: 1,
    fill: matchedFill('asset_finish'),
    intent: 'hand completes opening product',
    motionTokens: ['hand_action', 'open_cap']
  });

  const plan = planTransition(baseContext(from, to, [
    asset('asset_open', { detectedObjects: ['product', 'hand'], temporalDescription: 'hand opens cap from left to right' }),
    asset('asset_finish', { detectedObjects: ['product', 'hand'], temporalDescription: 'hand completes cap opening' })
  ]));

  assert.equal(plan.implementationMode, 'match_cut');
  assert.equal(plan.mode, 'match_cut');
  assert.match(plan.whyThisMode ?? '', /动作|action|continuity/i);
});

test('same role pair uses shape/color/position evidence to select graphic_match', () => {
  const from = slot({
    id: 'from_product',
    role: 'product_closeup',
    index: 0,
    fill: matchedFill('asset_round_a'),
    intent: 'centered product label'
  });
  const to = slot({
    id: 'to_product',
    role: 'product_closeup',
    index: 1,
    fill: matchedFill('asset_round_b'),
    intent: 'centered product pack'
  });

  const plan = planTransition(baseContext(from, to, [
    asset('asset_round_a', { detectedObjects: ['round product', 'centered label'], spatialDescription: 'center screen, circular logo, red color cluster' }),
    asset('asset_round_b', { detectedObjects: ['round pack', 'centered product'], spatialDescription: 'center screen, circular cap, red color cluster' })
  ]));

  assert.equal(plan.implementationMode, 'graphic_match');
  assert.notEqual(plan.implementationMode, 'match_cut');
});

test('foreground object crossing frame selects object_wipe', () => {
  const from = slot({
    id: 'from_sweep',
    role: 'product_closeup',
    index: 0,
    fill: matchedFill('asset_sweep'),
    intent: 'foreground product sweeps across lens'
  });
  const to = slot({
    id: 'to_reveal',
    role: 'benefit_visual',
    index: 1,
    fill: matchedFill('asset_reveal'),
    intent: 'benefit is revealed after sweep'
  });

  const plan = planTransition(baseContext(from, to, [
    asset('asset_sweep', { detectedObjects: ['product'], temporalDescription: 'foreground object crosses frame as wipe' }),
    asset('asset_reveal', { detectedObjects: ['product'] })
  ]));

  assert.equal(plan.implementationMode, 'object_wipe');
});

test('clean safe area plus CTA intent selects card_animation', () => {
  const from = slot({
    id: 'from_benefit',
    role: 'benefit_visual',
    index: 0,
    fill: matchedFill('asset_clean'),
    intent: 'explain the benefit clearly'
  });
  const to = slot({
    id: 'to_cta',
    role: 'cta_visual',
    index: 1,
    fill: matchedFill('asset_cta'),
    intent: 'show CTA lockup'
  });

  const plan = planTransition(baseContext(from, to, [
    asset('asset_clean', { detectedObjects: ['product'], spatialDescription: 'clean safe area on top third, minimal background' }),
    asset('asset_cta', { type: 'image', detectedObjects: ['product', 'text card'], suitableSlots: ['cta_visual'] })
  ]));

  assert.equal(plan.implementationMode, 'card_animation');
});

test('important motif with missing bridge assets selects hyperframes with explicit why-not evidence', () => {
  const from = slot({
    id: 'from_motif',
    role: 'usage_demo',
    index: 0,
    fill: partialFill('asset_reference', ['particle bridge', 'activation burst']),
    intent: 'abstract chaos to order assembly reveal',
    motifType: 'kinetic_assembly_reveal',
    motionTokens: ['component_cascade', 'chaos_to_order', 'spectacle_burst']
  });
  const to = slot({
    id: 'to_product',
    role: 'product_closeup',
    index: 1,
    fill: matchedFill('asset_product'),
    intent: 'product payoff'
  });

  const plan = planTransition(baseContext(from, to, [
    asset('asset_reference', { detectedObjects: ['product'], temporalDescription: 'plain hand pickup, no particles' }),
    asset('asset_product', { detectedObjects: ['product'] })
  ]));

  assert.equal(plan.implementationMode, 'hyperframes');
  assert.equal(plan.assetSupport?.status, 'partial');
  assert.ok((plan.missingTransitionAssets ?? []).length > 0);
  assert.ok((plan.whyNot ?? []).some((entry) => entry.mode === 'match_cut'));
  assert.ok(plan.hyperframesGuidance);
});

test('gap plus very short duration falls back to cut and keeps AIGC plan-only', () => {
  const from = slot({ id: 'from_gap', role: 'usage_demo', index: 0, fill: gapFill(), durationMs: 300 });
  const to = slot({ id: 'to_cta', role: 'cta_visual', index: 1, fill: matchedFill('asset_cta'), durationMs: 300 });

  const plan = planTransition(baseContext(from, to, [asset('asset_cta')]));

  assert.equal(plan.implementationMode, 'cut');
  assert.equal(plan.mode, 'cut');
  assert.equal(plan.optionalAIGCJobCard?.ownership, 'external_generation_job_card_only');
  assert.doesNotMatch(JSON.stringify(plan), /generated media|rendered video|already generated/i);
});

test('planner is deterministic without LLM enhancement and blocks source leakage in positive fields', () => {
  const from = slot({
    id: 'from_source',
    role: 'usage_demo',
    index: 0,
    fill: partialFill('asset_source', ['keyboard bridge']),
    intent: 'MacBook keyboard and trackpad rocket sequence',
    motionTokens: ['component_cascade']
  });
  const to = slot({
    id: 'to_target',
    role: 'cta_visual',
    index: 1,
    fill: matchedFill('asset_target'),
    intent: 'target CTA'
  });

  const plan = planTransition(baseContext(from, to, [asset('asset_source'), asset('asset_target')]));
  const positiveText = [
    plan.semanticBridgeExplanation,
    plan.visualAction,
    plan.whyThisMode,
    plan.hyperframesGuidance,
    plan.optionalAIGCJobCard?.prompt
  ]
    .filter(Boolean)
    .join('\n');

  assert.equal(plan.llmEnhancement, null);
  assert.doesNotMatch(positiveText, /MacBook|keyboard|trackpad|laptop|rocket/i);
});
