import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductIntelligence, ViralStructureGraph } from '@viral-struct/shared';
import { planStructuralCompression } from './structuralCompressionPlanner';
import { buildDeterministicProductIntelligence } from '../productIntelligence/productIntelligenceAnalyzer';
import { EARPHONE_VOCAB_FIXTURE } from './vocabularyFixture';

function seg(id: string, role: string, start: number, end: number) {
  return { id, role, start, end, duration: end - start, purpose: role, transferRule: 't', importance: 4 };
}
function slot(id: string, segmentId: string, role: string) {
  return { id, segmentId, role, requiredAsset: { type: 'video', subject: 'x', camera: 'medium', motion: 'static' }, importance: 4 };
}

// Mirrors the macbook shape in miniature: hook + 4 feature(selling_point) + 2 usage + cta (8 source slots).
const graph = {
  schemaVersion: 'v1',
  meta: { duration: 100, aspectRatio: '16:9', videoType: 'ecommerce', style: 'premium' },
  structureSummary: 's',
  segments: [
    seg('s_hook', 'hook', 0, 9),
    seg('s_sp1', 'selling_point', 9, 27),
    seg('s_sp2', 'selling_point', 27, 45),
    seg('s_usage1', 'usage', 45, 63),
    seg('s_sp3', 'selling_point', 63, 75),
    seg('s_sp4', 'selling_point', 75, 90),
    seg('s_usage2', 'usage', 90, 95),
    seg('s_cta', 'cta', 95, 100)
  ],
  shotSlots: [
    slot('slot_hook', 's_hook', 'opening_attention'),
    slot('slot_sp1', 's_sp1', 'product_closeup'),
    slot('slot_sp2', 's_sp2', 'product_closeup'),
    slot('slot_u1', 's_usage1', 'usage_demo'),
    slot('slot_sp3', 's_sp3', 'product_closeup'),
    slot('slot_sp4', 's_sp4', 'product_closeup'),
    slot('slot_u2', 's_usage2', 'usage_demo'),
    slot('slot_cta', 's_cta', 'cta_visual')
  ],
  rhythm: { avgShotDuration: 2, cutFrequency: 'high', pattern: 'p' },
  packaging: { captionDensity: 'high', captionPosition: 'bottom_center', titleStyle: 't', cardTypes: [], transitions: [], coverStyle: 'c' },
  creativeIngredients: [],
  edges: []
} as unknown as ViralStructureGraph;

const _lowComplexityPiBase = buildDeterministicProductIntelligence({
  productName: '康师傅冰红茶',
  category: 'beverage',
  targetAudience: 'a',
  scenario: '聚餐',
  sellingPoints: ['冰爽解腻'],
  cta: 'c'
});

// Override usageRituals so the beat NL test can assert no beverage-specific terms
// (开盖 comes from the beverage deterministic profile; replace with product-neutral values).
const lowComplexityPi: ProductIntelligence = {
  ..._lowComplexityPiBase,
  usageRituals: [
    { value: '取出产品', evidence: [{ source: 'llm_inference', text: '取出产品', confidence: 0.6 }], confidence: 0.6 },
    { value: '完成使用', evidence: [{ source: 'llm_inference', text: '完成使用', confidence: 0.6 }], confidence: 0.6 }
  ]
};

function plan() {
  return planStructuralCompression({
    structureGraph: graph,
    productIntelligence: lowComplexityPi,
    targetDurationMode: 'high_conversion_20s',
    vocab: EARPHONE_VOCAB_FIXTURE
  });
}

test('compression collapses source slots into fewer canonical beats', () => {
  const p = plan();
  assert.ok(p.beats.length < graph.shotSlots.length, 'fewer beats than source slots');
  assert.ok(p.beats.length <= 8);
  assert.equal(p.graph.shotSlots.length, p.beats.length);
});

test('the 4 feature segments are merged into <=2 beats for a low-complexity product', () => {
  const featureBeats = plan().beats.filter((b) => b.preservedStructureFunction === 'feature_or_benefit_proof');
  assert.ok(featureBeats.length <= 2, 'feature beats capped at 2');
  assert.ok(featureBeats.some((b) => b.mergedSourceSegmentIds.length > 1), 'at least one feature beat merges >1 source segment');
  assert.ok(featureBeats.some((b) => b.compressionDecision === 'merge' || b.compressionDecision === 'replace'));
});

test('target duration stays within the preset and the last beat ends exactly at it', () => {
  const p = plan();
  assert.ok(p.targetDurationMs <= 20000);
  const timings = [...p.timingBySlot.values()].sort((a, b) => a.targetStartMs - b.targetStartMs);
  assert.equal(timings[timings.length - 1].targetEndMs, p.targetDurationMs);
  // beats are contiguous (no gaps/overlaps) in target time
  for (let i = 1; i < timings.length; i += 1) {
    assert.equal(timings[i].targetStartMs, timings[i - 1].targetEndMs);
  }
});

test('the arc is ordered canonically: hook first, cta last', () => {
  const p = plan();
  assert.equal(p.beats[0].preservedStructureFunction, 'attention_hook');
  assert.equal(p.beats[p.beats.length - 1].preservedStructureFunction, 'cta_lockup');
});

test('every representative slot id is a real source slot id, and each beat carries a target-equivalent NL', () => {
  const p = plan();
  const sourceIds = new Set(graph.shotSlots.map((s) => s.id));
  for (const id of p.timingBySlot.keys()) assert.ok(sourceIds.has(id), `${id} should be a source slot id`);
  assert.ok(p.beats.every((b) => b.targetEquivalentBeat.length > 0));
});

test('beat NL contains no beverage-specific idioms', () => {
  const p = plan();
  const allNL = p.beats.map((b) => b.targetEquivalentBeat).join(' ');
  assert.doesNotMatch(allNL, /喝完|瓶身|开盖/);
});
