import type {
  AssetCard,
  AssetManagerRole,
  AssetSupplyContext,
  AvailableIngredient,
  ContentBrief,
  ContextualAssetCoverageReport,
  ContextualSlotCoverage,
  CoverageImpact,
  MaterialCoverageObservation,
  MissingIngredient,
  MotifContext,
  NormalizedAssetCard,
  RequiredIngredient,
  ShotSlotNode,
  SlotAssetCandidate,
  SlotAssetUsableAs,
  SlotCandidateAsset,
  SlotCoverageRow,
  ViralStructureGraph
} from '@viral-struct/shared';
import { AssetSupplyContextSchema } from '@viral-struct/shared';
import { buildMotifContext, extractViralMotifAnnotation } from '../motifs/viralMotifExtractor';
import { analyzeAssetCoverage } from './assetCoverageAnalyzer';
import { buildMissingMaterialBriefs } from './missingMaterialBriefBuilder';
import { classifyMaterialScenario, type MaterialScenarioClassifierOptions } from './materialScenarioClassifier';

export interface BuildAssetSupplyContextInput {
  structureGraph?: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief?: ContentBrief;
  libraryId?: string;
  options?: MaterialScenarioClassifierOptions;
}

export function buildAssetSupplyContext(input: BuildAssetSupplyContextInput): AssetSupplyContext {
  const coverage = analyzeAssetCoverage({
    structureGraph: input.structureGraph,
    assetCards: input.assetCards,
    contentBrief: input.contentBrief,
    libraryId: input.libraryId
  });
  const libraryId = input.libraryId ?? coverage.report.libraryId;
  const contextualCoverage = buildContextualAssetCoverageReport({
    structureGraph: input.structureGraph,
    contentBrief: input.contentBrief,
    assetCards: coverage.assetCards,
    slotRows: coverage.matrix.slotRows,
    libraryId,
    warnings: coverage.warnings
  });
  const preliminaryScenario = classifyMaterialScenario({
    assets: coverage.assetCards,
    contextualCoverage,
    contentBrief: input.contentBrief,
    options: input.options
  });
  const missingMaterialBriefs = buildMissingMaterialBriefs({
    contextualCoverage,
    assetCards: coverage.assetCards,
    contentBrief: input.contentBrief,
    materialScenario: preliminaryScenario,
    structureGraph: input.structureGraph
  });
  const materialScenario = classifyMaterialScenario({
    assets: coverage.assetCards,
    contextualCoverage,
    contentBrief: input.contentBrief,
    missingMaterialBriefs,
    options: input.options
  });
  const warnings = Array.from(new Set([
    ...coverage.warnings,
    ...coverage.assetCards.flatMap((asset) => asset.analysis?.warnings ?? []),
    ...contextualCoverage.warnings,
    ...materialScenario.warnings
  ]));

  const context: AssetSupplyContext = {
    protocolVersion: 'asset-supply-v1',
    libraryId,
    generatedAt: '1970-01-01T00:00:00.000Z',
    assets: coverage.assetCards as NormalizedAssetCard[],
    libraryProfile: coverage.report,
    contextualCoverage,
    materialScenario,
    missingMaterialBriefs,
    warnings
  };

  return AssetSupplyContextSchema.parse(context) as AssetSupplyContext;
}

export interface BuildContextualCoverageInput {
  structureGraph?: ViralStructureGraph;
  contentBrief?: ContentBrief;
  assetCards: AssetCard[];
  slotRows: SlotCoverageRow[];
  libraryId: string;
  warnings?: string[];
}

