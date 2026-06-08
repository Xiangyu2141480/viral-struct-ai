import type {
  AssetSupplyContext,
  ContentBrief,
  MotifContext,
  MotionToken,
  SegmentRole,
  TargetCategory,
  TimelineItem,
  TransitionFunction,
  TransitionGrammar,
  TransitionImplementationMode,
  TransitionIngredient,
  TransitionMissingAssetFallback,
  TransitionRecipe,
  TransitionShotDescriptor
} from '@viral-struct/shared';
import type { CategoryObjectMapping, CategoryPreset, CategoryTransitionRecipeTemplate } from '../presets/genericPreset';
import { selectTransitionPreset } from './transitionPresetSelector';

export type TransitionVariant = 'high_click' | 'high_conversion' | 'premium';

export interface TransitionProductBriefInput extends Partial<ContentBrief> {
  [key: string]: unknown;
}

export interface GenerateTransitionRecipesInput {
  timeline: TimelineItem[];
  motifContext?: MotifContext;
  assetSupplyContext?: AssetSupplyContext;
  targetCategory?: string;
  productBrief?: TransitionProductBriefInput;
  variant?: TransitionVariant;
}

export function generateTransitionRecipes(input: GenerateTransitionRecipesInput): TransitionRecipe[] {
  const timeline = [...input.timeline].sort((a, b) => a.start - b.start);
  if (timeline.length < 2) {
    return [];
  }

  const selection = selectTransitionPreset({ targetCategory: input.targetCategory });
  const preset = selection.preset;
  const pairs = buildShotPairs(timeline);
  const motifDriven = isKineticMotif(input.motifContext);
  const templates = selectTemplates(preset, motifDriven);

  return templates.map((template, index) => {
    const pair = choosePairForTemplate(template, pairs, index);
    const mapping = preset.objectMappings[template.mappingKey] ?? firstMapping(preset);
    const hasAssets = pair.before.assetId !== undefined || pair.after.assetId !== undefined;
    const missingImportantAssets = !hasAssets || hasMissingCoverage(input.assetSupplyContext, pair);
    const implementationMode = chooseImplementationMode(template, missingImportantAssets);
    const requiredAssets = buildRequiredAssets(template, mapping, preset.targetCategory);
    const storyboardPrompt = buildStoryboardPrompt({
      template,
      mapping,
      productBrief: input.productBrief,
      variant: input.variant ?? 'high_click',
      targetCategory: preset.targetCategory,
      implementationMode
    });
    const videoPrompt = buildVideoPrompt({
      template,
      mapping,
      productBrief: input.productBrief,
      targetCategory: preset.targetCategory,
      implementationMode
    });

    return {
      id: `transition_${template.id}`,
      name: template.name,
      sourceMotifId: input.motifContext?.motifAnnotationId,
      sourceMotifType: input.motifContext?.motifType,
      targetCategory: preset.targetCategory,
      transitionFunction: template.transitionFunction,
      beforeShotId: pair.before.id,
      afterShotId: pair.after.id,
      beforeShot: describeShot(pair.before),
      transitionAction: template.transitionAction,
      afterShot: describeShot(pair.after),
      emotionShift: template.emotionShift,
      narrativeFunction: inferNarrativeFunction(pair.before.segmentRole, pair.after.segmentRole, template.narrativeFunction),
      motionGrammar: buildMotionGrammar(template, mapping, input.motifContext),
      requiredAssets,
      missingAssetFallback: buildMissingAssetFallback(template, mapping, implementationMode),
      implementationMode,
      storyboardPrompt,
      videoPrompt,
      ipRiskNotes: [
        'Plan-only transition recipe. Review brand, IP, claims and source-copying risk before rendering.',
        'Use target-category-native objects and avoid recreating the source product scene.'
      ],
      ownership: 'transition_plan_only_not_rendered'
    };
  });
}

function buildShotPairs(timeline: TimelineItem[]): Array<{ before: TimelineItem; after: TimelineItem }> {
  const pairs: Array<{ before: TimelineItem; after: TimelineItem }> = [];
  for (let index = 0; index < timeline.length - 1; index += 1) {
    pairs.push({ before: timeline[index], after: timeline[index + 1] });
  }
  return pairs;
}

function isKineticMotif(motifContext: MotifContext | undefined): boolean {
  return motifContext?.motifType === 'kinetic_assembly_reveal' || motifContext?.motifType === 'surreal_assembly';
}

