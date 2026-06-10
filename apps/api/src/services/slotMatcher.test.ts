import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, Boundary, ViralStructureGraph } from '@viral-struct/shared';
import { splitRejectIfForTransfer } from '@viral-struct/shared';
import { matchSlots, matchSlotsLLM, matchSlotsWithFallback, statusFromQualityWithEvidence } from './slotMatcher';

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

test('matchSlots filters long-video parent cards and records selected segment timing', () => {
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    role: 'usage_demo',
    requiredAsset: { type: 'video', subject: 'usage action' }
  };
  const parent: AssetCard = {
    id: 'asset_long',
    type: 'video',
    url: '/long.mp4',
    detectedObjects: ['beverage bottle'],
    suitableSlots: ['usage_demo'],
    qualityScore: 0.8,
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '1970-01-01T00:00:00.000Z',
      source: 'deterministic',
      fallbackUsed: false,
      warnings: [],
      media: { kind: 'video', sourceUrl: '/long.mp4', durationSec: 18, keyframes: [] },
      semantic: { summary: 'parent video', detectedObjects: ['product'], detectedIngredients: [], visualStyleTags: [] },
      quality: {
        overallScore: 0.8,
        resolution: 0.8,
        sharpness: 0.8,
        brightness: 0.8,
        contrast: 0.8,
        clarity: 0.8,
        composition: 0.8,
        lighting: 0.8,
        subjectProminence: 0.8,
        productFocus: 0.8,
        textSafeArea: 0.6,
        issues: []
      },
      slotAffordance: { suitableSlots: ['usage_demo'], primaryRoles: [{ role: 'usage_demo', confidence: 0.9 }], missingRoles: [], rationale: 'parent' },
      editability: { canCropZoom: true, canUseAsBackground: true, canLoop: true, canExtendWithCards: true, suggestedEdits: [] },
      safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
      search: { tags: [], keywords: [], embeddingText: '' },
      videoSegments: [{
        id: 'asset_long_seg_001',
        parentAssetId: 'asset_long',
        startSec: 6,
        endSec: 12,
        durationSec: 6,
        label: 'open cap and pour action',
        visualSummary: 'hand opens cap and pours into cup',
        roleHints: ['usage_demo'],
        actionTags: ['open_cap', 'pour_to_cup'],
        qualityScore: 0.82,
        confidence: 0.82,
        keyframeIds: [],
        source: 'deterministic'
      }]
    }
  };
  const segment: AssetCard = {
    ...parent,
    id: 'asset_long_seg_001',
    suitableSlots: ['usage_demo'],
    segmentSource: {
      parentAssetId: 'asset_long',
      startSec: 6,
      endSec: 12,
      durationSec: 6,
      segmentIndex: 0,
      label: 'open cap and pour action',
      visualSummary: 'hand opens cap and pours into cup',
      roleHints: ['usage_demo'],
      actionTags: ['open_cap', 'pour_to_cup'],
      confidence: 0.82,
      source: 'deterministic'
    },
    analysis: {
      ...parent.analysis!,
      videoSegments: parent.analysis!.videoSegments?.slice(0, 1),
      semantic: { ...parent.analysis!.semantic, summary: 'hand opens cap and pours into cup' }
    }
  };

  const result = matchSlots(graph, [parent, segment]);
  const match = result.matches.find((item) => item.slotId === 'slot_a')!;

  assert.equal(match.assetId, 'asset_long_seg_001');
  assert.equal(match.assetSegmentId, 'asset_long_seg_001');
  assert.equal(match.mediaStartSec, 6);
  assert.equal(match.mediaEndSec, 12);
  assert.equal(match.assetEvidence?.parentAssetId, 'asset_long');
  assert.equal(match.assetEvidence?.segmentLabel, 'open cap and pour action');
});

