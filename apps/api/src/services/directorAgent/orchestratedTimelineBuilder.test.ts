import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrchestratedTimelineSchema, type AssetSupplyContext, type CreativeIngredient, type MotifContext, type ViralStructureGraph } from '@viral-struct/shared';
import { buildAssetSupplyContext } from '../assetManager/assetSupplyContextBuilder';
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

function makeKineticMotifContext(): MotifContext {
  return {
    motifAnnotationId: 'motif_kinetic_004',
    motifType: 'kinetic_assembly_reveal',
    motionTokens: [
      'component_cascade',
      'chaos_to_order',
      'assembly_completion',
      'interaction_activation',
      'spectacle_burst',
      'cta_reveal'
    ],
    missingMotionTokens: ['component_cascade', 'chaos_to_order', 'spectacle_burst', 'cta_reveal'],
    sanitizedIntent: 'dynamic assembly, activation, spectacle burst and CTA reveal',
    targetMotifHints: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'CTA lock-up'],
    confidence: 0.92,
    evidence: ['test motif context']
  };
}

function makeKineticAssemblyGraph(): ViralStructureGraph {
  const graph = makeGraph();
  graph.meta.duration = 229;
  graph.segments = [
    { id: 'seg_004', role: 'usage', start: 84, end: 110, duration: 26, purpose: 'kinetic assembly', transferRule: '', importance: 5 }
  ];
  graph.shotSlots = [
    {
      id: 'slot_block_004_asset_001',
      segmentId: 'seg_004',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: 'surreal kinetic assembly reveal', motion: 'hand_operation' },
      fallbackStrategies: ['hand_demo', 'selling_point_card'],
      importance: 5,
      intent: {
        purpose: '键盘碎片在空中飞舞后落到笔记本上自动组装完成，手指按触控板控制屏幕里的火箭飞出笔记本炸开撒彩屑，按圆形按键弹出购买窗口。',
        energyLevel: 'high',
        motionPattern: 'component cascade, chaos to order, assembly completion, interaction activation, spectacle burst, cta reveal',
        compositionPrincipal: 'kinetic assembly reveal',
        durationMs: [1200, 4200]
      },
      sourceInstance: {
        productInSource: 'MacBook',
        specificAction: 'keyboard assembles, touchpad controls rocket and purchase window'
      },
      motifAnnotations: [
        {
          id: 'motif_kinetic_004',
          motifType: 'kinetic_assembly_reveal',
          confidence: 0.92,
          motionTokens: [
            'component_cascade',
            'chaos_to_order',
            'assembly_completion',
            'interaction_activation',
            'spectacle_burst',
            'cta_reveal'
          ],
          sanitizedIntent: 'dynamic assembly, activation, spectacle burst and CTA reveal',
          transferVariables: [],
          bannedSourceTerms: ['keyboard', 'laptop', 'touchpad', 'rocket', 'hardware'],
          targetCategoryMapping: {
            targetCategory: 'beverage',
            preferredEquivalents: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'cap opening', 'pour to cup', 'CTA lock-up'],
            rejectedEquivalents: ['keyboard', 'laptop', 'touchpad', 'rocket', 'hardware'],
            rationale: 'Preserve kinetic assembly grammar with beverage-native objects.'
          },
          evidence: ['source slot describes component cascade, activation, spectacle burst and CTA reveal']
        }
      ]
    }
  ];
  return graph;
}

