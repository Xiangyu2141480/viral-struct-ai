import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief, ProductFact, ProductIntelligence } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { buildProductNativeStructureGraph } from './productNativeStructureGraph';

const fact = (value: string): ProductFact => ({ value, evidence: [], confidence: 0.8 });

// The terms decideFillStatus.hasRawSourceSpecificSemantics penalizes — must NEVER appear in a native graph.
const SOURCE_SPECIFIC =
  /MacBook|keyboard|laptop|touchpad|hardware|side port|interface|camera|chip|screen|键盘|触控板|硬件|接口|摄像头|芯片|屏幕|笔记本|苹果/i;

function beveragePi(): ProductIntelligence {
  return {
    productName: '康师傅冰红茶',
    category: fact('饮料'),
    complexity: 'low_complexity_impulse_product',
    proofRegime: 'experience',
    coreBenefits: [fact('冰爽解暑'), fact('清凉解渴'), fact('柠檬茶香')],
    usageRituals: [fact('开盖饮用'), fact('运动后补水'), fact('朋友聚会分享')],
    sensoryCues: [fact('冰爽'), fact('柠檬香'), fact('琥珀茶色')],
    socialContexts: [fact('网吧休闲'), fact('朋友聚会')],
    recommendedProofTypes: ['sensory_proof', 'usage_proof', 'social_proof'],
    forbiddenClaims: [],
    targetDurationRecommendation: { preferred: 'high_conversion_20s', alternatives: [], reason: 'test' },
    analysisSource: 'llm'
  };
}

function breadPi(): ProductIntelligence {
  return {
    productName: '巴黎贝甜可颂',
    category: fact('面包'),
    complexity: 'low_complexity_impulse_product',
    proofRegime: 'experience',
    coreBenefits: [fact('酥脆外壳'), fact('浓郁麦香'), fact('层层起酥')],
    usageRituals: [fact('掰开可颂'), fact('涂抹果酱'), fact('咬一口')],
    sensoryCues: [fact('酥脆'), fact('麦香'), fact('黄油香')],
    socialContexts: [fact('下午茶'), fact('早餐分享')],
    recommendedProofTypes: ['sensory_proof', 'usage_proof', 'social_proof'],
    forbiddenClaims: [],
    targetDurationRecommendation: { preferred: 'high_conversion_20s', alternatives: [], reason: 'test' },
    analysisSource: 'llm'
  };
}

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  category: '饮料',
  targetAudience: '年轻人',
  scenario: '运动后/网吧/聚会',
  sellingPoints: ['冰爽解暑'],
  cta: '现在就来一瓶'
};

test('produces a schema-valid ViralStructureGraph', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: beveragePi() });
  assert.doesNotThrow(() => ViralStructureGraphSchema.parse(graph));
  assert.ok(graph.segments.length >= 6 && graph.segments.length <= 8, `arc length ${graph.segments.length}`);
  assert.equal(graph.segments.length, graph.shotSlots.length);
});

test('carries the canonical viral arc (hook → reveal → benefit → usage → social → cta)', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: beveragePi() });
  const slotRoles = graph.shotSlots.map((s) => s.role);
  for (const role of ['opening_attention', 'product_closeup', 'benefit_visual', 'usage_demo', 'testimonial', 'cta_visual'] as const) {
    assert.ok(slotRoles.includes(role), `missing slot role ${role}`);
  }
  // hook first, cta last
  assert.equal(slotRoles[0], 'opening_attention');
  assert.equal(slotRoles[slotRoles.length - 1], 'cta_visual');
});

test('NO source-specific term leaks into the text fields the penalty scans (the whole point)', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: beveragePi() });
  // Scan exactly the fields hasRawSourceSpecificSemantics + the gate read (slot/segment TEXT), not schema
  // field keys like `camera`/`screen` — otherwise an enum field name would be a spurious match.
  const penaltyText = [
    graph.structureSummary,
    ...graph.segments.flatMap((s) => [s.purpose, s.caption ?? '', s.transferRule]),
    ...graph.shotSlots.flatMap((s) => [
      s.requiredAsset.subject,
      s.intent?.purpose ?? '',
      s.intent?.motionPattern ?? '',
      s.sourceInstance?.specificAction ?? '',
      ...(s.acceptanceCriteria?.anyOf.flatMap((a) => a.examples) ?? [])
    ])
  ].join(' ');
  const hit = penaltyText.match(SOURCE_SPECIFIC);
  assert.equal(hit, null, `leaked source-specific term: ${hit?.[0]}`);
});

test('exactly ONE slot carries the 由散到聚 cascade language (the single reveal/cascade owner)', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: beveragePi() });
  const cascadeSlots = graph.shotSlots.filter((s) => /由散到聚/.test(s.requiredAsset.subject));
  assert.equal(cascadeSlots.length, 1);
  assert.equal(cascadeSlots[0].role, 'product_closeup');
});

test('the product name + its PI facts drive the slot language', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: beveragePi() });
  const blob = JSON.stringify(graph);
  assert.ok(blob.includes('康师傅冰红茶'));
  assert.ok(blob.includes('冰爽') && blob.includes('柠檬香')); // sensory cues
  assert.ok(blob.includes('开盖饮用') || blob.includes('运动后补水')); // usage rituals
});

test('generalizes by input: bread PI yields a bread skeleton (bread rituals, NOT beverage actions)', () => {
  const graph = buildProductNativeStructureGraph({ contentBrief: brief, productIntelligence: breadPi() });
  assert.doesNotThrow(() => ViralStructureGraphSchema.parse(graph));
  const blob = JSON.stringify(graph);
  assert.ok(blob.includes('巴黎贝甜可颂'));
  // bread-native ritual language appears…
  assert.ok(/掰开|涂抹|咬一口|酥脆|麦香/.test(blob), 'bread skeleton must speak bread');
  // …and no hardcoded beverage action leaked in (proves it is NOT a fixed beverage template)
  assert.ok(!/开盖|倒入杯中|冰红茶/.test(blob), 'bread skeleton must not contain hardcoded beverage actions');
});