test('matchSlots uses AssetAnalysis role affordance, quality and warnings as asset evidence', () => {
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    role: 'product_closeup',
    requiredAsset: { type: 'image', subject: 'clear product label' },
    visualIngredientRequirements: ['product_closeup_trait']
  };
  const analyzedAsset: AssetCard = {
    id: 'asset_analyzed',
    type: 'image',
    url: '/analyzed.png',
    detectedObjects: ['product', 'label'],
    suitableSlots: [],
    qualityScore: 0.78,
    detectedIngredients: ['product_closeup_trait'],
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '1970-01-01T00:00:00.000Z',
      source: 'deterministic',
      fallbackUsed: false,
      warnings: [],
      media: {
        kind: 'image',
        sourceUrl: '/analyzed.png',
        keyframes: [
          { id: 'kf_label', timeSec: 0, url: '/media/frames/kf_label.jpg', description: 'label closeup', source: 'sampled_frame' }
        ]
      },
      semantic: {
        summary: 'Clear bottle label closeup with centered product.',
        detectedObjects: ['product', 'label'],
        detectedIngredients: ['product_closeup_trait'],
        visualStyleTags: []
      },
      quality: {
        overallScore: 0.92,
        resolution: 0.9,
        sharpness: 0.9,
        brightness: 0.8,
        contrast: 0.8,
        clarity: 0.92,
        composition: 0.88,
        lighting: 0.8,
        subjectProminence: 0.92,
        productFocus: 0.95,
        textSafeArea: 0.7,
        issues: []
      },
      slotAffordance: {
        suitableSlots: ['product_closeup'],
        primaryRoles: [{ role: 'product_closeup', confidence: 0.95 }],
        missingRoles: [],
        rationale: 'analysis role fit'
      },
      editability: {
        canCropZoom: true,
        canUseAsBackground: true,
        canLoop: false,
        canExtendWithCards: true,
        suggestedEdits: ['crop_zoom']
      },
      safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
      search: { tags: ['product_closeup'], keywords: ['label'], embeddingText: 'label closeup' },
      roleAffordance: [{
        role: 'product_closeup',
        score: 96,
        components: {
          semanticFit: 96,
          visualSignalFit: 94,
          productVisibilityFit: 95,
          qualityFit: 92,
          formatFit: 92,
          editabilityFit: 86,
          safetyFit: 100
        },
        rationale: 'Strong product closeup evidence from deterministic analysis.'
      }]
    }
  };
  const weakLegacyAsset: AssetCard = {
    id: 'asset_legacy',
    type: 'image',
    url: '/legacy.png',
    detectedObjects: ['product'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.45
  };

  const result = matchSlots(graph, [weakLegacyAsset, analyzedAsset]);
  const match = result.matches.find((item) => item.slotId === 'slot_a')!;

  assert.equal(match.assetId, 'asset_analyzed');
  assert.ok(match.score > 0.75);
  assert.equal(match.assetEvidence?.assetId, 'asset_analyzed');
  assert.equal(match.assetEvidence?.topAffordanceRole, 'product_closeup');
  assert.ok((match.assetEvidence?.topAffordanceScore ?? 0) >= 90);
  assert.equal(match.assetEvidence?.productVisibilityScore, 95);
  assert.deepEqual(match.assetEvidence?.keyframeIds, ['kf_label']);
  assert.ok(match.assetEvidence?.reasons.some((reason) => reason.includes('product_closeup')));
});