function selectTemplates(preset: CategoryPreset, motifDriven: boolean): CategoryTransitionRecipeTemplate[] {
  const templates = preset.recipeTemplates.length > 0 ? preset.recipeTemplates : [];
  if (!motifDriven || preset.targetCategory === 'generic') {
    return templates;
  }

  const prioritizedFunctions = new Set<TransitionFunction>(['chaos_to_order', 'ingredient_to_product', 'product_to_cta']);
  const prioritized = templates.filter((template) => prioritizedFunctions.has(template.transitionFunction));
  const remainder = templates.filter((template) => !prioritizedFunctions.has(template.transitionFunction));
  return [...prioritized, ...remainder];
}

function choosePairForTemplate(
  template: CategoryTransitionRecipeTemplate,
  pairs: Array<{ before: TimelineItem; after: TimelineItem }>,
  fallbackIndex: number
): { before: TimelineItem; after: TimelineItem } {
  const targetPair = pairs.find((pair) => inferNarrativeFunction(pair.before.segmentRole, pair.after.segmentRole, template.narrativeFunction) === template.narrativeFunction);
  return targetPair ?? pairs[fallbackIndex % pairs.length];
}

function firstMapping(preset: CategoryPreset): CategoryObjectMapping {
  const [mapping] = Object.values(preset.objectMappings);
  return mapping;
}

function hasMissingCoverage(
  assetSupplyContext: AssetSupplyContext | undefined,
  pair: { before: TimelineItem; after: TimelineItem }
): boolean {
  const slotCoverages = assetSupplyContext?.contextualCoverage?.slotCoverages ?? [];
  if (slotCoverages.length === 0) {
    return false;
  }

  const pairSlotIds = new Set([pair.before.slotId, pair.after.slotId]);
  const relevant = slotCoverages.filter((coverage) => pairSlotIds.has(coverage.slotId));
  return relevant.some((coverage) => coverage.coverageStatus === 'weak' || coverage.coverageStatus === 'insufficient');
}

function chooseImplementationMode(
  template: CategoryTransitionRecipeTemplate,
  missingImportantAssets: boolean
): TransitionImplementationMode {
  return missingImportantAssets ? template.preferredImplementationModes.missingAssets : template.preferredImplementationModes.withAssets;
}

function buildRequiredAssets(
  template: CategoryTransitionRecipeTemplate,
  mapping: CategoryObjectMapping,
  targetCategory: TargetCategory
): TransitionIngredient[] {
  return mapping.targetObjects.slice(0, 4).map((targetObject, index) => ({
    id: `${template.id}_ingredient_${index + 1}`,
    targetCategory,
    ingredientRole: index === 0 ? 'motion_anchor' : 'object_bridge',
    label: targetObject,
    sourcePattern: mapping.sourcePattern,
    targetEquivalent: targetObject,
    requiredEvidence: [
      `Supports ${template.transitionFunction}.`,
      mapping.visualPromptHints[index % mapping.visualPromptHints.length] ?? 'Use a target-native object bridge.'
    ],
    acceptableAssetRoles: ['opening_hook', 'product_closeup', 'usage_demo', 'benefit_proof', 'cta', 'cover'],
    acceptableMediaTypes: ['image', 'video', 'generated'],
    notes: mapping.notes.join(' ')
  }));
}

function describeShot(item: TimelineItem): TransitionShotDescriptor {
  return {
    id: item.id,
    label: item.script.slice(0, 48),
    role: item.segmentRole,
    start: item.start,
    end: item.end,
    script: item.script,
    visualAction: item.visualAction
  };
}

function inferNarrativeFunction(
  beforeRole: SegmentRole,
  afterRole: SegmentRole,
  fallback: TransitionFunction
): TransitionFunction {
  if (beforeRole === 'pain_point' && (afterRole === 'selling_point' || afterRole === 'usage')) {
    return 'problem_to_solution';
  }
  if ((beforeRole === 'usage' || beforeRole === 'hook') && afterRole === 'selling_point') {
    return 'ingredient_to_product';
  }
  if (beforeRole === 'proof' && afterRole === 'cta') {
    return 'proof_to_cta';
  }
  if ((beforeRole === 'selling_point' || beforeRole === 'usage' || beforeRole === 'comparison') && afterRole === 'cta') {
    return 'product_to_cta';
  }
  if (beforeRole === 'usage' && afterRole === 'proof') {
    return 'usage_to_benefit';
  }
  return fallback;
}