function makeWeakKineticSupply(): AssetSupplyContext {
  const context = buildAssetSupplyContext({
    structureGraph: makeKineticAssemblyGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief()
  });
  const motifContext = makeKineticMotifContext();
  const weakIngredient = {
    requiredIngredientId: 'ingredient_motion_assembly',
    label: 'chaos-to-order assembly and spectacle burst evidence',
    reason: 'hand pickup footage cannot prove kinetic assembly reveal',
    evidence: ['missing component cascade', 'missing spectacle burst', 'missing CTA reveal']
  };
  context.libraryId = 'test_kinetic_supply';
  if (context.contextualCoverage) {
    context.contextualCoverage.libraryId = 'test_kinetic_supply';
    context.contextualCoverage.coverageSummary = {
      totalSlots: 1,
      coveredSlots: 0,
      weakSlots: 1,
      insufficientSlots: 0,
      coverageScore: 52
    };
    context.contextualCoverage.slotCoverages = [
      {
        slotId: 'slot_block_004_asset_001',
        affectedSegmentId: 'seg_004',
        slotRole: 'usage_demo',
        slotIntent: 'dynamic assembly, activation, spectacle burst and CTA reveal',
        requiredIngredients: [],
        availableIngredients: [],
        missingIngredients: [],
        weakIngredients: [weakIngredient],
        candidateAssets: [
          {
            assetId: 'plain_002_hand_pickup',
            score: 56,
            fitStatus: 'usable',
            usableAs: 'video_clip',
            mediaReadiness: {
              hasUsableUrl: true,
              hasLocalPath: true,
              hasThumbnail: false,
              hasKeyframe: false,
              hasDuration: false
            },
            constraints: { notEnoughForStandaloneShot: true },
            evidence: {
              affordanceScore: 55,
              qualityScore: 70,
              semanticSignals: ['hand pickup', 'product visible'],
              reasons: ['usable product evidence but no kinetic assembly'],
              warnings: ['weak motion evidence']
            }
          }
        ],
        coverageStatus: 'weak',
        confidence: 'medium',
        evidence: ['candidate is weak and needs synthetic/edited enhancement'],
        limitations: ['missing assembly cascade and CTA reveal'],
        motifContext
      }
    ];
    context.contextualCoverage.observations = [];
  }
  context.missingMaterialBriefs = [
      {
        id: 'brief_kinetic_004',
        affectedSegmentId: 'seg_004',
        affectedSlotId: 'slot_block_004_asset_001',
        slotRole: 'usage_demo',
        slotIntent: 'dynamic assembly, activation, spectacle burst and CTA reveal',
        missingIngredients: [weakIngredient],
        potentialImpact: [
          {
            type: 'usage_proof_missing',
            severity: 'high',
            affectedMetric: 'slotCoverage',
            description: 'The source motif is lost if treated as ordinary usage.'
          }
        ],
        manualShootBrief: {
          title: '补拍冰爽组装揭示',
          objective: 'Capture beverage-native assembly and activation motion.',
          shotDescription: 'Ice cubes, lemon slices and tea droplets cascade toward the bottle, then cap pop or pour activates the CTA end frame.',
          durationSec: 4,
          framing: 'vertical hero product shot',
          requiredProps: ['bottle', 'ice cubes', 'lemon slices', 'cup'],
          mustCapture: ['ingredient cascade', 'activation', 'CTA lock-up'],
          avoid: ['source hardware']
        },
        aigcGenerationBrief: {
          providerHint: 'seedance',
          prompt: 'Prompt only: ice cubes, lemon slices, tea droplets and cold mist form a chaos-to-order beverage reveal.',
          negativePrompt: 'no keyboard, no laptop, no rocket, no hardware',
          referenceAssetIds: ['plain_002_hand_pickup'],
          expectedDurationSec: 4,
          aspectRatio: '9:16',
          safetyNotes: ['handoff only']
        },
        hyperframesBrief: {
          title: '冰爽级联动效卡',
          cardType: 'timeline_bridge_card',
          copyIntent: 'Retain assembly grammar with beverage-native elements.',
          visualElements: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'CTA lock-up'],
          animationHints: ['cascade', 'activation burst', 'CTA lock-up'],
          durationSec: 3,
          inputAssets: ['plain_002_hand_pickup']
        },
        channelEligibility: [
          {
            channel: 'aigc_video_prompt',
            eligible: true,
            confidence: 'medium',
            reason: 'needs generated motif bridge',
            requiredInputs: ['product reference'],
            providedInputs: ['plain_002_hand_pickup'],
            missingInputs: [],
            ownership: 'external_generation_adapter'
          }
        ],
        motifContext,
        ownership: 'asset_manager_handoff_brief_only'
      }
    ];
  return context;
}

test('weak kinetic assembly motif is not treated as fully matched and carries motif-aware options', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p_kinetic',
    structureGraph: makeKineticAssemblyGraph(),
    assetCards: makeAssets(),
    assetSupplyContext: makeWeakKineticSupply(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient({
      slot_block_004_asset_001: { assetId: 'plain_002_hand_pickup', quality: 0.94, matchedCriteria: ['product visible'] }
    }),
    model: MODEL
  });

  const slot = timeline.slots[0];
  assert.equal(slot.motifType, 'kinetic_assembly_reveal');
  assert.equal(slot.fillStatus, 'needs_hyperframes_enhancement');
  assert.equal(slot.fill.kind, 'matched');
  if (slot.fill.kind === 'matched') {
    assert.equal(slot.fill.status, 'partial');
    assert.equal(slot.fill.options?.length, 3);
    const positiveText = JSON.stringify(slot.fill.options);
    assert.match(positiveText, /冰块|柠檬|茶滴|冷雾/);
    assert.match(positiveText, /CTA|收口|锁定/);
    assert.doesNotMatch(positiveText, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
  }
});