test('matchSlots penalizes low quality and warning-heavy analysis evidence', () => {
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    role: 'product_closeup',
    requiredAsset: { type: 'image', subject: 'clear product label' }
  };
  const clean: AssetCard = {
    id: 'clean',
    type: 'image',
    detectedObjects: ['product', 'label'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.9,
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '1970-01-01T00:00:00.000Z',
      source: 'deterministic',
      fallbackUsed: false,
      warnings: [],
      media: { kind: 'image', keyframes: [] },
      semantic: { summary: 'clean product', detectedObjects: ['product'], detectedIngredients: [], visualStyleTags: [] },
      quality: {
        overallScore: 0.9,
        resolution: 0.9,
        sharpness: 0.9,
        brightness: 0.8,
        contrast: 0.8,
        clarity: 0.9,
        composition: 0.9,
        lighting: 0.8,
        subjectProminence: 0.9,
        productFocus: 0.92,
        textSafeArea: 0.7,
        issues: []
      },
      slotAffordance: { suitableSlots: ['product_closeup'], primaryRoles: [{ role: 'product_closeup', confidence: 0.9 }], missingRoles: [], rationale: 'clean' },
      editability: { canCropZoom: true, canUseAsBackground: true, canLoop: false, canExtendWithCards: true, suggestedEdits: [] },
      safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
      search: { tags: [], keywords: [], embeddingText: '' },
      roleAffordance: [{
        role: 'product_closeup',
        score: 90,
        components: { semanticFit: 90, visualSignalFit: 90, productVisibilityFit: 92, qualityFit: 90, formatFit: 90, editabilityFit: 80, safetyFit: 100 },
        rationale: 'clean evidence'
      }]
    }
  };
  const noisy: AssetCard = {
    ...clean,
    id: 'noisy',
    qualityScore: 0.9,
    analysis: {
      ...clean.analysis!,
      warnings: ['metadata fallback', 'sharpness fallback', 'missing keyframes'],
      quality: {
        ...clean.analysis!.quality,
        overallScore: 0.35,
        productFocus: 0.3
      },
      roleAffordance: [{
        ...clean.analysis!.roleAffordance![0],
        score: 90,
        components: {
          ...clean.analysis!.roleAffordance![0].components,
          qualityFit: 35,
          productVisibilityFit: 30
        }
      }]
    }
  };

  const cleanScore = matchSlots(graph, [clean]).matches[0].score;
  const noisyScore = matchSlots(graph, [noisy]).matches[0].score;

  assert.ok(noisyScore < cleanScore, `expected noisyScore (${noisyScore}) < cleanScore (${cleanScore})`);
  assert.ok(matchSlots(graph, [noisy]).matches[0].assetEvidence?.warnings.length);
});

test('matchSlots carries motif context into material gaps for kinetic assembly slots', () => {
  const graph = makeGraph();
  graph.shotSlots = [{
    id: 'slot_block_004_asset_001',
    segmentId: 'seg_a',
    role: 'usage_demo',
    requiredAsset: { type: 'video', subject: 'surreal product assembly and activation spectacle', motion: 'fast_cut' },
    fallbackStrategies: ['ask_user_for_human_demo'],
    importance: 5,
    intent: {
      purpose: '键盘碎片在空中飞舞后落到笔记本上自动组装完成，手指按触控板控制屏幕里的火箭飞出笔记本炸开撒彩屑，按圆形按键弹出购买窗口。',
      energyLevel: 'high',
      motionPattern: 'component cascade, chaos to order, assembly completion, interaction activation, spectacle burst, CTA reveal',
      compositionPrincipal: 'surreal kinetic assembly reveal',
      durationMs: [1600, 4200]
    },
    sourceInstance: {
      productInSource: 'MacBook',
      specificAction: 'keyboard fragments assemble, touchpad controls rocket, circular button opens purchase window'
    }
  }];

  const result = matchSlots(graph, makeAssets());
  assert.equal(result.gaps[0]?.slotId, 'slot_block_004_asset_001');
  assert.equal(result.gaps[0]?.motifContext?.motifType, 'kinetic_assembly_reveal');
  assert.ok(result.gaps[0]?.motifContext?.motionTokens.includes('chaos_to_order'));
});

test('splitRejectIfForTransfer separates source-specific source-product constraints from hard rejects', () => {
  const split = splitRejectIfForTransfer({
    rejectIf: [
      '背景杂乱',
      '产品被遮挡',
      '产品形态完全固定无开合结构的素材',
      '没有键盘',
      '没有触控板',
      '没有 screen / port / chassis evidence'
    ],
    targetCategory: 'beverage'
  });

  assert.deepEqual(split.hardRejectIf, ['背景杂乱', '产品被遮挡']);
  assert.deepEqual(split.sourceSpecificRejectIf, [
    '产品形态完全固定无开合结构的素材',
    '没有键盘',
    '没有触控板',
    '没有 screen / port / chassis evidence'
  ]);
});

