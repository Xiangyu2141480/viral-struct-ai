import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MissingMaterialBrief, ShotSlotNode } from '@viral-struct/shared';
import { buildGapResolutionOptions } from './gapResolutionOptionsBuilder';
import { makeContentBrief } from './testFixtures';

function makeSlot(role: ShotSlotNode['role'] = 'usage_demo'): ShotSlotNode {
  return {
    id: 'slot_usage',
    segmentId: 'seg_usage',
    role,
    requiredAsset: { type: 'video', subject: 'opening cap and drinking' },
    fallbackStrategies: ['hand_demo']
  };
}

function makeBrief(aigcEligible = true): MissingMaterialBrief {
  return {
    id: 'brief_001',
    affectedSlotId: 'slot_usage',
    slotRole: 'usage_demo',
    slotIntent: 'show the product being used naturally',
    missingIngredients: [],
    potentialImpact: [],
    manualShootBrief: {
      title: '补拍使用过程',
      objective: 'Capture a real usage moment.',
      shotDescription: 'Shoot opening the cap and drinking one sip, hand-only.',
      durationSec: 4,
      framing: 'vertical hand/neck-down shot',
      requiredProps: ['cup', 'bottle'],
      mustCapture: ['open cap', 'drink one sip'],
      avoid: ['other brands', 'celebrity likeness', 'price claims', 'medical claims']
    },
    aigcGenerationBrief: {
      providerHint: 'seedance',
      prompt: 'Prompt brief only, not rendered output. Create a 9:16 usage shot, hand-only.',
      negativePrompt: 'no watermark, no other brands',
      referenceAssetIds: ['asset_usage'],
      expectedDurationSec: 4,
      aspectRatio: '9:16',
      safetyNotes: ['brief only']
    },
    hyperframesBrief: {
      title: 'Usage placeholder input',
      cardType: 'usage_placeholder_card',
      copyIntent: 'Explain the missing usage action with a step card.',
      visualElements: ['康师傅冰红茶', 'reference asset asset_usage'],
      animationHints: ['step 1/2/3 card', 'small product image'],
      durationSec: 3,
      inputAssets: ['asset_usage']
    },
    channelEligibility: [
      {
        channel: 'aigc_video_prompt',
        eligible: aigcEligible,
        confidence: aigcEligible ? 'medium' : 'low',
        reason: 'test',
        requiredInputs: [],
        providedInputs: [],
        missingInputs: [],
        ownership: 'external_generation_adapter'
      }
    ],
    ownership: 'asset_manager_handoff_brief_only'
  };
}

test('always returns exactly three options: reshoot / hyperframes / aigc', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
});

test('partial tier recommends hyperframes', () => {
  const { recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.equal(recommendedOptionId, 'hyperframes');
});

test('gap tier recommends aigc, but falls back to hyperframes when aigc is not eligible', () => {
  const eligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(true),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.equal(eligible.recommendedOptionId, 'aigc');

  const ineligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(false),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.equal(ineligible.recommendedOptionId, 'hyperframes');
});

test('reshoot option carries framing and mustCapture in its guidance', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const reshoot = options.find((o) => o.id === 'reshoot')!;
  assert.ok(reshoot.id === 'reshoot');
  assert.ok(reshoot.framing.length > 0);
  assert.deepEqual(reshoot.mustCapture, ['open cap', 'drink one sip']);
  assert.match(reshoot.guidanceNL, /open cap/);
});

test('hyperframes option synthesizes editingGuidanceNL referencing card type and assets', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const hyper = options.find((o) => o.id === 'hyperframes')!;
  assert.ok(hyper.id === 'hyperframes');
  assert.equal(hyper.cardType, 'usage_placeholder_card');
  assert.deepEqual(hyper.referencedAssetIds, ['asset_usage']);
  assert.ok(hyper.editingGuidanceNL.length > 0);
  assert.match(hyper.editingGuidanceNL, /Keep the original product label visible/);
});

test('aigc option is job-card only', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  assert.ok(aigc.id === 'aigc');
  assert.equal(aigc.ownership, 'external_generation_job_card_only');
});

test('synthesizes all three options when no brief exists (gate-blocked covered slot)', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  assert.equal(recommendedOptionId, 'hyperframes');
  const aigc = options.find((o) => o.id === 'aigc')!;
  if (aigc.id === 'aigc') {
    assert.equal(aigc.ownership, 'external_generation_job_card_only');
  }
});
