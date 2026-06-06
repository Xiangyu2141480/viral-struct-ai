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
import { analyzeAssetCoverage } from './assetCoverageAnalyzer';

export interface BuildAssetSupplyContextInput {
  structureGraph?: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief?: ContentBrief;
  libraryId?: string;
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
  const warnings = Array.from(new Set([
    ...coverage.warnings,
    ...coverage.assetCards.flatMap((asset) => asset.analysis?.warnings ?? []),
    ...contextualCoverage.warnings
  ]));

  const context: AssetSupplyContext = {
    protocolVersion: 'asset-supply-v1',
    libraryId,
    generatedAt: '1970-01-01T00:00:00.000Z',
    assets: coverage.assetCards as NormalizedAssetCard[],
    libraryProfile: coverage.report,
    contextualCoverage,
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
  const slotCoverages = input.slotRows.map((row) => buildSlotCoverage(row, slotById.get(row.slotId), assetById));
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
  assetById: Map<string, AssetCard>
): ContextualSlotCoverage {
  const requiredIngredients = buildRequiredIngredients(row, slot);
  const candidateAssets = row.candidates.slice(0, 3).map((candidate) => buildCandidate(candidate, row, assetById.get(candidate.assetId)));
  const coverageStatus = row.status === 'missing' ? 'insufficient' : row.status;
  const bestCandidate = candidateAssets[0];
  const availableIngredients = buildAvailableIngredients(requiredIngredients, row, bestCandidate);
  const missingIngredients = buildMissingIngredients(requiredIngredients, row, 'missing');
  const weakIngredients = buildMissingIngredients(requiredIngredients, row, 'weak');

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
    evidence: buildCoverageEvidence(row, bestCandidate),
    limitations: buildLimitations(row, bestCandidate)
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
    base.push({
      id: `${safeId(slotId)}_motion`,
      kind: 'motion',
      label: slot.requiredAsset.motion,
      requiredBy: { segmentId, slotId },
      importance: slot.requiredAsset.type === 'video' ? 'high' : 'medium'
    });
  }
  if (slot?.requiredAsset.minDuration) {
    base.push({
      id: `${safeId(slotId)}_duration`,
      kind: 'duration',
      label: `${slot.requiredAsset.minDuration}s minimum duration`,
      requiredBy: { segmentId, slotId },
      importance: 'medium'
    });
  }
  if (['product_closeup', 'opening_hook', 'cover'].includes(row.mappedRole)) {
    base.push({
      id: `${safeId(slotId)}_product_evidence`,
      kind: 'product_evidence',
      label: 'clear product or packaging evidence',
      requiredBy: { segmentId, slotId, acceptanceCriteria: firstAcceptanceCriterion(slot) },
      importance: 'high'
    });
  }
  if (row.mappedRole === 'usage_demo') {
    base.push({
      id: `${safeId(slotId)}_usage_evidence`,
      kind: 'usage_evidence',
      label: 'real use or hand-operation evidence',
      requiredBy: { segmentId, slotId, acceptanceCriteria: firstAcceptanceCriterion(slot) },
      importance: 'high'
    });
  }
  if (row.mappedRole === 'comparison') {
    base.push({
      id: `${safeId(slotId)}_comparison_evidence`,
      kind: 'comparison_evidence',
      label: 'before/after or lineup comparison evidence',
      requiredBy: { segmentId, slotId },
      importance: 'medium'
    });
  }
  if (row.mappedRole === 'cta') {
    base.push({
      id: `${safeId(slotId)}_cta_surface`,
      kind: 'cta_surface',
      label: 'clear action or purchase guidance surface',
      requiredBy: { segmentId, slotId },
      importance: 'high'
    });
  }
  if (row.mappedRole === 'packaging_card' || row.mappedRole === 'cta') {
    base.push({
      id: `${safeId(slotId)}_text_safe_area`,
      kind: 'text_safe_area',
      label: 'safe area for readable overlay text',
      requiredBy: { segmentId, slotId },
      importance: 'medium'
    });
  }

  return base;
}

function buildAvailableIngredients(
  ingredients: RequiredIngredient[],
  row: SlotCoverageRow,
  candidate?: SlotAssetCandidate
): AvailableIngredient[] {
  if (!candidate || row.status === 'missing') return [];
  return ingredients
    .filter((ingredient) => row.status === 'covered' || ['visual_subject', 'shot_type', 'product_evidence', 'cta_surface'].includes(ingredient.kind))
    .map((ingredient) => ({
      requiredIngredientId: ingredient.id,
      assetId: candidate.assetId,
      score: row.status === 'covered' ? candidate.score : Math.min(candidate.score, 64),
      evidence: candidate.evidence.reasons.slice(0, 2)
    }));
}

function buildMissingIngredients(
  ingredients: RequiredIngredient[],
  row: SlotCoverageRow,
  mode: 'missing' | 'weak'
): MissingIngredient[] {
  if (row.status === 'covered') return [];
  if (mode === 'weak' && row.status !== 'weak') return [];
  if (mode === 'missing' && row.status !== 'missing') return [];
  const selected = row.status === 'weak'
    ? ingredients.filter((ingredient) => ['motion', 'usage_evidence', 'comparison_evidence', 'duration', 'text_safe_area'].includes(ingredient.kind))
    : ingredients;
  return selected.map((ingredient) => ({
    requiredIngredientId: ingredient.id,
    label: ingredient.label,
    reason: row.gapReason ?? `${row.mappedRole} is ${row.status}; available assets do not fully satisfy ${ingredient.kind}.`,
    evidence: [
      `bestScore=${row.bestScore}`,
      `coverageStatus=${row.status === 'missing' ? 'insufficient' : row.status}`
    ]
  }));
}

function buildCandidate(candidate: SlotCandidateAsset, row: SlotCoverageRow, asset?: AssetCard): SlotAssetCandidate {
  const keyframes = asset?.analysis?.media.keyframes ?? [];
  const sourceUrl = asset?.analysis?.media.sourceUrl ?? asset?.url;
  return {
    assetId: candidate.assetId,
    score: candidate.score,
    fitStatus: candidate.score >= 75 ? 'strong' : candidate.score >= 50 ? 'usable' : 'weak',
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
      reasons: [candidate.rationale],
      warnings: asset?.analysis?.warnings ?? []
    }
  };
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
    evidence: coverage.evidence,
    ownership: 'asset_manager_observation_only'
  };
}

function observationTypeForCoverage(coverage: ContextualSlotCoverage): MaterialCoverageObservation['observationType'] {
  if (coverage.slotRole === 'usage_demo' || coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('usage'))) {
    return 'missing_usage_evidence';
  }
  if (coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('motion'))) return 'missing_motion_evidence';
  if (coverage.slotRole === 'product_closeup' || coverage.missingIngredients.some((ingredient) => ingredient.requiredIngredientId.includes('product'))) {
    return 'missing_product_evidence';
  }
  if (coverage.slotRole === 'cta') return 'missing_cta_surface';
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

function buildCoverageEvidence(row: SlotCoverageRow, candidate?: SlotAssetCandidate): string[] {
  return [
    `coverageStatus=${row.status === 'missing' ? 'insufficient' : row.status}`,
    `bestScore=${row.bestScore}`,
    row.gapReason,
    candidate ? `bestCandidate=${candidate.assetId}` : undefined
  ].filter((value): value is string => Boolean(value));
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
