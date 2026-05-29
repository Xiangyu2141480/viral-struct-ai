import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, Boundary, ViralStructureGraph } from '@viral-struct/shared';
import { matchSlots, matchSlotsLLM, matchSlotsWithFallback } from './slotMatcher';

function makeGraph(): ViralStructureGraph {
  return {
    meta: { duration: 10, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
    structureSummary: 'test',
    segments: [
      { id: 'seg_a', role: 'hook', start: 0, end: 5, duration: 5, purpose: '', transferRule: '', importance: 5 },
      { id: 'seg_b', role: 'cta', start: 5, end: 10, duration: 5, purpose: '', transferRule: '', importance: 4 }
    ],
    shotSlots: [
      {
        id: 'slot_a',
        segmentId: 'seg_a',
        role: 'opening_attention',
        requiredAsset: { type: 'image', subject: 'hook visual' },
        fallbackStrategies: ['text_card'],
        importance: 5
      },
      {
        id: 'slot_b',
        segmentId: 'seg_b',
        role: 'cta_visual',
        requiredAsset: { type: 'image', subject: 'cta visual' },
        fallbackStrategies: ['cta_card'],
        importance: 4
      }
    ],
    rhythm: { avgShotDuration: 2.5, cutFrequency: 'medium', pattern: 'avg_2.5s_per_shot_medium_cut' },
    packaging: { captionDensity: 'low', captionPosition: 'mixed', titleStyle: 'minimal_clean', cardTypes: [], transitions: ['hard_cut'], coverStyle: 'product_centered_clean_background' },
    creativeIngredients: [],
    edges: []
  };
}

function makeAssets(): AssetCard[] {
  return [
    {
      id: 'asset_1',
      type: 'image',
      url: '/x.png',
      detectedObjects: ['product'],
      suitableSlots: ['opening_attention'],
      qualityScore: 0.6
    },
    {
      id: 'asset_2',
      type: 'image',
      url: '/y.png',
      detectedObjects: ['product'],
      suitableSlots: ['cta_visual'],
      qualityScore: 0.6
    }
  ];
}

test('matchSlots returns identical scores when boundaries is undefined', () => {
  const graph = makeGraph();
  const assets = makeAssets();
  const a = matchSlots(graph, assets);
  const b = matchSlots(graph, assets, undefined);
  assert.deepEqual(a.matches.map(m => m.score), b.matches.map(m => m.score));
});

test('matchSlots adds boundary bonus when slot segment touches strong morph boundary', () => {
  const graph = makeGraph();
  const assets = makeAssets();
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'morph', intensity: 'strong' }
  ];
  const baseline = matchSlots(graph, assets).matches.find(m => m.slotId === 'slot_a')!;
  const bonused = matchSlots(graph, assets, boundaries).matches.find(m => m.slotId === 'slot_a')!;
  assert.ok(
    bonused.score > baseline.score,
    `expected bonused.score (${bonused.score}) > baseline.score (${baseline.score})`
  );
  assert.ok(
    bonused.score - baseline.score <= 0.05 + 1e-9,
    `bonus must be capped at 0.05; got ${bonused.score - baseline.score}`
  );
});

test('matchSlots applies no bonus for weak/cut boundaries', () => {
  const graph = makeGraph();
  const assets = makeAssets();
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'cut', intensity: 'weak' }
  ];
  const baseline = matchSlots(graph, assets).matches.find(m => m.slotId === 'slot_a')!;
  const noBonus = matchSlots(graph, assets, boundaries).matches.find(m => m.slotId === 'slot_a')!;
  assert.equal(noBonus.score, baseline.score);
});

// ---------------------------------------------------------------------------
// LLM judge tests
// ---------------------------------------------------------------------------

interface FakeClient {
  chat: { completions: { create: (req: unknown) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

function makeFakeClient(responseJson: string): FakeClient {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: responseJson } }] })
      }
    }
  };
}

function happyAlignmentResponse(): string {
  return JSON.stringify({
    slot_a: {
      assetId: 'asset_1',
      quality: 0.9,
      matchedCriteria: ['fluid_dynamics (液体飞溅)'],
      missing: '',
      treatmentSpec: {
        motion: 'zoom_in_on_splash',
        durationMs: 1400,
        syncPoint: null,
        captionOverlay: '冰爽到第 1 秒'
      }
    },
    slot_b: {
      assetId: null,
      quality: 0.2,
      matchedCriteria: [],
      missing: '槽位要求 CTA 收束动作，但所有素材都是产品静物图，无 CTA 元素。',
      treatmentSpec: { motion: null, durationMs: null, syncPoint: null, captionOverlay: null }
    }
  });
}

test('matchSlotsLLM derives matched / missing status from quality threshold', async () => {
  const result = await matchSlotsLLM({
    graph: makeGraph(),
    assets: makeAssets(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: () => makeFakeClient(happyAlignmentResponse()) as any,
    model: 'fake-model'
  });
  const a = result.matches.find((m) => m.slotId === 'slot_a')!;
  const b = result.matches.find((m) => m.slotId === 'slot_b')!;
  assert.equal(a.status, 'matched');
  assert.equal(a.assetId, 'asset_1');
  assert.equal(a.treatmentSpec?.motion, 'zoom_in_on_splash');
  assert.equal(a.treatmentSpec?.captionOverlay, '冰爽到第 1 秒');
  assert.equal(a.treatmentSpec?.syncPoint, undefined); // null stripped
  assert.equal(a.alignmentSource, 'llm_judge');
  assert.equal(b.status, 'missing');
  assert.equal(b.assetId, undefined);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].slotId, 'slot_b');
});

test('matchSlotsLLM rejects response referencing unknown assetId', async () => {
  const bad = JSON.stringify({
    slot_a: { assetId: 'asset_999', quality: 0.9, matchedCriteria: [], missing: '', treatmentSpec: {} },
    slot_b: { assetId: null, quality: 0.0, matchedCriteria: [], missing: 'x', treatmentSpec: {} }
  });
  await assert.rejects(
    matchSlotsLLM({
      graph: makeGraph(),
      assets: makeAssets(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(bad) as any,
      model: 'fake'
    }),
    /unknown assetId/
  );
});

test('matchSlotsLLM rejects when LLM omits a slot', async () => {
  const partial = JSON.stringify({
    slot_a: { assetId: 'asset_1', quality: 0.9, matchedCriteria: [], missing: '', treatmentSpec: {} }
    // slot_b missing
  });
  await assert.rejects(
    matchSlotsLLM({
      graph: makeGraph(),
      assets: makeAssets(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(partial) as any,
      model: 'fake'
    }),
    /missing slot/
  );
});

test('matchSlotsWithFallback falls back to rule-based when LLM throws', async () => {
  const result = await matchSlotsWithFallback({
    graph: makeGraph(),
    assets: makeAssets(),
    clientFactory: () => { throw new Error('LLM unreachable'); }
  });
  assert.equal(result.alignmentSource, 'rule_based');
  assert.ok(result.warning?.includes('LLM unreachable'));
  for (const m of result.matches) {
    assert.equal(m.alignmentSource, 'rule_based');
  }
});
