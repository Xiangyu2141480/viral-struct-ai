import type {
  AigcGenerationBrief,
  AssetCard,
  AssetRole,
  CompletionChannelEligibility,
  ContentBrief,
  ContextualAssetCoverageReport,
  ContextualSlotCoverage,
  HyperframesFallbackBrief,
  ManualShootBrief,
  MaterialScenarioProfile,
  MissingIngredient,
  MissingMaterialBrief
} from '@viral-struct/shared';

export interface BuildMissingMaterialBriefsInput {
  contextualCoverage?: ContextualAssetCoverageReport;
  assetCards: AssetCard[];
  contentBrief?: ContentBrief;
  materialScenario: MaterialScenarioProfile;
}

const SAFE_NEGATIVE_PROMPT = [
  'no text overlays',
  'no watermark',
  'no celebrity',
  'no other brands',
  'no price promotion',
  'no medical claims',
  'do not alter the product packaging or label',
  'avoid copying the source video composition exactly'
].join(', ');

export function buildMissingMaterialBriefs(input: BuildMissingMaterialBriefsInput): MissingMaterialBrief[] {
  const coverages = input.contextualCoverage?.slotCoverages ?? [];
  return coverages
    .filter((coverage) => coverage.coverageStatus !== 'covered')
    .map((coverage, index) => buildBrief(coverage, input, index));
}

function buildBrief(
  coverage: ContextualSlotCoverage,
  input: BuildMissingMaterialBriefsInput,
  index: number
): MissingMaterialBrief {
  const slotRole = coverage.slotRole;
  const normalizedRole = normalizeRole(slotRole);
  const referenceAssetIds = selectReferenceAssetIds(input.assetCards, coverage);
  const missingIngredients = mergeMissingIngredients(coverage);

  return {
    id: `missing_material_brief_${String(index + 1).padStart(3, '0')}_${safeId(coverage.slotId)}`,
    affectedSegmentId: coverage.affectedSegmentId,
    affectedSlotId: coverage.slotId,
    slotRole,
    slotIntent: coverage.slotIntent,
    missingIngredients,
    potentialImpact: coverage.coverageStatus === 'weak'
      ? coverage.limitations.map((limitation) => ({
          type: impactTypeForRole(slotRole),
          description: limitation,
          severity: 'medium' as const
        })).slice(0, 2)
      : findImpacts(input.contextualCoverage, coverage.slotId),
    manualShootBrief: buildManualShootBrief(normalizedRole, input.contentBrief, coverage),
    aigcGenerationBrief: buildAigcBrief(normalizedRole, input.contentBrief, coverage, referenceAssetIds, input.materialScenario),
    hyperframesBrief: buildHyperframesBrief(normalizedRole, input.contentBrief, coverage, referenceAssetIds),
    channelEligibility: buildChannelEligibility(normalizedRole, coverage, input.assetCards, input.materialScenario, referenceAssetIds),
    ownership: 'asset_manager_handoff_brief_only'
  };
}

function buildManualShootBrief(role: NormalizedBriefRole, brief: ContentBrief | undefined, coverage: ContextualSlotCoverage): ManualShootBrief {
  const productName = brief?.productName ?? 'new product';
  const baseProps = [productName, 'phone camera', 'clean vertical background'];
  const roleSpec = roleCopy(role, productName, brief);
  return {
    title: roleSpec.manualTitle,
    objective: roleSpec.objective,
    shotDescription: roleSpec.manualShotDescription,
    durationSec: roleSpec.durationSec,
    framing: roleSpec.framing,
    requiredProps: Array.from(new Set([...baseProps, ...roleSpec.requiredProps])),
    mustCapture: roleSpec.mustCapture,
    avoid: [
      'other visible brands',
      'celebrity or public-person likeness',
      'unverified price or promotion claims',
      'medical or guaranteed-effect claims',
      ...coverage.limitations.slice(0, 2).map((item) => `do not leave unresolved: ${item}`)
    ]
  };
}