test('statusFromQualityWithEvidence rescues near-threshold asset evidence from missing', () => {
  assert.equal(statusFromQualityWithEvidence({
    quality: 0.42,
    hasAsset: true,
    assetEvidenceStrength: 'weak'
  }), 'partial');

  assert.equal(statusFromQualityWithEvidence({
    quality: 0.42,
    hasAsset: true,
    assetEvidenceStrength: 'none'
  }), 'missing');

  assert.equal(statusFromQualityWithEvidence({
    quality: 0.72,
    hasAsset: true,
    assetEvidenceStrength: 'medium',
    hardRejectTriggered: true
  }), 'missing');
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

function makeCapturingFakeClient(responseJson: string, requests: unknown[]): FakeClient {
  return {
    chat: {
      completions: {
        create: async (req: unknown) => {
          requests.push(req);
          return { choices: [{ message: { content: responseJson } }] };
        }
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

test('matchSlotsLLM includes compressed asset analysis evidence in the prompt and output match', async () => {
  const requests: unknown[] = [];
  const assets = makeAssets();
  assets[0] = {
    ...assets[0],
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '1970-01-01T00:00:00.000Z',
      source: 'deterministic',
      fallbackUsed: false,
      warnings: ['brightness fallback'],
      media: {
        kind: 'image',
        keyframes: [{ id: 'kf_001', description: 'product splash keyframe', source: 'sampled_frame' }]
      },
      semantic: {
        summary: 'high-energy product splash',
        detectedObjects: ['product', 'splash'],
        detectedIngredients: ['product_closeup_trait'],
        visualStyleTags: ['premium_visual']
      },
      quality: {
        overallScore: 0.91,
        resolution: 0.9,
        sharpness: 0.88,
        brightness: 0.7,
        contrast: 0.82,
        clarity: 0.9,
        composition: 0.9,
        lighting: 0.8,
        subjectProminence: 0.92,
        productFocus: 0.93,
        textSafeArea: 0.7,
        issues: []
      },
      slotAffordance: { suitableSlots: ['opening_attention'], primaryRoles: [{ role: 'opening_attention', confidence: 0.92 }], missingRoles: [], rationale: 'opening' },
      editability: { canCropZoom: true, canUseAsBackground: true, canLoop: false, canExtendWithCards: true, suggestedEdits: [] },
      safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
      search: { tags: ['opening_hook'], keywords: ['splash'], embeddingText: 'splash' },
      roleAffordance: [{
        role: 'opening_hook',
        score: 93,
        components: { semanticFit: 93, visualSignalFit: 90, productVisibilityFit: 92, qualityFit: 91, formatFit: 82, editabilityFit: 86, safetyFit: 100 },
        rationale: 'opening hook evidence'
      }]
    }
  };

  const result = await matchSlotsLLM({
    graph: makeGraph(),
    assets,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: () => makeCapturingFakeClient(happyAlignmentResponse(), requests) as any,
    model: 'fake-model'
  });

  const requestText = JSON.stringify(requests[0]);
  assert.match(requestText, /high-energy product splash/);
  assert.match(requestText, /opening_hook/);
  assert.match(requestText, /quality/);
  assert.match(requestText, /kf_001/);
  assert.equal(result.matches[0].assetEvidence?.assetId, 'asset_1');
  assert.equal(result.matches[0].assetEvidence?.topAffordanceRole, 'opening_hook');
});

test('matchSlotsLLM sends transfer-safe acceptance criteria instead of raw source-specific rejectIf hard gates', async () => {
  const requests: unknown[] = [];
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    acceptanceCriteria: {
      anyOf: [{ motionType: 'open_close', examples: ['开合结构完成一次状态变化'] }],
      rejectIf: [
        '背景杂乱',
        '产品形态完全固定无开合结构的素材',
        '没有键盘',
        '没有触控板'
      ]
    }
  };

  await matchSlotsLLM({
    graph,
    assets: makeAssets(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: () => makeCapturingFakeClient(happyAlignmentResponse(), requests) as any,
    model: 'fake-model'
  });

  const requestText = JSON.stringify(requests[0]);
  assert.match(requestText, /hardRejectIf/);
  assert.match(requestText, /sourceSpecificRejectIf/);
  assert.match(requestText, /背景杂乱/);
  assert.match(requestText, /产品形态完全固定无开合结构的素材/);
  assert.match(requestText, /sourceSpecificRejectIf 是源品类专属限制/);

  const hardRejectSection = requestText.slice(requestText.indexOf('hardRejectIf'), requestText.indexOf('sourceSpecificRejectIf'));
  assert.doesNotMatch(hardRejectSection, /键盘|触控板|开合结构/);
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
