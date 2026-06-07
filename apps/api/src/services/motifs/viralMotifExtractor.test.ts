import assert from 'node:assert/strict';
import test from 'node:test';
import type { ShotSlotNode } from '@viral-struct/shared';
import { ViralMotifAnnotationSchema } from '@viral-struct/shared';
import { extractViralMotifAnnotation } from './viralMotifExtractor';
import { sanitizeMotionGrammarText } from './motionGrammarSanitizer';
import { mapTargetCategoryMotif } from './targetCategoryMotifMapper';

const kineticAssemblySlot: ShotSlotNode = {
  id: 'slot_block_004_asset_001',
  segmentId: 'segment_block_004',
  role: 'usage_demo',
  requiredAsset: {
    type: 'video',
    subject: 'source-specific surreal interaction',
    motion: 'fast_cut'
  },
  fallbackStrategies: ['hand_demo'],
  intent: {
    purpose: '键盘碎片在空中飞舞后落到笔记本上自动组装完成，手指按触控板控制屏幕里的火箭飞出笔记本炸开撒彩屑，按圆形按键弹出购买窗口。',
    energyLevel: 'high',
    motionPattern: 'component cascade, assembly completion, interaction activation, spectacle burst, CTA reveal',
    compositionPrincipal: 'surreal product assembly and activation',
    durationMs: [1600, 4200]
  },
  sourceInstance: {
    productInSource: 'MacBook',
    specificAction: 'keyboard fragments assemble, touchpad controls rocket, circular button opens purchase window'
  },
  acceptanceCriteria: {
    anyOf: [
      {
        motionType: 'keyboard fragments fly then assemble on laptop',
        compositionType: 'hardware activation spectacle',
        examples: ['rocket flies out of laptop', 'purchase window pops up']
      }
    ],
    rejectIf: ['static product-only shot']
  }
};

test('extractViralMotifAnnotation detects slot_block_004 kinetic assembly reveal', () => {
  const annotation = extractViralMotifAnnotation({
    slot: kineticAssemblySlot,
    targetCategory: 'beverage'
  });

  assert.ok(annotation);
  const parsed = ViralMotifAnnotationSchema.parse(annotation);

  assert.equal(parsed.motifType, 'kinetic_assembly_reveal');
  assert.equal(parsed.motionTokens.includes('component_cascade'), true);
  assert.equal(parsed.motionTokens.includes('chaos_to_order'), true);
  assert.equal(parsed.motionTokens.includes('assembly_completion'), true);
  assert.equal(parsed.motionTokens.includes('interaction_activation'), true);
  assert.equal(parsed.motionTokens.includes('spectacle_burst'), true);
  assert.equal(parsed.motionTokens.includes('cta_reveal'), true);
  assert.equal(parsed.targetCategoryMapping.preferredEquivalents.includes('ice cubes'), true);
  assert.equal(parsed.targetCategoryMapping.preferredEquivalents.includes('pour to cup'), true);

  const sanitizedSurface = [
    parsed.sanitizedIntent,
    parsed.targetCategoryMapping.preferredEquivalents.join(' '),
    parsed.targetCategoryMapping.rationale,
    parsed.transferVariables.map((variable) => variable.targetValue).join(' ')
  ].join(' ').toLowerCase();

  for (const banned of ['keyboard', 'laptop', 'touchpad', 'rocket', 'hardware', 'macbook', 'apple', '键盘', '笔记本', '触控板', '火箭', '硬件功能']) {
    assert.equal(sanitizedSurface.includes(banned.toLowerCase()), false, `sanitized output leaked ${banned}`);
  }
});

test('ordinary usage actions are not misclassified as kinetic assembly reveal', () => {
  const ordinarySlot: ShotSlotNode = {
    id: 'slot_plain_usage',
    segmentId: 'segment_usage',
    role: 'usage_demo',
    requiredAsset: {
      type: 'video',
      subject: 'hand opens bottle and drinks iced tea',
      motion: 'hand_operation'
    },
    fallbackStrategies: ['hand_demo'],
    intent: {
      purpose: '手拿起瓶子，打开瓶盖，然后喝一口冰红茶。',
      energyLevel: 'medium',
      motionPattern: 'hand pickup, open cap, drink',
      compositionPrincipal: 'ordinary usage demo',
      durationMs: [1200, 2600]
    },
    sourceInstance: {
      productInSource: 'iced tea bottle',
      specificAction: 'hand pickup, open cap, drink'
    },
    acceptanceCriteria: {
      anyOf: [
        {
          motionType: 'open cap and drink',
          compositionType: 'product usage closeup',
          examples: ['hand opens cap', 'bottle remains visible']
        }
      ]
    }
  };

  assert.equal(extractViralMotifAnnotation({ slot: ordinarySlot, targetCategory: 'beverage' }), undefined);
});

test('motion grammar sanitizer preserves transferable intent and removes source-specific semantics', () => {
  const sanitized = sanitizeMotionGrammarText(
    'keyboard fragments assemble on a laptop, touchpad triggers rocket burst and purchase window CTA'
  );

  assert.equal(sanitized.sanitizedIntent.includes('dynamic assembly'), true);
  assert.equal(sanitized.sanitizedIntent.includes('interaction activation'), true);
  assert.equal(sanitized.sanitizedIntent.includes('spectacle burst'), true);
  assert.equal(sanitized.sanitizedIntent.includes('CTA reveal'), true);
  assert.equal(sanitized.motionTokens.includes('assembly_completion'), true);

  for (const banned of sanitized.bannedSourceTerms) {
    assert.equal(sanitized.sanitizedIntent.toLowerCase().includes(banned.toLowerCase()), false);
  }
});

test('targetCategoryMotifMapper maps kinetic assembly reveal into beverage-native materials', () => {
  const mapping = mapTargetCategoryMotif({
    motifType: 'kinetic_assembly_reveal',
    targetCategory: 'beverage'
  });

  assert.deepEqual(mapping.preferredEquivalents, [
    'ice cubes',
    'lemon slices',
    'tea droplets',
    'cold mist',
    'cap opening',
    'pour to cup',
    'CTA lock-up'
  ]);
  assert.equal(mapping.rejectedEquivalents.includes('keyboard fragments'), true);
});