function buildMotionGrammar(
  template: CategoryTransitionRecipeTemplate,
  mapping: CategoryObjectMapping,
  motifContext: MotifContext | undefined
): TransitionGrammar {
  const motionTokens = motifContext?.motionTokens.length ? motifContext.motionTokens : defaultMotionTokens(template.transitionFunction);
  return {
    id: `${template.id}_motion_grammar`,
    name: `${template.name} grammar`,
    motionTokens,
    objectContinuity: mapping.targetObjects.join(' -> '),
    cameraContinuity: 'Keep the object bridge readable and resolve into the next shot.',
    rhythm: template.transitionFunction === 'chaos_to_order' ? 'speed_ramp' : 'match_cut',
    emotionalBridge: template.emotionShift,
    notes: [
      template.transitionAction,
      'This is a transition plan, not a rendered visual effect.'
    ]
  };
}

function defaultMotionTokens(transitionFunction: TransitionFunction): MotionToken[] {
  if (transitionFunction === 'product_to_cta' || transitionFunction === 'proof_to_cta') {
    return ['cta_reveal', 'clean_hold'];
  }
  if (transitionFunction === 'chaos_to_order' || transitionFunction === 'ingredient_to_product') {
    return ['component_cascade', 'chaos_to_order', 'assembly_completion'];
  }
  return ['dynamic_entry', 'impact_beat', 'match_cut'];
}

function buildMissingAssetFallback(
  template: CategoryTransitionRecipeTemplate,
  mapping: CategoryObjectMapping,
  implementationMode: TransitionImplementationMode
): TransitionMissingAssetFallback {
  const mode = implementationMode === 'external_video_generation'
    ? 'external_generation_brief'
    : implementationMode === 'hyperframes'
      ? 'copy_card'
      : 'storyboard_prompt';
  return {
    mode,
    description: `If sourceable footage is missing, use ${implementationMode} as a handoff mode for "${template.name}".`,
    prompt: `${template.transitionAction} Target-native elements: ${mapping.targetObjects.join(', ')}.`,
    limitations: [
      'Plan-only fallback; it does not submit an external generation job.',
      'Final rendering still requires reviewed media or renderer integration.'
    ]
  };
}

function buildStoryboardPrompt(input: {
  template: CategoryTransitionRecipeTemplate;
  mapping: CategoryObjectMapping;
  productBrief?: TransitionProductBriefInput;
  variant: TransitionVariant;
  targetCategory: TargetCategory;
  implementationMode: TransitionImplementationMode;
}): string {
  const productName = getProductName(input.productBrief);
  const variantHint = input.variant === 'premium'
    ? 'restrained premium pacing'
    : input.variant === 'high_conversion'
      ? 'clear product benefit and CTA readability'
      : 'high-energy opening impact';
  return [
    `${input.template.name}: ${input.template.transitionAction}`,
    `Target category: ${input.targetCategory}. Product: ${productName}.`,
    `Use ${input.mapping.targetObjects.slice(0, 3).join(', ')} as the object bridge.`,
    `Style: ${variantHint}.`,
    `Implementation handoff: ${input.implementationMode}.`
  ].join(' ');
}

function buildVideoPrompt(input: {
  template: CategoryTransitionRecipeTemplate;
  mapping: CategoryObjectMapping;
  productBrief?: TransitionProductBriefInput;
  targetCategory: TargetCategory;
  implementationMode: TransitionImplementationMode;
}): string {
  const productName = getProductName(input.productBrief);
  const sellingPoint = getSellingPoint(input.productBrief);
  return [
    `Create a short plan-only transition for ${productName} in ${input.targetCategory}.`,
    `${input.template.transitionAction}`,
    `Visual bridge: ${input.mapping.visualPromptHints.join(' ')}`,
    `Objects: ${input.mapping.targetObjects.slice(0, 4).join(', ')}.`,
    `Benefit cue: ${sellingPoint}.`,
    `Do not claim this is rendered output; handoff mode is ${input.implementationMode}.`
  ].join(' ');
}

function getProductName(productBrief: TransitionProductBriefInput | undefined): string {
  return typeof productBrief?.productName === 'string' && productBrief.productName.trim().length > 0
    ? productBrief.productName.trim()
    : 'target product';
}

function getSellingPoint(productBrief: TransitionProductBriefInput | undefined): string {
  const sellingPoints = productBrief?.sellingPoints;
  if (Array.isArray(sellingPoints) && typeof sellingPoints[0] === 'string') {
    return sellingPoints[0];
  }
  return 'make the transferred structure readable for the new content';
}
