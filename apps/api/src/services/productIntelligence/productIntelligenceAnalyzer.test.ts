import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief } from '@viral-struct/shared';
import { ProductIntelligenceSchema } from '@viral-struct/shared';
import { analyzeProductIntelligence, buildDeterministicProductIntelligence } from './productIntelligenceAnalyzer';

const beverageBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  category: 'beverage',
  targetAudience: '夏天通勤年轻人',
  scenario: '炎热天气、聚餐、户外',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享'],
  cta: '现在就来一瓶'
};

test('deterministic PI classifies a beverage as low-complexity impulse with sensory/usage proof', () => {
  const pi = buildDeterministicProductIntelligence(beverageBrief);
  assert.equal(pi.complexity, 'low_complexity_impulse_product');
  assert.ok(pi.recommendedProofTypes.includes('sensory_proof'));
  assert.ok(pi.recommendedProofTypes.includes('usage_proof'));
  assert.equal(pi.targetDurationRecommendation.preferred, 'high_conversion_20s');
  assert.equal(pi.analysisSource, 'deterministic');
  // schema-valid output (it is the contract downstream consumes)
  assert.doesNotThrow(() => ProductIntelligenceSchema.parse(pi));
});

test('deterministic PI always emits the universal ad-claim boundaries', () => {
  const pi = buildDeterministicProductIntelligence(beverageBrief);
  const risks = pi.forbiddenClaims.map((c) => c.risk);
  assert.ok(risks.includes('health_or_medical'));
  assert.ok(risks.includes('absolute_superlative'));
  assert.ok(risks.includes('before_after'));
});

test('deterministic PI classifies electronics as high complexity with feature proof + longer duration', () => {
  const pi = buildDeterministicProductIntelligence({
    productName: 'Neo 笔记本电脑',
    targetAudience: '创作者',
    scenario: '办公与创作',
    sellingPoints: ['超薄机身', '高性能芯片', '全功能接口'],
    cta: '立即购买'
  });
  assert.equal(pi.complexity, 'high_complexity_feature_product');
  assert.ok(pi.recommendedProofTypes.includes('feature_proof'));
  assert.equal(pi.targetDurationRecommendation.preferred, 'full_story_30s');
});

test('user selling points become core benefits with user_description evidence', () => {
  const pi = buildDeterministicProductIntelligence(beverageBrief);
  assert.equal(pi.coreBenefits.length, beverageBrief.sellingPoints.length);
  assert.ok(pi.coreBenefits.every((f) => f.evidence.some((e) => e.source === 'user_description')));
});

test('analyzeProductIntelligence with useLlm:false returns the deterministic fallback', async () => {
  const res = await analyzeProductIntelligence({ contentBrief: beverageBrief, useLlm: false });
  assert.equal(res.productIntelligence.analysisSource, 'deterministic');
  assert.equal(res.productIntelligence.complexity, 'low_complexity_impulse_product');
});
