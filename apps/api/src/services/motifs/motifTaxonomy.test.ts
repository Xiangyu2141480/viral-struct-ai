import assert from 'node:assert/strict';
import test from 'node:test';
import type { MotifType, ShotSlotNode } from '@viral-struct/shared';
import { ViralMotifAnnotationSchema } from '@viral-struct/shared';
import { extractViralMotifAnnotation, inspectMotifSignal } from './viralMotifExtractor';
import { buildMotifAwareBriefs } from './motifAwareBriefBuilder';

const BANNED = ['keyboard', 'laptop', 'touchpad', 'rocket', 'hardware', 'macbook', 'apple', '键盘', '笔记本', '触控板', '火箭', '硬件功能'];

function makeSlot(id: string, purpose: string): ShotSlotNode {
  return {
    id,
    segmentId: `segment_${id}`,
    role: 'usage_demo',
    requiredAsset: { type: 'video', subject: purpose, motion: 'hand_operation' },
    fallbackStrategies: ['hand_demo'],
    intent: {
      purpose,
      energyLevel: 'high',
      motionPattern: purpose,
      compositionPrincipal: 'beverage motion grammar',
      durationMs: [1500, 4000]
    },
    sourceInstance: { productInSource: 'source product', specificAction: purpose },
    acceptanceCriteria: { anyOf: [{ motionType: purpose, compositionType: 'product motion', examples: [purpose] }] }
  };
}

// Representative source text per motif → expected classified motifType.
const CASES: Array<{ name: string; text: string; expected: MotifType }> = [
  {
    name: 'surreal_assembly',
    text: '大量碎片从上方坠落飞舞，自动组装拼合成完整产品形态',
    expected: 'surreal_assembly'
  },
  {
    name: 'ingredient_transformation',
    text: '大量冰晶飞散、柠檬片从上方落下，逐渐变形流动并倒入汇聚成饮品',
    expected: 'ingredient_transformation'
  },
  {
    name: 'kinetic_product_reveal',
    text: '瓶身旋转，镜头推近展示标签与冷凝水，最后定格在产品上',
    expected: 'kinetic_product_reveal'
  },
  {
    name: 'lineup_lockup',
    text: '三瓶产品一字排开，镜头横移扫过，最后锁定成组并弹出购买信息',
    expected: 'lineup_lockup'
  },
  {
    name: 'impact_activation',
    text: '冰块砸入杯中产生撞击落地，瓶盖弹开后冷雾激活亮起',
    expected: 'impact_activation'
  },
  {
    name: 'dynamic_entry',
    text: '产品从画面上方高能飞入，伴随冰块坠落，镜头快速推近',
    expected: 'dynamic_entry'
  },
  {
    name: 'benefit_card_motion',
    text: '卖点卡片落下，围绕卖点动效展示，最后定格在 CTA 上弹出购买',
    expected: 'benefit_card_motion'
  }
];

for (const testCase of CASES) {
  test(`extractor classifies ${testCase.name}`, () => {
    const annotation = extractViralMotifAnnotation({
      slot: makeSlot(`slot_${testCase.name}`, testCase.text),
      targetCategory: 'beverage'
    });
    assert.ok(annotation, `${testCase.name}: expected an annotation`);
    const parsed = ViralMotifAnnotationSchema.parse(annotation);
    assert.equal(parsed.motifType, testCase.expected);
  });

  test(`${testCase.name} brief carries beverage semantics and no source leakage`, () => {
    const annotation = extractViralMotifAnnotation({
      slot: makeSlot(`slot_${testCase.name}`, testCase.text),
      targetCategory: 'beverage'
    });
    assert.ok(annotation);
    const briefs = buildMotifAwareBriefs({
      motif: annotation,
      contentBrief: {
        productName: '康师傅冰红茶',
        targetAudience: 'demo',
        scenario: 'demo',
        sellingPoints: ['冰爽解腻'],
        cta: '现在来一瓶',
        stylePreference: 'demo'
      },
      referenceAssetIds: ['ref_001']
    });
    assert.ok(briefs, `${testCase.name}: expected motif-aware briefs`);
    // Only the POSITIVE surfaces must be leak-free. negativePrompt / avoid lists
    // legitimately name the banned terms (to forbid them), so they're excluded.
    const positiveSurface = [
      briefs.manualShootBrief.title,
      briefs.manualShootBrief.objective,
      briefs.manualShootBrief.shotDescription,
      briefs.manualShootBrief.requiredProps.join(' '),
      briefs.manualShootBrief.mustCapture.join(' '),
      briefs.aigcGenerationBrief.prompt,
      briefs.hyperframesBrief.copyIntent,
      briefs.hyperframesBrief.visualElements.join(' '),
      briefs.hyperframesBrief.animationHints.join(' ')
    ].join(' ').toLowerCase();
    for (const banned of BANNED) {
      assert.equal(positiveSurface.includes(banned.toLowerCase()), false, `${testCase.name} positive surface leaked ${banned}`);
    }
    // Beverage-native target tokens must be present in the positive surface.
    const beverageTokens = ['ice', 'lemon', 'tea', 'mist', 'condensation', 'bottle', 'cta'];
    assert.ok(
      beverageTokens.filter((token) => positiveSurface.includes(token)).length >= 2,
      `${testCase.name} positive surface missing beverage-native tokens`
    );
    // Asset Manager stays evidence-only — never emits final repair/fallback cards.
    const surface = JSON.stringify(briefs).toLowerCase();
    assert.equal(surface.includes('fallbackcards'), false);
    assert.equal(surface.includes('suggestedrepair'), false);
  });
}

test('plain open/drink usage is recognised as the baseline and yields no motif annotation', () => {
  const plain = makeSlot('slot_plain', '手拿起瓶子，打开瓶盖，然后喝一口冰红茶');
  // category_usage_moment is the plain baseline → routed to the existing fallback
  // (extractor returns undefined), preserving the teammate's tested contract.
  assert.equal(extractViralMotifAnnotation({ slot: plain, targetCategory: 'beverage' }), undefined);
});

test('unseen motion semantics surface as a novel candidate instead of being dropped', () => {
  // quick_cut + match_cut are declared tokens that no motif definition references
  // yet — exactly the "new entry" case decision D1 must surface for expansion.
  const novel = makeSlot('slot_novel', '镜头快切，配合匹配剪辑无缝转场');
  const signal = inspectMotifSignal(novel);
  assert.equal(signal.definition, undefined);
  assert.equal(signal.isNovel, true);
  assert.ok(signal.candidate);
  assert.ok(signal.candidate.detectedTokens.includes('quick_cut'));
  assert.ok(signal.candidate.detectedTokens.includes('match_cut'));
  // and the main extractor still safely falls back (no annotation)
  assert.equal(extractViralMotifAnnotation({ slot: novel, targetCategory: 'beverage' }), undefined);
});
