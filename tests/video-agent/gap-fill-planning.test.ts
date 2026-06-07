import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief, MaterialGap, SlotMatch, TimelineItem, ViralStructureGraph } from '@viral-struct/shared';
import type { VideoEditContext } from '../../packages/video-agent/src/context/VideoEditContext';
import { buildGapReports, planGapFills } from '../../packages/video-agent/src/gap-fill/gapFillPlanner';
import { AssetGenerationRequestSchema, GapFillPlanSchema, GapReportSchema } from '../../packages/video-agent/src/gap-fill/gapFillSchemas';
import { verifyGapFillBatch } from '../../packages/video-agent/src/gap-fill/gapFillVerifier';

function makeGraph(): ViralStructureGraph {
  return {
    meta: { duration: 12, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
    structureSummary: 'test graph',
    segments: [
      {
        id: 'seg_hook',
        role: 'hook',
        start: 0,
        end: 3,
        duration: 3,
        purpose: 'open attention',
        transferRule: 'preserve opening proof function',
        importance: 5
      },
      {
        id: 'seg_comparison',
        role: 'comparison',
        start: 3,
        end: 7,
        duration: 4,
        purpose: 'compare alternatives',
        transferRule: 'preserve comparison structure',
        importance: 4
      },
      {
        id: 'seg_style',
        role: 'selling_point',
        start: 7,
        end: 12,
        duration: 5,
        purpose: 'style bridge',
        transferRule: 'preserve visual atmosphere',
        importance: 3
      }
    ],
    shotSlots: [
      {
        id: 'slot_human',
        segmentId: 'seg_hook',
        role: 'opening_attention',
        requiredAsset: { type: 'video', subject: 'real person demo', motion: 'hand_operation', minDuration: 2 },
        visualIngredientRequirements: ['human_presence', 'trust_building'],
        humanRequirement: { required: true, role: 'host', action: 'talking' },
        fallbackStrategies: ['ask_user_for_human_demo', 'trust_card'],
        intent: {
          purpose: 'Establish trust with real human proof.',
          energyLevel: 'high',
          motionPattern: 'human proof close to the product',
          compositionPrincipal: 'host and product must be visible',
          durationMs: [1800, 3000]
        },
        acceptanceCriteria: {
          anyOf: [
            {
              motionType: 'human_demo',
              examples: ['authorized host showing product']
            }
          ],
          rejectIf: ['synthetic human replacement']
        }
      },
      {
        id: 'slot_compare',
        segmentId: 'seg_comparison',
        role: 'comparison',
        requiredAsset: { type: 'image', subject: 'before after comparison', motion: 'static', minDuration: 2 },
        fallbackStrategies: ['comparison_card', 'caption_rewrite']
      },
      {
        id: 'slot_style',
        segmentId: 'seg_style',
        role: 'benefit_visual',
        requiredAsset: { type: 'generated', subject: 'clean background', motion: 'push_in', minDuration: 2 },
        visualIngredientRequirements: ['clean_background', 'soft_light'],
        fallbackStrategies: ['aigc_background', 'style_filter_suggestion']
      }
    ],
    rhythm: { avgShotDuration: 3, cutFrequency: 'medium', pattern: 'hook-comparison-style' },
    packaging: {
      captionDensity: 'medium',
      captionPosition: 'bottom_center',
      titleStyle: 'bold',
      cardTypes: ['comparison_card'],
      transitions: ['quick_cut'],
      coverStyle: 'clean'
    },
    creativeIngredients: [],
    edges: []
  };
}

const brief: ContentBrief = {
  productName: 'Ice Tea',
  targetAudience: 'summer commuters',
  scenario: 'hot afternoon',
  sellingPoints: ['cold taste', 'lemon tea flavor'],
  cta: 'Try one today'
};

const assets: AssetCard[] = [
  {
    id: 'asset_packshot',
    type: 'image',
    detectedObjects: ['bottle'],
    suitableSlots: ['product_closeup', 'comparison'],
    qualityScore: 0.8,
    visualContent: {
      primarySubject: 'bottle packshot',
      subjectPosition: 'center',
      kinematicElements: ['static product']
    }
  }
];

const matches: SlotMatch[] = [
  {
    slotId: 'slot_human',
    score: 0.2,
    status: 'missing',
    reason: 'No authorized human proof footage.',
    missingIngredients: ['human_presence', 'trust_building']
  },
  {
    slotId: 'slot_compare',
    assetId: 'asset_packshot',
    score: 0.55,
    status: 'partial',
    reason: 'Packshot exists but no before/after footage.',
    missingIngredients: ['before_after_comparison']
  },
  {
    slotId: 'slot_style',
    score: 0.1,
    status: 'missing',
    reason: 'No clean atmosphere background.',
    missingIngredients: ['clean_background', 'soft_light']
  }
];

const gaps: MaterialGap[] = [
  {
    slotId: 'slot_human',
    role: 'opening_attention',
    type: 'missing_human_host',
    severity: 'high',
    reason: 'Missing authorized human proof.',
    impact: 'Trust opening loses proof.',
    affectedSegmentId: 'seg_hook',
    missingIngredients: ['human_presence', 'trust_building']
  },
  {
    slotId: 'slot_compare',
    role: 'comparison',
    type: 'missing_comparison',
    severity: 'medium',
    reason: 'Missing comparison layout.',
    impact: 'Comparison structure needs a substitute.',
    affectedSegmentId: 'seg_comparison',
    missingIngredients: []
  },
  {
    slotId: 'slot_style',
    role: 'benefit_visual',
    type: 'missing_scene_style',
    severity: 'low',
    reason: 'Missing clean visual atmosphere.',
    impact: 'Style bridge lacks background.',
    affectedSegmentId: 'seg_style',
    missingIngredients: ['clean_background', 'soft_light']
  }
];

function makeTimeline(): TimelineItem[] {
  return [
    {
      id: 'item_human',
      start: 0,
      end: 2,
      segmentRole: 'hook',
      sourceSegmentId: 'seg_hook',
      slotId: 'slot_human',
      script: 'Ice Tea',
      subtitles: ['Ice Tea'],
      visualAction: 'Request real proof footage.',
      packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut' }
    },
    {
      id: 'item_compare',
      start: 2,
      end: 4,
      segmentRole: 'comparison',
      sourceSegmentId: 'seg_comparison',
      slotId: 'slot_compare',
      assetId: 'asset_packshot',
      script: 'Compare the difference',
      subtitles: ['cold taste', 'lemon tea flavor'],
      visualAction: 'Use deterministic comparison card with packshot crop.',
      packaging: { captionStyle: 'bold', cardType: 'comparison_card', transition: 'zoom_in', motion: 'crop_zoom' }
    },
    {
      id: 'item_style',
      start: 4,
      end: 6,
      segmentRole: 'selling_point',
      sourceSegmentId: 'seg_style',
      slotId: 'slot_style',
      script: 'cold taste',
      subtitles: ['cold taste'],
      visualAction: 'Use safe clean background fill.',
      packaging: { captionStyle: 'bold', cardType: 'selling_point_card', transition: 'push', motion: 'push_in' }
    }
  ];
}

function makeContext(overrides: {
  constraints?: Partial<VideoEditContext['constraints']>;
  materialGaps?: MaterialGap[];
  slotMatches?: SlotMatch[];
  timeline?: TimelineItem[];
  userUnprovidableSlotIds?: string[];
} = {}): VideoEditContext {
  return {
    projectId: 'project_1',
    structureGraph: makeGraph(),
    contentBrief: brief,
    assetCards: assets,
    slotMatches: overrides.slotMatches ?? matches,
    materialGaps: overrides.materialGaps ?? gaps,
    timeline: overrides.timeline,
    userUnprovidableSlotIds: overrides.userUnprovidableSlotIds,
    constraints: {
      aspectRatio: '9:16',
      allowAigc: true,
      allowHumanGeneration: false,
      allowedClaimSources: ['content_brief'],
      forbiddenClaims: ['best in market'],
      ...overrides.constraints
    }
  };
}

test('buildGapReports elevates real proof into a deterministic routing gate', () => {
  const reports = buildGapReports(makeContext());
  const human = reports.find((report) => report.slotId === 'slot_human');

  assert.doesNotThrow(() => GapReportSchema.parse(human));
  assert.equal(human?.evidenceType, 'usage_demo');
  assert.equal(human?.requiresRealProof, true);
  assert.equal(human?.emotionalFunction, 'trust');
});

test('planGapFills uses exactly the three canonical fill methods', () => {
  const plans = planGapFills(makeContext());
  const methods = plans.map((plan) => plan.method);

  for (const plan of plans) assert.doesNotThrow(() => GapFillPlanSchema.parse(plan));
  assert.deepEqual(methods, ['ask_user_for_asset', 'deterministic_editing_fill', 'aigc_fill']);
});

test('planGapFills validates malformed inherited inputs at the schema boundary', () => {
  const [badGap] = gaps;

  assert.throws(() => planGapFills(makeContext({
    materialGaps: [
      {
        ...badGap,
        role: 'not_a_slot_role' as MaterialGap['role']
      }
    ],
    slotMatches: [matches[0]]
  })));
});

test('planGapFills forbids AIGC as the first answer when real proof is required', () => {
  const [humanPlan] = planGapFills(makeContext({
    constraints: { allowAigc: true, allowHumanGeneration: true }
  }));

  assert.equal(humanPlan.method, 'ask_user_for_asset');
  assert.equal(humanPlan.safetyGate.requiresRealProof, true);
  assert.equal(humanPlan.safetyGate.aigcAllowed, false);
  assert.ok(humanPlan.userAssetRequest?.whyRequired.includes('real'));
});

test('deterministic fills prefer reusing matched real assets before card-only repair', () => {
  const plans = planGapFills(makeContext());
  const comparisonPlan = plans.find((plan) => plan.slotId === 'slot_compare');

  assert.equal(comparisonPlan?.method, 'deterministic_editing_fill');
  assert.equal(comparisonPlan?.reuseSpec?.assetId, 'asset_packshot');
  assert.equal(comparisonPlan?.reuseSpec?.treatment, 'still_to_motion');
  assert.ok(comparisonPlan?.editingSpec?.referencedAssets.includes('asset_packshot'));
});

test('AIGC requests never carry factual claim allow-lists', () => {
  const plans = planGapFills(makeContext());
  const aigcPlan = plans.find((plan) => plan.method === 'aigc_fill');

  if (!aigcPlan?.aigcRequest) assert.fail('Expected an AIGC fill request.');
  const request = aigcPlan.aigcRequest;

  assert.doesNotThrow(() => AssetGenerationRequestSchema.parse(request));
  assert.equal('factualClaimsAllowed' in request, false);
  assert.ok(request.forbiddenElements.includes('on-screen claims'));
});

test('AssetGenerationRequestSchema rejects factual claim allow-lists', () => {
  const plans = planGapFills(makeContext());
  const aigcPlan = plans.find((plan) => plan.method === 'aigc_fill');
  if (!aigcPlan?.aigcRequest) assert.fail('Expected an AIGC fill request.');

  assert.throws(() => AssetGenerationRequestSchema.parse({
    ...aigcPlan.aigcRequest,
    factualClaimsAllowed: ['best taste']
  }));
});

test('verifier marks global checks pending (not a false fail) before a timeline exists', () => {
  const plans = planGapFills(makeContext());
  const result = verifyGapFillBatch(makeContext(), plans);

  // No timeline yet: structure fidelity is not measurable -> honest 'pending', never a fake pass nor a false fail.
  assert.ok(result.globalChecks.some((check) => check.type === 'structure_fidelity' && check.status === 'pending'));
  assert.ok(result.pendingCount > 0);
  assert.equal(result.issues.some((issue) => issue.checkId === 'structure_fidelity'), false);
});

test('verifier confirms global checks once timeline evidence exists', () => {
  const context = makeContext({ timeline: makeTimeline() });
  const plans = planGapFills(context);
  const result = verifyGapFillBatch(context, plans);

  assert.equal(result.ok, true);
  assert.ok(result.localChecks.some((check) => check.type === 'no_unapproved_human_generation'));
  assert.ok(result.globalChecks.some((check) => check.type === 'structure_fidelity' && check.status === 'pass'));
  assert.ok(result.globalChecks.some((check) => check.type === 'emotional_function' && check.status === 'pass'));
});

test('render-dependent local checks stay pending (never a fake pass) before render', () => {
  const context = makeContext({ timeline: makeTimeline() });
  const plans = planGapFills(context);
  const result = verifyGapFillBatch(context, plans);

  const renderDependent = ['claim_supported', 'product_identity', 'safe_area', 'style_match'];
  const present = result.localChecks.filter((check) => renderDependent.includes(check.type));
  assert.ok(present.length > 0);
  assert.ok(present.every((check) => check.status === 'pending'));
});

test('degrades a real-proof gap to an honest unresolved substitute when the user cannot provide and AIGC is off', () => {
  const plans = planGapFills(makeContext({
    constraints: { allowAigc: false },
    userUnprovidableSlotIds: ['slot_human']
  }));
  const human = plans.find((plan) => plan.slotId === 'slot_human');

  assert.equal(human?.method, 'deterministic_editing_fill');
  assert.equal(human?.resolutionStatus, 'unresolved');
  assert.equal(human?.qualityImpact?.severity, 'lost');
  assert.equal(human?.qualityImpact?.originalEvidenceType, 'usage_demo');
  assert.ok(human?.editingSpec, 'an honest communication substitute is produced');
  // The substitute copy must affirmatively say so, and must not imply the original footage exists.
  const subline = human?.editingSpec?.copy.subline ?? '';
  assert.match(subline, /unavailable/i);
  assert.match(subline, /not recreated/i);
  assert.match(subline, /attributed/i);
  assert.doesNotMatch(subline, /real (customer|demo|footage|proof)/i);
  assert.doesNotThrow(() => GapFillPlanSchema.parse(human));
});

test('a missing_usage_demo gap is real proof even without an explicit humanRequirement flag', () => {
  const usageGap: MaterialGap = {
    slotId: 'slot_compare',
    role: 'comparison',
    type: 'missing_usage_demo',
    severity: 'high',
    reason: 'No real usage footage.',
    impact: 'Usage proof missing.',
    affectedSegmentId: 'seg_comparison',
    missingIngredients: []
  };
  const reports = buildGapReports(makeContext({ materialGaps: [usageGap], slotMatches: [matches[1]] }));
  const report = reports.find((r) => r.slotId === 'slot_compare');
  assert.equal(report?.requiresRealProof, true);
  assert.equal(report?.evidenceType, 'usage_demo');

  const plans = planGapFills(makeContext({
    materialGaps: [usageGap],
    slotMatches: [matches[1]],
    constraints: { allowAigc: false },
    userUnprovidableSlotIds: ['slot_compare']
  }));
  assert.equal(plans[0]?.method, 'deterministic_editing_fill');
  assert.equal(plans[0]?.resolutionStatus, 'unresolved');
  assert.ok(plans[0]?.qualityImpact);
});

test('a real-proof gap the user cannot provide degrades honestly even when AIGC is enabled', () => {
  const plans = planGapFills(makeContext({
    constraints: { allowAigc: true },
    userUnprovidableSlotIds: ['slot_human']
  }));
  const human = plans.find((plan) => plan.slotId === 'slot_human');
  assert.equal(human?.method, 'deterministic_editing_fill');
  assert.equal(human?.resolutionStatus, 'unresolved');
  assert.ok(human?.qualityImpact, 'AIGC being enabled must not block the honest degrade for real proof');
});

test('verifier independently flags a plan that under-declares its real-proof need', () => {
  const context = makeContext();
  const plans = planGapFills(context);
  // Tamper: pretend the human-host slot does not need real proof and silently fill it.
  const tampered = plans.map((plan) =>
    plan.slotId === 'slot_human'
      ? {
          ...plan,
          method: 'deterministic_editing_fill' as const,
          safetyGate: { ...plan.safetyGate, requiresRealProof: false },
          resolutionStatus: 'planned' as const,
          qualityImpact: undefined
        }
      : plan
  );
  const result = verifyGapFillBatch(context, tampered);
  assert.ok(result.issues.some((issue) => issue.checkId === 'no_unapproved_human_generation'));
});

test('every gap yields exactly one plan with a typed resolution (completeness)', () => {
  const context = makeContext({ constraints: { allowAigc: false }, userUnprovidableSlotIds: ['slot_human'] });
  const plans = planGapFills(context);
  assert.equal(plans.length, context.materialGaps.length);
  assert.deepEqual(
    new Set(plans.map((plan) => plan.slotId)),
    new Set(context.materialGaps.map((gap) => gap.slotId))
  );
  assert.ok(plans.every((plan) => plan.resolutionStatus === 'planned' || plan.resolutionStatus === 'unresolved'));
  assert.ok(plans.some((plan) => plan.resolutionStatus === 'unresolved'));
});

test('verifier accepts an honest degraded substitute but rejects a silent overclaim', () => {
  const context = makeContext({ constraints: { allowAigc: false }, userUnprovidableSlotIds: ['slot_human'] });
  const plans = planGapFills(context);
  const okResult = verifyGapFillBatch(context, plans);
  assert.equal(okResult.issues.some((issue) => issue.checkId === 'no_unapproved_human_generation'), false);

  // Tamper: pretend the same real-proof gap was fully resolved with no quality impact -> must be flagged.
  const dishonest = plans.map((plan) =>
    plan.slotId === 'slot_human'
      ? { ...plan, resolutionStatus: 'planned' as const, qualityImpact: undefined }
      : plan
  );
  const badResult = verifyGapFillBatch(context, dishonest);
  assert.ok(badResult.issues.some((issue) => issue.checkId === 'no_unapproved_human_generation'));
});