export function buildContextualAssetCoverageReport(input: BuildContextualCoverageInput): ContextualAssetCoverageReport {
  const assetById = new Map(input.assetCards.map((asset) => [asset.id, asset]));
  const slotById = new Map((input.structureGraph?.shotSlots ?? []).map((slot) => [slot.id, slot]));
  const slotCoverages = input.slotRows.map((row) => buildSlotCoverage(row, slotById.get(row.slotId), assetById, input.contentBrief));
  const observations = slotCoverages
    .filter((coverage) => coverage.coverageStatus !== 'covered')
    .map((coverage, index) => buildObservation(coverage, index));
  const coveredSlots = slotCoverages.filter((coverage) => coverage.coverageStatus === 'covered').length;
  const weakSlots = slotCoverages.filter((coverage) => coverage.coverageStatus === 'weak').length;
  const insufficientSlots = slotCoverages.filter((coverage) => coverage.coverageStatus === 'insufficient').length;
  const totalSlots = slotCoverages.length;

  return {
    graphId: input.structureGraph ? 'structure_graph_input' : 'role_level_fallback',
    briefId: input.contentBrief ? safeId(input.contentBrief.productName) : undefined,
    libraryId: input.libraryId,
    coverageSummary: {
      totalSlots,
      coveredSlots,
      weakSlots,
      insufficientSlots,
      coverageScore: totalSlots === 0 ? 0 : roundScore(((coveredSlots + weakSlots * 0.5) / totalSlots) * 100)
    },
    slotCoverages,
    observations,
    warnings: Array.from(new Set([
      ...(input.warnings ?? []),
      ...(input.structureGraph?.shotSlots?.length ? [] : ['No shotSlots were provided; contextual coverage is role-level only.'])
    ]))
  };
}