test('source-specific hardware semantics are downgraded and rewritten to beverage equivalents', async () => {
  const graph = makeGraph();
  graph.shotSlots[0] = {
    ...graph.shotSlots[0],
    id: 'slot_hardware_interface',
    role: 'product_closeup',
    requiredAsset: { type: 'video', subject: 'side port hardware interface reveal' },
    intent: {
      purpose: '展示笔记本侧边接口、摄像头和硬件部件归位',
      energyLevel: 'medium',
      motionPattern: 'interface reveal and hardware assembly',
      compositionPrincipal: 'hardware feature closeup',
      durationMs: [1200, 2500]
    },
    sourceInstance: {
      productInSource: 'MacBook',
      specificAction: 'ports reveal, camera lens flies into laptop, hardware module locks in'
    }
  };
  graph.shotSlots = [graph.shotSlots[0]];
  graph.segments = [{ id: 'seg_hook', role: 'hook', start: 0, end: 3, duration: 3, purpose: 'source hardware', transferRule: '', importance: 5 }];

  const timeline = await buildOrchestratedTimeline({
    projectId: 'p_source_specific',
    structureGraph: graph,
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient({
      slot_hardware_interface: { assetId: 'asset_open', quality: 0.93, matchedCriteria: ['clear product closeup'] }
    }),
    model: MODEL
  });

  const slot = timeline.slots[0];
  assert.equal(slot.fillStatus, 'source_specific_not_transferable');
  assert.equal(slot.fill.kind, 'matched');
  if (slot.fill.kind === 'matched') {
    assert.equal(slot.fill.status, 'partial');
    const text = JSON.stringify(slot.fill.options);
    assert.match(text, /瓶身标签|冷凝水|茶色流动|开盖|倒入杯中|多瓶陈列/);
    assert.doesNotMatch(text, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
  }
});

test('default Director Agent timing compresses source timeline into a high-conversion 20s target', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p_duration',
    structureGraph: makeKineticAssemblyGraph(),
    assetCards: makeAssets(),
    assetSupplyContext: makeWeakKineticSupply(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient({
      slot_block_004_asset_001: { assetId: 'plain_002_hand_pickup', quality: 0.94 }
    }),
    model: MODEL
  });

  assert.equal(timeline.meta.targetDurationMode, 'high_conversion_20s');
  assert.equal(timeline.meta.sourceDurationMs, 26000);
  assert.equal(timeline.meta.targetDurationMs, 20000);
  assert.equal(timeline.slots[0].sourceStartMs, 84000);
  assert.equal(timeline.slots[0].sourceEndMs, 110000);
  assert.equal(timeline.slots[0].targetStartMs, 0);
  assert.equal(timeline.slots[0].targetEndMs, 20000);
  assert.equal(timeline.slots[0].startMs, timeline.slots[0].targetStartMs);
  assert.equal(timeline.slots[0].endMs, timeline.slots[0].targetEndMs);
});

test('Director Agent emits a reusable asset-pack plan for Video Agent handoff', async () => {
  const timeline = await buildOrchestratedTimeline({
    projectId: 'p_packs',
    structureGraph: makeKineticAssemblyGraph(),
    assetCards: makeAssets(),
    assetSupplyContext: makeWeakKineticSupply(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient({
      slot_block_004_asset_001: { assetId: 'plain_002_hand_pickup', quality: 0.94 }
    }),
    model: MODEL
  });

  const reusableAssetPacks = timeline.reusableAssetPacks ?? [];
  assert.ok(reusableAssetPacks.length >= 8);
  assert.ok(reusableAssetPacks.length <= 12);
  const packTypes = reusableAssetPacks.map((pack) => pack.packType);
  assert.ok(packTypes.includes('product_hero_reveal'));
  assert.ok(packTypes.includes('cap_open_usage'));
  assert.ok(packTypes.includes('pour_or_drink_usage'));
  assert.ok(packTypes.includes('cold_condensation_macro'));
  assert.ok(packTypes.includes('motif_assembly_reveal'));
  assert.ok(packTypes.includes('cta_lockup'));
  assert.ok(reusableAssetPacks.every((pack) => /[\u4e00-\u9fff]/.test(pack.promptSummary)));
});
