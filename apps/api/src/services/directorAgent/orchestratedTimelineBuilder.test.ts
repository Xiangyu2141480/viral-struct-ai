import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrchestratedTimelineSchema, type CreativeIngredient } from '@viral-struct/shared';
import { buildOrchestratedTimeline } from './orchestratedTimelineBuilder';
import { makeAssets, makeContentBrief, makeFakeClient, makeGraph } from './testFixtures';

const MODEL = 'fake-model';

function happyAlignments() {
  return {
    slot_open: { assetId: 'asset_open', quality: 0.9, matchedCriteria: ['product enters frame'] },
    slot_usage: { assetId: 'asset_usage', quality: 0.6, missing: 'clear open-cap action' },
    slot_cta: { assetId: null, quality: 0.2, missing: 'no clean CTA frame' }
  };
}

test('produces exactly one OrchestratedSlot per shotSlot, in time order, schema-valid', async () => {
  const graph = makeGraph();
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: graph,
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient(happyAlignments()),
    model: MODEL
  });

  assert.equal(timeline.slots.length, graph.shotSlots.length);
  // schema round-trip (planOnly, transitions length, etc.)
  OrchestratedTimelineSchema.parse(timeline);
  assert.equal(timeline.meta.planOnly, true);
  assert.deepEqual(
    timeline.slots.map((s) => s.index),
    timeline.slots.map((_, i) => i)
  );
  for (let i = 1; i < timeline.slots.length; i += 1) {
    assert.ok(timeline.slots[i].startMs >= timeline.slots[i - 1].startMs);
  }
});

test('degradation ladder: strong=matched, weak=partial+options, missing=gap+3 options', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient(happyAlignments()),
    model: MODEL
  });

  const open = timeline.slots.find((s) => s.slotId === 'slot_open')!.fill;
  assert.equal(open.kind, 'matched');
  if (open.kind === 'matched') {
    assert.equal(open.status, 'matched');
    assert.equal(open.assetId, 'asset_open');
    assert.equal(open.options, undefined); // matched needs no enhancement
  }

  const usage = timeline.slots.find((s) => s.slotId === 'slot_usage')!.fill;
  assert.equal(usage.kind, 'matched');
  if (usage.kind === 'matched') {
    assert.equal(usage.status, 'partial');
    assert.equal(usage.assetId, 'asset_usage'); // asset is still filled in
    assert.equal(usage.options?.length, 3);
    assert.equal(usage.recommendedOptionId, 'hyperframes'); // §6.4: partial → hyperframes
  }

  const cta = timeline.slots.find((s) => s.slotId === 'slot_cta')!.fill;
  assert.equal(cta.kind, 'gap');
  if (cta.kind === 'gap') {
    assert.equal(cta.options.length, 3);
    assert.deepEqual(cta.options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  }
});

test('source-specific gate downgrades a high-score match to partial (never matched)', async () => {
  const graph = makeGraph();
  // Mark slot_open's required element as not transferable to a new product category.
  const ingredient: CreativeIngredient = {
    id: 'ci_source_specific',
    type: 'product_closeup_trait',
    name: 'source-product-specific interaction',
    description: 'a hardware interaction only the source product can perform',
    segmentIds: ['seg_hook'],
    requiredForSlotIds: ['slot_open'],
    transferability: 'not_transferable',
    fallbackStrategies: ['text_card'],
    evidence: [],
    confidence: 0.9
  };
  graph.creativeIngredients = [ingredient];

  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: graph,
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    // high score that would otherwise be matched
    clientFactory: makeFakeClient({
      slot_open: { assetId: 'asset_open', quality: 0.95 },
      slot_usage: { assetId: 'asset_usage', quality: 0.6 },
      slot_cta: { assetId: null, quality: 0.2 }
    }),
    model: MODEL
  });

  const open = timeline.slots.find((s) => s.slotId === 'slot_open')!.fill;
  assert.equal(open.kind, 'matched');
  if (open.kind === 'matched') {
    assert.equal(open.status, 'partial'); // gated down from matched
    assert.ok(open.evidence.blockingReasons.length >= 1);
  }
});

test('falls back to rule-based matching and still emits a complete timeline when the LLM throws', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: () => {
      throw new Error('LLM unreachable');
    },
    model: MODEL
  });

  assert.equal(timeline.meta.matchSource, 'rule_based');
  assert.equal(timeline.slots.length, 3);
  assert.ok(timeline.warnings.some((w) => w.includes('LLM unreachable')));
  OrchestratedTimelineSchema.parse(timeline);
});

test('useLlmMatcher:false uses the rule-based matcher without touching the LLM', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    useLlmMatcher: false,
    clientFactory: () => {
      throw new Error('should not be called');
    }
  });
  assert.equal(timeline.meta.matchSource, 'rule_based');
});

test('does not mutate the Asset Manager output it consumes', async () => {
  const { buildAssetSupplyContext } = await import('../assetManager/assetSupplyContextBuilder');
  const graph = makeGraph();
  const assets = makeAssets();
  const supply = buildAssetSupplyContext({ structureGraph: graph, assetCards: assets, contentBrief: makeContentBrief() });
  const before = JSON.stringify(supply);

  await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: graph,
    assetCards: assets,
    assetSupplyContext: supply,
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient(happyAlignments()),
    model: MODEL
  });

  assert.equal(JSON.stringify(supply), before);
});

test('no source-product term leaks into any POSITIVE prompt/instruction even from a source-specific slot', async () => {
  // A slot whose source intent/instance is bound to the source product (MacBook/keyboard/rocket).
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    requiredAsset: { type: 'video', subject: 'MacBook Neo keyboard assembly' },
    intent: {
      purpose: '键盘碎片飞舞后在 MacBook 上自动组装，手指按触控板让火箭飞出炸开',
      energyLevel: 'high',
      motionPattern: 'component cascade, chaos to order, assembly completion',
      compositionPrincipal: 'surreal kinetic assembly reveal',
      durationMs: [1600, 4200]
    },
    sourceInstance: { productInSource: 'MacBook', specificAction: 'keyboard assembles, touchpad controls rocket' }
  };

  const timeline = await buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: graph,
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient(happyAlignments()),
    model: MODEL
  });

  // Negative-direction fields legitimately name banned terms as guardrails ("no MacBook"); the leak we
  // forbid is a source term in a POSITIVE prompt/instruction. Scan everything except negative keys.
  const negativeKeys = new Set(['negativePrompt', 'avoid']);
  const terms = ['macbook', 'keyboard', 'touchpad', 'rocket', 'laptop'];
  const hits: string[] = [];
  const walk = (value: unknown, key?: string): void => {
    if (key && negativeKeys.has(key)) return;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      for (const term of terms) if (lower.includes(term)) hits.push(`${key}:${term}`);
    } else if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
    }
  };
  walk(timeline);
  assert.deepEqual(hits, [], `source terms leaked into positive fields: ${hits.join(', ')}`);
});