function buildSlotCoverage(
  row: SlotCoverageRow,
  slot: ShotSlotNode | undefined,
  assetById: Map<string, AssetCard>,
  contentBrief: ContentBrief | undefined
): ContextualSlotCoverage {
  const requiredIngredients = buildRequiredIngredients(row, slot);
  const candidateAssets = row.candidates
    .map((candidate) => buildCandidate(candidate, row, assetById.get(candidate.assetId)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const bestCandidate = candidateAssets[0];
  const coverageStatus = finalizeCoverageStatus(row, bestCandidate);
  const availableIngredients = buildAvailableIngredients(requiredIngredients, row, coverageStatus, bestCandidate);
  const missingIngredients = buildMissingIngredients(requiredIngredients, row, coverageStatus, 'missing');
  const weakIngredients = buildMissingIngredients(requiredIngredients, row, coverageStatus, 'weak');
  const motifContext = buildSlotMotifContext(slot, contentBrief, coverageStatus);

  return {
    slotId: row.slotId,
    affectedSegmentId: row.segmentId,
    slotRole: row.slotRole ?? row.mappedRole,
    slotIntent: buildSlotIntent(row, slot),
    sourceInstance: buildSourceInstance(slot),
    acceptanceCriteria: buildAcceptanceCriteria(slot),
    requiredIngredients,
    availableIngredients,
    missingIngredients,
    weakIngredients,
    candidateAssets,
    coverageStatus,
    confidence: confidenceFromScore(row.bestScore),
    evidence: buildCoverageEvidence(row, bestCandidate, motifContext),
    limitations: buildLimitations(row, bestCandidate),
    motifContext
  };
}

function buildRequiredIngredients(row: SlotCoverageRow, slot?: ShotSlotNode): RequiredIngredient[] {
  const segmentId = row.segmentId;
  const slotId = row.slotId;
  const base: RequiredIngredient[] = [{
    id: `${safeId(slotId)}_visual_subject`,
    kind: 'visual_subject',
    label: slot?.requiredAsset.subject ?? row.mappedRole,
    requiredBy: { segmentId, slotId },
    importance: row.mappedRole === 'background' ? 'medium' : 'high'
  }, {
    id: `${safeId(slotId)}_shot_type`,
    kind: 'shot_type',
    label: slot?.requiredAsset.camera ? `${slot.requiredAsset.camera} shot` : `${row.mappedRole} framing`,
    requiredBy: { segmentId, slotId },
    importance: 'medium'
  }];

  if (slot?.requiredAsset.motion && slot.requiredAsset.motion !== 'static' && slot.requiredAsset.motion !== 'unknown') {
    addIngredient(base, slotId, segmentId, 'motion', slot.requiredAsset.motion, slot.requiredAsset.type === 'video' ? 'high' : 'medium');
  }
  if (slot?.requiredAsset.minDuration) {
    addIngredient(base, slotId, segmentId, 'duration', `${slot.requiredAsset.minDuration}s minimum duration`, 'medium');
  }
  addRoleSpecificIngredients(base, row, slot);

  return base;
}

function addRoleSpecificIngredients(ingredients: RequiredIngredient[], row: SlotCoverageRow, slot?: ShotSlotNode): void {
  const segmentId = row.segmentId;
  const slotId = row.slotId;
  const role = row.mappedRole;

  if (role === 'opening_hook') {
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for opening hook copy', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'aspect_ratio', 'target aspect ratio support', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'duration', 'enough hold time for opening hook', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'packaging_surface', 'surface for hook title or selling-point badge', 'medium');
  }
  if (role === 'product_closeup') {
    addIngredient(ingredients, slotId, segmentId, 'product_evidence', 'clear product or packaging evidence', 'high', firstAcceptanceCriterion(slot));
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for product label or short overlay', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'aspect_ratio', 'target aspect ratio support', 'medium');
  }
  if (role === 'usage_demo') {
    addIngredient(ingredients, slotId, segmentId, 'usage_evidence', 'real use or hand-operation evidence', 'high', firstAcceptanceCriterion(slot));
    addIngredient(ingredients, slotId, segmentId, 'motion', slot?.requiredAsset.motion ?? 'motion evidence', 'high');
    addIngredient(ingredients, slotId, segmentId, 'duration', 'enough duration for a believable use moment', 'high');
  }
  if (role === 'comparison') {
    addIngredient(ingredients, slotId, segmentId, 'comparison_evidence', 'before/after or lineup comparison evidence', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for contrast copy', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'packaging_surface', 'surface for comparison label or callout', 'medium');
  }
  if (role === 'benefit_proof') {
    addIngredient(ingredients, slotId, segmentId, 'product_evidence', 'product-linked proof for the selling point', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'packaging_surface', 'surface for benefit proof copy', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for benefit caption', 'medium');
  }
  if (role === 'cta') {
    addIngredient(ingredients, slotId, segmentId, 'cta_surface', 'clear action or purchase guidance surface', 'high');
    addIngredient(ingredients, slotId, segmentId, 'product_evidence', 'product visible near CTA', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for readable CTA copy', 'high');
    addIngredient(ingredients, slotId, segmentId, 'duration', 'enough duration for action guidance', 'medium');
  }
  if (role === 'cover') {
    addIngredient(ingredients, slotId, segmentId, 'product_evidence', 'clear product evidence for cover', 'high');
    addIngredient(ingredients, slotId, segmentId, 'text_safe_area', 'safe area for cover title', 'medium');
    addIngredient(ingredients, slotId, segmentId, 'aspect_ratio', 'cover aspect ratio support', 'medium');
  }
}

function addIngredient(
  ingredients: RequiredIngredient[],
  slotId: string,
  segmentId: string | undefined,
  kind: RequiredIngredient['kind'],
  label: string,
  importance: RequiredIngredient['importance'],
  acceptanceCriteria?: string
): void {
  const id = `${safeId(slotId)}_${kind}`;
  if (ingredients.some((ingredient) => ingredient.id === id)) return;
  ingredients.push({
    id,
    kind,
    label,
    requiredBy: { segmentId, slotId, acceptanceCriteria },
    importance
  });
}

function buildAvailableIngredients(
  ingredients: RequiredIngredient[],
  row: SlotCoverageRow,
  coverageStatus: ContextualSlotCoverage['coverageStatus'],
  candidate?: SlotAssetCandidate
): AvailableIngredient[] {
  if (!candidate || coverageStatus === 'insufficient') return [];
  return ingredients
    .filter((ingredient) => coverageStatus === 'covered' || ['visual_subject', 'shot_type', 'product_evidence', 'cta_surface'].includes(ingredient.kind))
    .map((ingredient) => ({
      requiredIngredientId: ingredient.id,
      assetId: candidate.assetId,
      score: coverageStatus === 'covered' ? candidate.score : Math.min(candidate.score, 64),
      evidence: candidate.evidence.reasons.slice(0, 2)
    }));
}

function buildMissingIngredients(
  ingredients: RequiredIngredient[],
  row: SlotCoverageRow,
  coverageStatus: ContextualSlotCoverage['coverageStatus'],
  mode: 'missing' | 'weak'
): MissingIngredient[] {
  if (coverageStatus === 'covered') return [];
  if (mode === 'weak' && coverageStatus !== 'weak') return [];
  if (mode === 'missing' && coverageStatus !== 'insufficient') return [];
  const selected = coverageStatus === 'weak'
    ? ingredients.filter((ingredient) => ['motion', 'usage_evidence', 'comparison_evidence', 'duration', 'text_safe_area'].includes(ingredient.kind))
    : ingredients;
  return selected.map((ingredient) => ({
    requiredIngredientId: ingredient.id,
    label: ingredient.label,
    reason: row.gapReason ?? `${row.mappedRole} is ${coverageStatus}; available assets do not fully satisfy ${ingredient.kind}.`,
    evidence: [
      `bestScore=${row.bestScore}`,
      `coverageStatus=${coverageStatus}`
    ]
  }));
}

function finalizeCoverageStatus(row: SlotCoverageRow, candidate?: SlotAssetCandidate): ContextualSlotCoverage['coverageStatus'] {
  const baseStatus: ContextualSlotCoverage['coverageStatus'] = row.status === 'missing' ? 'insufficient' : row.status;
  if (!candidate || candidate.score < 50) return 'insufficient';
  if (baseStatus === 'insufficient') return 'insufficient';
  if (candidate.score < 75) return 'weak';
  if (!candidate.mediaReadiness.hasUsableUrl) return 'weak';
  if ((row.slotRole ?? row.mappedRole) === 'cta_visual' && candidate.constraints.textSafeAreaRisk) return 'weak';
  if (candidate.constraints.notEnoughForStandaloneShot && baseStatus === 'covered') return 'weak';
  if (candidate.evidence.warnings.length >= 2 && baseStatus === 'covered') return 'weak';
  return baseStatus;
}

function buildCandidate(candidate: SlotCandidateAsset, row: SlotCoverageRow, asset?: AssetCard): SlotAssetCandidate {
  const keyframes = asset?.analysis?.media.keyframes ?? [];
  const sourceUrl = asset?.analysis?.media.sourceUrl ?? asset?.url;
  const mediaReadinessScore = scoreMediaReadiness(asset, sourceUrl, keyframes.length);
  const safetyScore = asset?.analysis?.safety.status === 'blocked'
    ? 0
    : asset?.analysis?.safety.status === 'needs_review'
      ? 55
      : 100;
  const score = Math.min(candidate.score, roundScore(
    0.30 * candidate.roleAffordance
    + 0.20 * candidate.assetQuality
    + 0.15 * mediaReadinessScore
    + 0.15 * candidate.intentSemanticMatch
    + 0.10 * candidate.editabilityFit
    + 0.10 * safetyScore
  ));
  return {
    assetId: candidate.assetId,
    score,
    fitStatus: score >= 75 ? 'strong' : score >= 50 ? 'usable' : 'weak',
    usableAs: mapUsableAs(asset, row.mappedRole),
    mediaReadiness: {
      hasUsableUrl: Boolean(sourceUrl),
      hasLocalPath: Boolean(sourceUrl && !/^https?:\/\//i.test(sourceUrl)),
      hasThumbnail: keyframes.some((keyframe) => Boolean(keyframe.url)),
      hasKeyframe: keyframes.length > 0,
      hasDuration: typeof asset?.analysis?.media.durationSec === 'number'
    },
    constraints: {
      maxRecommendedDurationSec: maxRecommendedDuration(asset),
      needsCrop: Boolean(asset?.analysis?.media.aspectRatio && asset.analysis.media.aspectRatio !== '9:16'),
      needsOverlaySupport: asset?.type === 'text' || row.status !== 'covered',
      notEnoughForStandaloneShot: candidate.score < 75 || asset?.type === 'text',
      textSafeAreaRisk: (asset?.analysis?.quality.textSafeArea ?? 0.7) < 0.55
    },
    evidence: {
      affordanceScore: candidate.roleAffordance,
      qualityScore: candidate.assetQuality,
      semanticSignals: buildSemanticSignals(asset),
      keyframeIds: keyframes.map((keyframe) => keyframe.id),
      reasons: [
        candidate.rationale,
        `ranking=0.30*roleAffordance(${candidate.roleAffordance}) + 0.20*quality(${candidate.assetQuality}) + 0.15*mediaReadiness(${mediaReadinessScore}) + 0.15*semantic(${candidate.intentSemanticMatch}) + 0.10*editability(${candidate.editabilityFit}) + 0.10*safety(${safetyScore})`
      ],
      warnings: asset?.analysis?.warnings ?? []
    }
  };
}

function scoreMediaReadiness(asset: AssetCard | undefined, sourceUrl: string | undefined, keyframeCount: number): number {
  if (!asset) return 0;
  let score = 0;
  if (sourceUrl) score += 35;
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) score += 10;
  if (keyframeCount > 0) score += 20;
  if (typeof asset.analysis?.media.durationSec === 'number') score += 15;
  if (asset.type === 'image' || asset.type === 'text') score += 10;
  if (asset.analysis?.media.width && asset.analysis.media.height) score += 10;
  return Math.min(100, score);
}

function buildObservation(coverage: ContextualSlotCoverage, index: number): MaterialCoverageObservation {
  const severity = severityForCoverage(coverage);
  const missingIngredients = coverage.coverageStatus === 'weak'
    ? []
    : coverage.missingIngredients;
  const availableButWeakIngredients = coverage.coverageStatus === 'weak'
    ? coverage.weakIngredients
    : [];

  return {
    id: `coverage_observation_${String(index + 1).padStart(3, '0')}_${safeId(coverage.slotId)}`,
    affectedSegmentId: coverage.affectedSegmentId,
    affectedSlotId: coverage.slotId,
    slotRole: coverage.slotRole,
    slotIntent: coverage.slotIntent,
    observationType: observationTypeForCoverage(coverage),
    requiredIngredients: coverage.requiredIngredients,
    missingIngredients,
    availableButWeakIngredients,
    bestCandidateAssetIds: coverage.candidateAssets.slice(0, 3).map((candidate) => candidate.assetId),
    potentialImpact: buildPotentialImpact(coverage, severity),
    severityEstimate: severity,
    confidence: coverage.confidence,
    evidence: buildObservationEvidence(coverage),
    motifContext: coverage.motifContext,
    motifType: coverage.motifContext?.motifType,
    missingMotionTokens: coverage.motifContext?.missingMotionTokens,
    targetMotifHints: coverage.motifContext?.targetMotifHints,
    ownership: 'asset_manager_observation_only'
  };
}

function observationTypeForCoverage(coverage: ContextualSlotCoverage): MaterialCoverageObservation['observationType'] {
  if (coverage.slotRole === 'usage_demo' || coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('usage'))) {
    return 'missing_usage_evidence';
  }
  if (coverage.slotRole === 'comparison' || coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('comparison'))) {
    return 'missing_comparison_evidence';
  }
  if (coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('motion'))) return 'missing_motion_evidence';
  if (coverage.slotRole === 'product_closeup' || coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('product'))) {
    return 'missing_product_evidence';
  }
  if (coverage.slotRole === 'cta' || coverage.slotRole === 'cta_visual') return 'missing_cta_surface';
  if (coverage.coverageStatus === 'weak' && coverage.candidateAssets.some((candidate) => candidate.evidence.qualityScore < 60)) {
    return 'weak_candidate_quality';
  }
  if (coverage.coverageStatus === 'weak') return 'weak_semantic_fit';
  return 'missing_required_ingredient';
}

function buildPotentialImpact(coverage: ContextualSlotCoverage, severity: 'low' | 'medium' | 'high'): CoverageImpact[] {
  const role = coverage.slotRole;
  if (role === 'opening_hook' || role === 'opening_attention') {
    return [{ type: 'hook_strength_reduced', description: 'Opening may rely on copy or motion treatment without stronger source material.', affectedMetric: 'hookStrength', severity }];
  }
  if (role === 'product_closeup') {
    return [{ type: 'product_clarity_reduced', description: 'Product recognition may be weaker without a strong closeup candidate.', affectedMetric: 'visualScriptAlignment', severity }];
  }
  if (role === 'usage_demo') {
    return [{ type: 'usage_proof_missing', description: 'Usage proof may need GapRepairPlanner or Video Agent treatment.', affectedMetric: 'slotCoverage', severity }];
  }
  if (role === 'comparison') {
    return [{ type: 'comparison_weakened', description: 'Comparison section may need restructuring or generated support.', affectedMetric: 'visualScriptAlignment', severity }];
  }
  if (role === 'cta' || role === 'cta_visual') {
    return [{ type: 'cta_clarity_reduced', description: 'CTA clarity may depend on downstream card/render decisions.', affectedMetric: 'ctaClarity', severity }];
  }
  return [{ type: 'packaging_overload_risk', description: 'Weak asset coverage can push too much meaning into packaging overlays.', affectedMetric: 'slotCoverage', severity }];
}

function severityForCoverage(coverage: ContextualSlotCoverage): 'low' | 'medium' | 'high' {
  if (coverage.coverageStatus === 'insufficient') {
    return ['opening_hook', 'opening_attention', 'product_closeup', 'usage_demo', 'cta', 'cta_visual'].includes(coverage.slotRole)
      ? 'high'
      : 'medium';
  }
  return coverage.candidateAssets[0]?.score && coverage.candidateAssets[0].score >= 60 ? 'low' : 'medium';
}

function buildSlotIntent(row: SlotCoverageRow, slot?: ShotSlotNode): string {
  return slot?.intent?.purpose
    ?? row.gapReason
    ?? `${row.mappedRole} asset supply coverage for ${row.slotId}.`;
}

function buildSourceInstance(slot?: ShotSlotNode): string | undefined {
  if (!slot?.sourceInstance) return undefined;
  return [
    slot.sourceInstance.productInSource,
    slot.sourceInstance.specificAction,
    slot.sourceInstance.colorSignature
  ].filter(Boolean).join(' | ');
}

function buildAcceptanceCriteria(slot?: ShotSlotNode): string[] | undefined {
  const criteria = slot?.acceptanceCriteria?.anyOf.flatMap((criterion) => [
    criterion.motionType,
    criterion.compositionType,
    ...criterion.examples
  ]).filter((value): value is string => Boolean(value));
  const reject = slot?.acceptanceCriteria?.rejectIf?.map((item) => `reject: ${item}`) ?? [];
  const values = [...(criteria ?? []), ...reject];
  return values.length ? values : undefined;
}

function firstAcceptanceCriterion(slot?: ShotSlotNode): string | undefined {
  return buildAcceptanceCriteria(slot)?.[0];
}

function buildCoverageEvidence(row: SlotCoverageRow, candidate?: SlotAssetCandidate, motifContext?: MotifContext): string[] {
  return [
    `coverageStatus=${row.status === 'missing' ? 'insufficient' : row.status}`,
    `bestScore=${row.bestScore}`,
    row.gapReason,
    candidate ? `bestCandidate=${candidate.assetId}` : undefined,
    motifContext ? `motif=${motifContext.motifType}` : undefined,
    motifContext?.missingMotionTokens.length ? `missingMotionTokens=${motifContext.missingMotionTokens.join('/')}` : undefined,
    motifContext?.targetMotifHints.length ? `targetMotifHints=${motifContext.targetMotifHints.slice(0, 4).join('/')}` : undefined
  ].filter((value): value is string => Boolean(value));
}

function buildObservationEvidence(coverage: ContextualSlotCoverage): string[] {
  if (!coverage.motifContext) {
    return coverage.evidence;
  }

  return [
    ...coverage.evidence,
    `motifContext=${coverage.motifContext.motifType}`,
    `motifIntent=${coverage.motifContext.sanitizedIntent}`
  ];
}

function buildSlotMotifContext(
  slot: ShotSlotNode | undefined,
  contentBrief: ContentBrief | undefined,
  coverageStatus: ContextualSlotCoverage['coverageStatus']
): MotifContext | undefined {
  const annotation = findSlotMotifAnnotation(slot, contentBrief);
  if (!annotation) {
    return undefined;
  }

  const context = buildMotifContext(annotation);
  return {
    ...context,
    missingMotionTokens: coverageStatus === 'covered' ? [] : context.motionTokens
  };
}

function findSlotMotifAnnotation(slot: ShotSlotNode | undefined, contentBrief: ContentBrief | undefined) {
  if (!slot) {
    return undefined;
  }

  const existing = slot.motifAnnotations?.find((annotation) => annotation.motifType !== undefined);
  if (existing) {
    return existing;
  }

  return extractViralMotifAnnotation({
    slot,
    targetCategory: inferTargetCategory(contentBrief)
  });
}

function inferTargetCategory(brief: ContentBrief | undefined): string {
  const text = [
    brief?.productName,
    brief?.scenario,
    brief?.stylePreference,
    ...(brief?.sellingPoints ?? [])
  ].filter(Boolean).join(' ').toLowerCase();

  if (/beverage|drink|tea|iced|红茶|饮料|冰/.test(text)) {
    return 'beverage';
  }

  return 'unknown';
}

function buildLimitations(row: SlotCoverageRow, candidate?: SlotAssetCandidate): string[] {
  const limitations: string[] = [];
  if (row.status !== 'covered') limitations.push(row.gapReason ?? `${row.mappedRole} coverage is not strong enough.`);
  if (!candidate) limitations.push('No candidate asset is available for this slot.');
  if (candidate?.constraints.notEnoughForStandaloneShot) limitations.push('Candidate should not be treated as a final standalone shot without downstream planning.');
  if (candidate?.constraints.needsCrop) limitations.push('Candidate may need crop or reframing for the target aspect ratio.');
  if (candidate?.constraints.textSafeAreaRisk) limitations.push('Candidate has text safe-area risk.');
  return limitations;
}

function mapUsableAs(asset: AssetCard | undefined, role: AssetManagerRole): SlotAssetUsableAs {
  if (!asset) return 'reference_only';
  if (asset.type === 'video') return 'video_clip';
  if (asset.type === 'image') {
    if (role === 'background') return 'background_plate';
    if (role === 'opening_hook' || role === 'cover') return 'poster_frame';
    return 'image_clip';
  }
  if (role === 'cta' || role === 'packaging_card') return 'overlay_support';
  return 'reference_only';
}

function maxRecommendedDuration(asset?: AssetCard): number | undefined {
  if (!asset) return undefined;
  if (asset.type === 'image') return 2.4;
  if (asset.type === 'text') return 1.8;
  return asset.analysis?.media.durationSec;
}

function buildSemanticSignals(asset?: AssetCard): string[] {
  if (!asset) return [];
  return [
    asset.analysis?.semantic.summary,
    ...asset.detectedObjects,
    ...(asset.detectedIngredients ?? []),
    ...(asset.visualStyleTags ?? []),
    ...(asset.analysis?.media.keyframes.map((keyframe) => keyframe.description ?? keyframe.id) ?? [])
  ].filter((value): value is string => Boolean(value)).slice(0, 8);
}

function confidenceFromScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_\-\u4e00-\u9fff]+/gu, '_').replace(/^_+|_+$/g, '') || 'input';
}