function buildAigcBrief(
  role: NormalizedBriefRole,
  brief: ContentBrief | undefined,
  coverage: ContextualSlotCoverage,
  referenceAssetIds: string[],
  scenario: MaterialScenarioProfile
): AigcGenerationBrief {
  const productName = brief?.productName ?? 'the product';
  const roleSpec = roleCopy(role, productName, brief);
  const providerHint: AigcGenerationBrief['providerHint'] = role === 'usage_demo' || role === 'opening_hook'
    ? 'seedance'
    : scenario.scenarioType === 'aigc_ready'
      ? 'gemini'
      : 'generic';
  const prompt = [
    `Prompt brief only, not rendered output.`,
    `Create a 9:16 ordinary smartphone-style short-video shot for ${productName}.`,
    roleSpec.aigcPrompt,
    `Source structure intent: ${coverage.slotIntent}.`,
    brief?.sellingPoints.length ? `Respect these verified selling points only: ${brief.sellingPoints.join(', ')}.` : undefined,
    `Do not invent price, promotion, medical benefit, celebrity endorsement, or extra brands.`
  ].filter(Boolean).join(' ');

  return {
    providerHint,
    prompt,
    negativePrompt: SAFE_NEGATIVE_PROMPT,
    referenceAssetIds,
    expectedDurationSec: roleSpec.durationSec,
    aspectRatio: '9:16',
    safetyNotes: [
      'This is an Asset Manager prompt brief for a downstream adapter, not rendered media.',
      'Keep product claims limited to the supplied content brief.',
      'No external generation call is made by Asset Manager.'
    ]
  };
}

function buildHyperframesBrief(
  role: NormalizedBriefRole,
  brief: ContentBrief | undefined,
  coverage: ContextualSlotCoverage,
  referenceAssetIds: string[]
): HyperframesFallbackBrief {
  const productName = brief?.productName ?? 'new product';
  const roleSpec = roleCopy(role, productName, brief);
  return {
    title: roleSpec.hyperframesTitle,
    cardType: roleSpec.cardType,
    copyIntent: roleSpec.copyIntent,
    visualElements: [
      productName,
      ...referenceAssetIds.map((id) => `reference asset ${id}`),
      ...coverage.requiredIngredients.slice(0, 3).map((ingredient) => ingredient.label)
    ],
    animationHints: roleSpec.animationHints,
    durationSec: Math.min(4, Math.max(1.5, roleSpec.durationSec)),
    inputAssets: referenceAssetIds
  };
}

function buildChannelEligibility(
  role: NormalizedBriefRole,
  coverage: ContextualSlotCoverage,
  assetCards: AssetCard[],
  scenario: MaterialScenarioProfile,
  referenceAssetIds: string[]
): CompletionChannelEligibility[] {
  const hasProductReference = assetCards.some((asset) => referenceAssetIds.includes(asset.id));
  const hasCandidate = coverage.candidateAssets.length > 0;
  const canGenerate = scenario.scenarioType === 'aigc_ready' || scenario.scenarioType === 'mixed_real_and_aigc' || hasProductReference;
  const canReuse = hasCandidate && coverage.candidateAssets[0]?.score >= 45;
  const canCopy = Boolean(referenceAssetIds.length || role === 'cta' || role === 'opening_hook');

  return [
    eligibility('manual_shoot', true, 'high', 'Human reshoot can directly fill the missing structural ingredient.', ['product', 'phone camera', 'vertical framing'], hasProductReference ? ['product reference'] : [], ['fresh shot'], 'human_shooting'),
    eligibility('aigc_video_prompt', canGenerate, canGenerate ? 'medium' : 'low', canGenerate ? 'A prompt brief can be handed to an external video generation adapter.' : 'No product reference or generation permission is available.', ['prompt brief', 'product reference'], referenceAssetIds, canGenerate ? [] : ['reference asset or generation permission'], 'external_generation_adapter'),
    eligibility('aigc_image_prompt', canGenerate, canGenerate ? 'medium' : 'low', 'A still frame prompt can support downstream storyboard or image-to-video preparation.', ['prompt brief', 'safe product reference'], referenceAssetIds, canGenerate ? [] : ['safe product reference'], 'external_generation_adapter'),
    eligibility('hyperframes_card_animation', canCopy, canCopy ? 'high' : 'low', 'Renderer can animate cards from copy and existing product reference without claiming real footage.', ['copy intent', 'visual elements'], referenceAssetIds, canCopy ? [] : ['copy or product reference'], 'hyperframes_renderer'),
    eligibility('reuse_crop_zoom', canReuse, canReuse ? 'medium' : 'low', canReuse ? 'Candidate asset can be reused as partial evidence with crop/zoom or trim.' : 'Candidate is too weak for reuse.', ['candidate asset'], coverage.candidateAssets.map((candidate) => candidate.assetId), canReuse ? [] : ['usable candidate asset'], 'video_agent'),
    eligibility('copy_packaging_card', Boolean(coverage.slotIntent), 'high', 'Copy/card treatment can preserve the structure while downstream repair decides final strategy.', ['slot intent', 'content brief'], coverage.slotIntent ? ['slot intent'] : [], [], 'gap_repair_planner'),
    eligibility('video_agent_fallback_rendering', true, 'medium', 'Video Agent may consume this brief as input, but Asset Manager does not render fallback cards.', ['missing-material brief'], [`brief for ${coverage.slotId}`], [], 'video_agent')
  ];
}

function eligibility(
  channel: CompletionChannelEligibility['channel'],
  eligible: boolean,
  confidence: CompletionChannelEligibility['confidence'],
  reason: string,
  requiredInputs: string[],
  providedInputs: string[],
  missingInputs: string[],
  ownership: CompletionChannelEligibility['ownership']
): CompletionChannelEligibility {
  return {
    channel,
    eligible,
    confidence,
    reason,
    requiredInputs,
    providedInputs,
    missingInputs,
    ownership
  };
}

type NormalizedBriefRole = 'opening_hook' | 'product_closeup' | 'usage_demo' | 'comparison' | 'benefit_proof' | 'cta' | 'cover' | 'generic';

function normalizeRole(role: AssetRole): NormalizedBriefRole {
  if (role === 'opening_hook' || role === 'opening_attention') return 'opening_hook';
  if (role === 'product_closeup') return 'product_closeup';
  if (role === 'usage_demo') return 'usage_demo';
  if (role === 'comparison') return 'comparison';
  if (role === 'benefit_proof' || role === 'benefit_visual') return 'benefit_proof';
  if (role === 'cta' || role === 'cta_visual') return 'cta';
  if (role === 'cover') return 'cover';
  return 'generic';
}

function roleCopy(role: NormalizedBriefRole, productName: string, brief: ContentBrief | undefined): {
  manualTitle: string;
  objective: string;
  manualShotDescription: string;
  durationSec: number;
  framing: string;
  requiredProps: string[];
  mustCapture: string[];
  aigcPrompt: string;
  hyperframesTitle: string;
  cardType: HyperframesFallbackBrief['cardType'];
  copyIntent: string;
  animationHints: string[];
} {
  const sellingPoint = brief?.sellingPoints[0] ?? 'verified selling point';
  const cta = brief?.cta ?? 'clear next action';
  const table = {
    opening_hook: {
      manualTitle: '补拍开场吸引镜头',
      objective: '补足前 3 秒的注意力抓取素材。',
      manualShotDescription: `Shoot 3-5 seconds of ${productName} being picked up from a fridge, ice bucket, or table with clear summer energy.`,
      durationSec: 3,
      framing: 'vertical medium close shot, product centered, enough top/bottom safe area',
      requiredProps: ['ice or summer background'],
      mustCapture: ['product enters frame quickly', 'clear label or silhouette', 'energetic movement'],
      aigcPrompt: `Show a high-energy opening action with ${productName}, ice or summer refreshment cues, product clearly visible.`,
      hyperframesTitle: 'Hook card input',
      cardType: 'hook_card' as const,
      copyIntent: `Use product image plus bold hook copy around ${sellingPoint}.`,
      animationHints: ['quick push-in', 'ice shimmer', 'large title reveal']
    },
    product_closeup: {
      manualTitle: '补拍商品特写',
      objective: '补足瓶身、标签和包装辨识。',
      manualShotDescription: `Shoot a closeup of ${productName}, including label detail, droplets, and clean background.`,
      durationSec: 2.5,
      framing: 'vertical closeup, label readable, product fills 60-80% of frame',
      requiredProps: ['clean background', 'optional water droplets'],
      mustCapture: ['clear bottle label', 'product shape', 'stable focus'],
      aigcPrompt: `Create a clean vertical product closeup reference for ${productName}; keep packaging unchanged and readable.`,
      hyperframesTitle: 'Product focus card input',
      cardType: 'timeline_bridge_card' as const,
      copyIntent: `Make ${productName} visually recognizable before the selling point.`,
      animationHints: ['slow push-in', 'label highlight', 'light sweep']
    },
    usage_demo: {
      manualTitle: '补拍使用过程',
      objective: '补足真实使用动作，避免只靠静态产品图。',
      manualShotDescription: `Shoot opening the cap, drinking one sip, or pouring ${productName} into a cup, preferably neck-down or hand-only.`,
      durationSec: 4,
      framing: 'vertical hand/neck-down shot, product and action visible',
      requiredProps: ['cup or bottle', 'hand-only or no-face setup'],
      mustCapture: ['open cap', 'drink one sip', 'pour into cup or clear use action'],
      aigcPrompt: `Create ordinary user-style usage footage for ${productName}: hand-only or neck-down, opening cap, drinking, or pouring. Keep it realistic and casual.`,
      hyperframesTitle: 'Usage placeholder input',
      cardType: 'usage_placeholder_card' as const,
      copyIntent: 'Use a step card to explain the missing usage action without pretending it is real footage.',
      animationHints: ['step 1/2/3 card', 'small product image', 'simple arrow motion']
    },
    comparison: {
      manualTitle: '补拍对比/陈列素材',
      objective: '补足对比关系或多瓶陈列证据。',
      manualShotDescription: `Shoot a lineup, before-after setup, or cold-vs-normal visual for ${productName} without claiming unverified superiority.`,
      durationSec: 3,
      framing: 'vertical wide or medium shot with clear left/right relationship',
      requiredProps: ['table surface', 'optional ice or cup'],
      mustCapture: ['two-state or lineup relationship', 'clear product visibility'],
      aigcPrompt: `Create a vertical comparison or lineup shot for ${productName}, showing a simple cold refreshment contrast without unverified claims.`,
      hyperframesTitle: 'Comparison card input',
      cardType: 'comparison_card' as const,
      copyIntent: `Explain contrast around ${sellingPoint} using verified brief only.`,
      animationHints: ['split screen', 'before/after labels', 'soft slide transition']
    },
    benefit_proof: {
      manualTitle: '补拍卖点证明素材',
      objective: '补足卖点相关画面证据。',
      manualShotDescription: `Shoot ${productName} with visual cues that support ${sellingPoint}, such as ice, lemon tea context, or sharing scene.`,
      durationSec: 3,
      framing: 'vertical medium product scene with enough text-safe area',
      requiredProps: ['ice, cup, lemon, or sharing table if available'],
      mustCapture: ['product visible', 'benefit cue visible', 'stable readable scene'],
      aigcPrompt: `Create a vertical benefit-proof scene for ${productName}, visually supporting ${sellingPoint} without making new claims.`,
      hyperframesTitle: 'Benefit card input',
      cardType: 'benefit_card' as const,
      copyIntent: `Turn ${sellingPoint} into a concise benefit card.`,
      animationHints: ['benefit badge', 'small product cutout', 'light motion']
    },
    cta: {
      manualTitle: '补拍干净尾帧/CTA 底图',
      objective: '补足结尾行动引导的视觉承载。',
      manualShotDescription: `Shoot a clean ending frame with ${productName}, leaving safe space for CTA text.`,
      durationSec: 2,
      framing: 'vertical product shot with clean negative space',
      requiredProps: ['clean background', 'stable product placement'],
      mustCapture: ['product visible', 'clear empty area for copy', 'steady ending'],
      aigcPrompt: `Create a clean vertical CTA background for ${productName}; product visible, safe empty area, no text added.`,
      hyperframesTitle: 'CTA card input',
      cardType: 'cta_card' as const,
      copyIntent: cta,
      animationHints: ['CTA reveal', 'product hold', 'subtle bounce']
    },
    cover: {
      manualTitle: '补拍封面素材',
      objective: '补足封面级商品视觉。',
      manualShotDescription: `Shoot ${productName} as a clean cover frame with strong product recognition.`,
      durationSec: 2,
      framing: 'vertical cover frame, product centered with title safe area',
      requiredProps: ['clean background'],
      mustCapture: ['product visible', 'space for title', 'high clarity'],
      aigcPrompt: `Create a clean cover-frame visual for ${productName}, product centered, no text, no watermark.`,
      hyperframesTitle: 'Cover bridge card input',
      cardType: 'timeline_bridge_card' as const,
      copyIntent: `Prepare a cover/title frame around ${productName}.`,
      animationHints: ['title safe area', 'product reveal', 'gentle zoom']
    },
    generic: {
      manualTitle: '补拍结构槽位素材',
      objective: '补足当前结构槽位需要的视觉证据。',
      manualShotDescription: `Shoot a vertical clip for ${productName} that satisfies the source structure intent.`,
      durationSec: 3,
      framing: 'vertical shot with product and action visible',
      requiredProps: ['product'],
      mustCapture: ['product visible', 'slot action visible'],
      aigcPrompt: `Create a vertical support shot for ${productName} matching the source structure intent.`,
      hyperframesTitle: 'Timeline bridge card input',
      cardType: 'timeline_bridge_card' as const,
      copyIntent: 'Bridge the missing visual evidence with a clear card input.',
      animationHints: ['simple reveal', 'short copy', 'product reference']
    }
  };
  return table[role];
}

function selectReferenceAssetIds(assetCards: AssetCard[], coverage: ContextualSlotCoverage): string[] {
  const candidateIds = coverage.candidateAssets.map((candidate) => candidate.assetId);
  const productIds = assetCards
    .filter((asset) => hasProductEvidence(asset))
    .map((asset) => asset.id);
  return Array.from(new Set([...candidateIds, ...productIds])).slice(0, 3);
}

function hasProductEvidence(asset: AssetCard): boolean {
  const text = [
    asset.spatialDescription,
    asset.temporalDescription,
    asset.analysis?.semantic.summary,
    ...asset.detectedObjects,
    ...(asset.detectedIngredients ?? [])
  ].filter(Boolean).join(' ').toLowerCase();
  return /(product|bottle|label|packaging|商品|瓶身|包装|标签|康师傅|冰红茶)/i.test(text);
}

function mergeMissingIngredients(coverage: ContextualSlotCoverage): MissingIngredient[] {
  const merged = [...coverage.missingIngredients, ...coverage.weakIngredients];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.requiredIngredientId}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findImpacts(contextualCoverage: ContextualAssetCoverageReport | undefined, slotId: string) {
  return contextualCoverage?.observations.find((observation) => observation.affectedSlotId === slotId)?.potentialImpact ?? [];
}

function impactTypeForRole(role: AssetRole) {
  if (role === 'opening_hook' || role === 'opening_attention') return 'hook_strength_reduced' as const;
  if (role === 'product_closeup') return 'product_clarity_reduced' as const;
  if (role === 'usage_demo') return 'usage_proof_missing' as const;
  if (role === 'comparison') return 'comparison_weakened' as const;
  if (role === 'cta' || role === 'cta_visual') return 'cta_clarity_reduced' as const;
  return 'packaging_overload_risk' as const;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_\-\u4e00-\u9fff]+/gu, '_').replace(/^_+|_+$/g, '') || 'slot';
}
