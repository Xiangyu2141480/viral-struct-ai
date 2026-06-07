import type {
  AssetCard,
  AssetSupplyContext,
  ContextualSlotCoverage,
  MissingIngredient
} from '@viral-struct/shared';

export interface AssetMarginalContributionReport {
  generatedAt: string;
  libraryId: string;
  structureGraphId?: string;
  baseline: CoverageSnapshot;
  fullSet: CoverageSnapshot;
  incrementalSteps: IncrementalContributionStep[];
  leaveOneOut: LeaveOneOutContribution[];
  perAssetSummary: PerAssetContributionSummary[];
  warnings: string[];
}

export interface CoverageSnapshot {
  assetIds: string[];
  coverageScore: number;
  coveredSlots: number;
  weakSlots: number;
  insufficientSlots: number;
  observationsCount: number;
  roleBreakdown: Record<string, {
    covered: number;
    weak: number;
    insufficient: number;
  }>;
}

export interface IncrementalContributionStep {
  addedAssetId: string;
  assetTitle?: string;
  previousSnapshot: CoverageSnapshot;
  nextSnapshot: CoverageSnapshot;
  delta: CoverageDelta;
  changedSlots: SlotContributionDelta[];
  ingredientDeltas: IngredientContributionDelta[];
  interpretation: string[];
}

export interface LeaveOneOutContribution {
  removedAssetId: string;
  assetTitle?: string;
  fullSnapshot: CoverageSnapshot;
  withoutAssetSnapshot: CoverageSnapshot;
  deltaIfRemoved: CoverageDelta;
  affectedSlots: SlotContributionDelta[];
  interpretation: string[];
}

export interface CoverageDelta {
  coverageScoreDelta: number;
  coveredSlotsDelta: number;
  weakSlotsDelta: number;
  insufficientSlotsDelta: number;
  observationsDelta: number;
}

export interface SlotContributionDelta {
  slotId: string;
  affectedSegmentId?: string;
  role: string;
  previousStatus: 'covered' | 'weak' | 'insufficient' | 'missing';
  nextStatus: 'covered' | 'weak' | 'insufficient' | 'missing';
  previousBestAssetId?: string;
  nextBestAssetId?: string;
  reason: string;
}

export interface IngredientContributionDelta {
  slotId: string;
  ingredientLabel: string;
  change:
    | 'resolved'
    | 'weakened'
    | 'still_missing'
    | 'became_missing'
    | 'no_change';
  assetId?: string;
  reason: string;
}

export interface PerAssetContributionSummary {
  assetId: string;
  title?: string;
  mediaType?: string;
  primaryRoles: string[];
  directCoverageGain: CoverageDelta;
  uniqueContribution: boolean;
  redundantWithAssetIds: string[];
  improvedSlots: string[];
  statusChangedSlots: string[];
  ingredientImprovedSlots: string[];
  noGainReasons: string[];
  recommendedUse:
    | 'core_material'
    | 'supporting_material'
    | 'redundant_material'
    | 'quality_test_material'
    | 'reference_only';
}

export interface BuildIncrementalContributionStepInput {
  addedAsset: AssetCard;
  previousContext: AssetSupplyContext;
  nextContext: AssetSupplyContext;
}

export interface BuildLeaveOneOutContributionInput {
  removedAsset: AssetCard;
  fullContext: AssetSupplyContext;
  withoutAssetContext: AssetSupplyContext;
}

export interface SummarizePerAssetContributionInput {
  assetCards: AssetCard[];
  incrementalSteps: IncrementalContributionStep[];
  leaveOneOut: LeaveOneOutContribution[];
}

export interface BuildAssetMarginalContributionReportInput {
  libraryId: string;
  structureGraphId?: string;
  baselineContext: AssetSupplyContext;
  fullContext: AssetSupplyContext;
  incrementalSteps: IncrementalContributionStep[];
  leaveOneOut: LeaveOneOutContribution[];
  perAssetSummary: PerAssetContributionSummary[];
  warnings: string[];
}

type IngredientState = 'missing' | 'weak';

export function buildCoverageSnapshot(context: AssetSupplyContext): CoverageSnapshot {
  const summary = context.contextualCoverage?.coverageSummary;
  const slotCoverages = context.contextualCoverage?.slotCoverages ?? [];
  const roleBreakdown: CoverageSnapshot['roleBreakdown'] = {};

  for (const coverage of slotCoverages) {
    const role = coverage.slotRole;
    roleBreakdown[role] ??= { covered: 0, weak: 0, insufficient: 0 };
    roleBreakdown[role][coverage.coverageStatus] += 1;
  }

  return {
    assetIds: context.assets.map((asset) => asset.id),
    coverageScore: summary?.coverageScore ?? 0,
    coveredSlots: summary?.coveredSlots ?? 0,
    weakSlots: summary?.weakSlots ?? 0,
    insufficientSlots: summary?.insufficientSlots ?? 0,
    observationsCount: context.contextualCoverage?.observations.length ?? 0,
    roleBreakdown
  };
}

export function diffCoverageSnapshots(previous: CoverageSnapshot, next: CoverageSnapshot): CoverageDelta {
  return {
    coverageScoreDelta: roundDelta(next.coverageScore - previous.coverageScore),
    coveredSlotsDelta: next.coveredSlots - previous.coveredSlots,
    weakSlotsDelta: next.weakSlots - previous.weakSlots,
    insufficientSlotsDelta: next.insufficientSlots - previous.insufficientSlots,
    observationsDelta: next.observationsCount - previous.observationsCount
  };
}

export function diffSlotCoverage(previousContext: AssetSupplyContext, nextContext: AssetSupplyContext): SlotContributionDelta[] {
  const previousBySlot = coverageMap(previousContext);
  const nextBySlot = coverageMap(nextContext);
  const slotIds = Array.from(new Set([...previousBySlot.keys(), ...nextBySlot.keys()])).sort();
  const changes: SlotContributionDelta[] = [];

  for (const slotId of slotIds) {
    const previous = previousBySlot.get(slotId);
    const next = nextBySlot.get(slotId);
    const previousStatus = previous?.coverageStatus ?? 'missing';
    const nextStatus = next?.coverageStatus ?? 'missing';
    const previousBestAssetId = bestAssetId(previous);
    const nextBestAssetId = bestAssetId(next);
    if (previousStatus === nextStatus && previousBestAssetId === nextBestAssetId) continue;

    changes.push({
      slotId,
      affectedSegmentId: next?.affectedSegmentId ?? previous?.affectedSegmentId,
      role: next?.slotRole ?? previous?.slotRole ?? 'unknown',
      previousStatus,
      nextStatus,
      previousBestAssetId,
      nextBestAssetId,
      reason: buildSlotChangeReason(previous, next)
    });
  }

  return changes;
}

export function diffMissingIngredients(previousContext: AssetSupplyContext, nextContext: AssetSupplyContext): IngredientContributionDelta[] {
  const previousBySlot = coverageMap(previousContext);
  const nextBySlot = coverageMap(nextContext);
  const slotIds = Array.from(new Set([...previousBySlot.keys(), ...nextBySlot.keys()])).sort();
  const deltas: IngredientContributionDelta[] = [];

  for (const slotId of slotIds) {
    const previous = previousBySlot.get(slotId);
    const next = nextBySlot.get(slotId);
    const previousIngredients = ingredientStateMap(previous);
    const nextIngredients = ingredientStateMap(next);
    const ingredientKeys = Array.from(new Set([...previousIngredients.keys(), ...nextIngredients.keys()])).sort();

    for (const key of ingredientKeys) {
      const previousIngredient = previousIngredients.get(key);
      const nextIngredient = nextIngredients.get(key);
      const change = ingredientChange(previousIngredient?.state, nextIngredient?.state);
      if (change === 'no_change') continue;
      deltas.push({
        slotId,
        ingredientLabel: nextIngredient?.ingredient.label ?? previousIngredient?.ingredient.label ?? key,
        change,
        assetId: bestAssetId(next),
        reason: buildIngredientChangeReason(change, previousIngredient?.ingredient, nextIngredient?.ingredient, next)
      });
    }
  }

  return deltas;
}

export function buildIncrementalContributionStep(input: BuildIncrementalContributionStepInput): IncrementalContributionStep {
  const previousSnapshot = buildCoverageSnapshot(input.previousContext);
  const nextSnapshot = buildCoverageSnapshot(input.nextContext);
  const delta = diffCoverageSnapshots(previousSnapshot, nextSnapshot);
  const changedSlots = diffSlotCoverage(input.previousContext, input.nextContext);
  const ingredientDeltas = diffMissingIngredients(input.previousContext, input.nextContext);

  return {
    addedAssetId: input.addedAsset.id,
    assetTitle: assetTitle(input.addedAsset),
    previousSnapshot,
    nextSnapshot,
    delta,
    changedSlots,
    ingredientDeltas,
    interpretation: interpretIncrementalStep(input.addedAsset, delta, changedSlots, ingredientDeltas)
  };
}

export function buildLeaveOneOutContribution(input: BuildLeaveOneOutContributionInput): LeaveOneOutContribution {
  const fullSnapshot = buildCoverageSnapshot(input.fullContext);
  const withoutAssetSnapshot = buildCoverageSnapshot(input.withoutAssetContext);
  const deltaIfRemoved = diffCoverageSnapshots(fullSnapshot, withoutAssetSnapshot);
  const affectedSlots = diffSlotCoverage(input.fullContext, input.withoutAssetContext);

  return {
    removedAssetId: input.removedAsset.id,
    assetTitle: assetTitle(input.removedAsset),
    fullSnapshot,
    withoutAssetSnapshot,
    deltaIfRemoved,
    affectedSlots,
    interpretation: interpretLeaveOneOut(input.removedAsset, deltaIfRemoved, affectedSlots)
  };
}

export function summarizePerAssetContribution(input: SummarizePerAssetContributionInput): PerAssetContributionSummary[] {
  return input.assetCards.map((asset) => {
    const incremental = input.incrementalSteps.find((step) => step.addedAssetId === asset.id);
    const leaveOneOut = input.leaveOneOut.find((step) => step.removedAssetId === asset.id);
    const zeroDelta = zeroCoverageDelta();
    const directCoverageGain = incremental?.delta ?? zeroDelta;
    const improvedSlots = uniqueStrings([
      ...(incremental?.changedSlots
        .filter((slot) => statusRank(slot.nextStatus) > statusRank(slot.previousStatus))
        .map((slot) => slot.slotId) ?? []),
      ...(incremental?.ingredientDeltas
        .filter((delta) => delta.change === 'resolved' || delta.change === 'weakened')
        .map((delta) => delta.slotId) ?? [])
    ]);
    const statusChangedSlots = incremental?.changedSlots.map((slot) => slot.slotId) ?? [];
    const ingredientImprovedSlots = uniqueStrings(incremental?.ingredientDeltas
      .filter((delta) => delta.change === 'resolved' || delta.change === 'weakened')
      .map((delta) => delta.slotId) ?? []);
    const uniqueContribution = Boolean(
      (leaveOneOut?.deltaIfRemoved.coverageScoreDelta ?? 0) < 0
      || (leaveOneOut?.deltaIfRemoved.coveredSlotsDelta ?? 0) < 0
      || (leaveOneOut?.affectedSlots.some((slot) => statusRank(slot.nextStatus) < statusRank(slot.previousStatus)) ?? false)
    );
    const redundantWithAssetIds = uniqueContribution
      ? []
      : findLikelyRedundantAssets(asset, input.assetCards);
    const noGainReasons = buildNoGainReasons({
      asset,
      incremental,
      leaveOneOut,
      redundantWithAssetIds
    });

    return {
      assetId: asset.id,
      title: assetTitle(asset),
      mediaType: asset.type,
      primaryRoles: primaryRoles(asset),
      directCoverageGain,
      uniqueContribution,
      redundantWithAssetIds,
      improvedSlots,
      statusChangedSlots,
      ingredientImprovedSlots,
      noGainReasons,
      recommendedUse: recommendedUse(asset, directCoverageGain, uniqueContribution, improvedSlots, noGainReasons)
    };
  });
}

export function buildAssetMarginalContributionReport(input: BuildAssetMarginalContributionReportInput): AssetMarginalContributionReport {
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    libraryId: input.libraryId,
    structureGraphId: input.structureGraphId,
    baseline: buildCoverageSnapshot(input.baselineContext),
    fullSet: buildCoverageSnapshot(input.fullContext),
    incrementalSteps: input.incrementalSteps,
    leaveOneOut: input.leaveOneOut,
    perAssetSummary: input.perAssetSummary,
    warnings: Array.from(new Set(input.warnings))
  };
}

function coverageMap(context: AssetSupplyContext): Map<string, ContextualSlotCoverage> {
  return new Map((context.contextualCoverage?.slotCoverages ?? []).map((coverage) => [coverage.slotId, coverage]));
}

function bestAssetId(coverage?: ContextualSlotCoverage): string | undefined {
  return coverage?.candidateAssets.slice().sort((a, b) => b.score - a.score)[0]?.assetId;
}

function buildSlotChangeReason(previous?: ContextualSlotCoverage, next?: ContextualSlotCoverage): string {
  const previousStatus = previous?.coverageStatus ?? 'missing';
  const nextStatus = next?.coverageStatus ?? 'missing';
  const previousBest = bestAssetId(previous);
  const nextBest = bestAssetId(next);
  const reasons: string[] = [];
  if (previousStatus !== nextStatus) {
    reasons.push(`coverage status changed from ${previousStatus} to ${nextStatus}`);
  }
  if (previousBest !== nextBest) {
    reasons.push(`best candidate changed from ${previousBest ?? 'none'} to ${nextBest ?? 'none'}`);
  }
  if (next?.limitations.length) {
    reasons.push(`remaining limitation: ${next.limitations[0]}`);
  }
  return reasons.join('; ') || 'slot evidence changed';
}

function ingredientStateMap(coverage?: ContextualSlotCoverage): Map<string, { state: IngredientState; ingredient: MissingIngredient }> {
  const map = new Map<string, { state: IngredientState; ingredient: MissingIngredient }>();
  for (const ingredient of coverage?.missingIngredients ?? []) {
    map.set(ingredient.requiredIngredientId, { state: 'missing', ingredient });
  }
  for (const ingredient of coverage?.weakIngredients ?? []) {
    map.set(ingredient.requiredIngredientId, { state: 'weak', ingredient });
  }
  return map;
}

function ingredientChange(
  previous: IngredientState | undefined,
  next: IngredientState | undefined
): IngredientContributionDelta['change'] {
  if (previous === undefined && next === undefined) return 'no_change';
  if (previous !== undefined && next === undefined) return 'resolved';
  if (previous === 'missing' && next === 'weak') return 'weakened';
  if (previous === undefined && next !== undefined) return 'became_missing';
  if (previous === 'weak' && next === 'missing') return 'became_missing';
  if (previous !== undefined && next !== undefined) return 'still_missing';
  return 'no_change';
}

function buildIngredientChangeReason(
  change: IngredientContributionDelta['change'],
  previous: MissingIngredient | undefined,
  next: MissingIngredient | undefined,
  nextCoverage: ContextualSlotCoverage | undefined
): string {
  const label = next?.label ?? previous?.label ?? 'ingredient';
  const assetId = bestAssetId(nextCoverage);
  if (change === 'resolved') return `${label} is no longer missing or weak after adding stronger asset evidence.`;
  if (change === 'weakened') return `${label} improved from missing to weak evidence, but still needs stronger proof.`;
  if (change === 'became_missing') return `${label} became missing or weaker in this comparison.`;
  if (change === 'still_missing') return `${label} remains unresolved${assetId ? `; best current candidate is ${assetId}` : ''}.`;
  return `${label} did not change.`;
}

function interpretIncrementalStep(
  asset: AssetCard,
  delta: CoverageDelta,
  changedSlots: SlotContributionDelta[],
  ingredientDeltas: IngredientContributionDelta[]
): string[] {
  const lines: string[] = [];
  if (delta.coverageScoreDelta > 0 || delta.coveredSlotsDelta > 0) {
    lines.push(`${asset.id} increased coverage by ${delta.coverageScoreDelta} point(s) and changed ${changedSlots.length} slot(s).`);
  }
  const resolvedIngredients = ingredientDeltas.filter((deltaItem) => deltaItem.change === 'resolved' || deltaItem.change === 'weakened');
  if (resolvedIngredients.length > 0) {
    lines.push(`${asset.id} improved ingredient evidence in ${uniqueStrings(resolvedIngredients.map((deltaItem) => deltaItem.slotId)).length} slot(s).`);
  }
  if (lines.length === 0) {
    lines.push(`${asset.id} did not change coverage status; likely role overlap or lower score than the existing best candidate.`);
  }
  if (changedSlots.length === 0 && resolvedIngredients.length === 0) {
    lines.push('Treat it as supporting/reference material unless leave-one-out analysis shows unique impact.');
  }
  return lines;
}

function interpretLeaveOneOut(asset: AssetCard, delta: CoverageDelta, affectedSlots: SlotContributionDelta[]): string[] {
  if (delta.coverageScoreDelta < 0 || delta.coveredSlotsDelta < 0) {
    return [`Removing ${asset.id} reduces coverage; this asset has unique contribution in the current library.`];
  }
  if (affectedSlots.length > 0) {
    return [`Removing ${asset.id} changes best candidates but does not reduce overall score; contribution is useful but replaceable.`];
  }
  return [`Removing ${asset.id} does not change coverage; likely redundant with stronger existing assets or outside this source graph's roles.`];
}

function buildNoGainReasons(input: {
  asset: AssetCard;
  incremental?: IncrementalContributionStep;
  leaveOneOut?: LeaveOneOutContribution;
  redundantWithAssetIds: string[];
}): string[] {
  const reasons: string[] = [];
  const incremental = input.incremental;
  if (!incremental) {
    reasons.push('Asset was not included in incremental analysis.');
  } else {
    if (incremental.delta.coverageScoreDelta <= 0 && incremental.changedSlots.length === 0) {
      reasons.push('No coverage status changed when this asset was added; evidence overlaps existing best candidates.');
    }
    if (incremental.delta.coverageScoreDelta <= 0 && incremental.ingredientDeltas.some((delta) => delta.change === 'resolved' || delta.change === 'weakened')) {
      reasons.push('It improved missing or weak ingredients, but not enough to cross the covered threshold.');
    }
  }
  if (input.redundantWithAssetIds.length) {
    reasons.push(`Role overlap with existing asset(s): ${input.redundantWithAssetIds.slice(0, 3).join(', ')}.`);
  }
  if ((input.asset.analysis?.quality.overallScore ?? input.asset.qualityScore) < 0.5) {
    reasons.push('Quality score is low, so this asset should stay as quality-test/reference evidence.');
  }
  if (input.leaveOneOut && input.leaveOneOut.deltaIfRemoved.coverageScoreDelta === 0 && input.leaveOneOut.affectedSlots.length === 0) {
    reasons.push('Leave-one-out analysis shows no unique dependency on this asset.');
  }
  return uniqueStrings(reasons);
}

function recommendedUse(
  asset: AssetCard,
  directCoverageGain: CoverageDelta,
  uniqueContribution: boolean,
  improvedSlots: string[],
  noGainReasons: string[]
): PerAssetContributionSummary['recommendedUse'] {
  if ((asset.analysis?.quality.overallScore ?? asset.qualityScore) < 0.5 || asset.analysis?.warnings.length) {
    return 'quality_test_material';
  }
  if (uniqueContribution && (directCoverageGain.coveredSlotsDelta > 0 || directCoverageGain.coverageScoreDelta > 0)) {
    return 'core_material';
  }
  if (uniqueContribution || improvedSlots.length > 0) return 'supporting_material';
  if (noGainReasons.some((reason) => /overlap|redundant|Leave-one-out/i.test(reason))) return 'redundant_material';
  return 'reference_only';
}

function findLikelyRedundantAssets(asset: AssetCard, allAssets: AssetCard[]): string[] {
  const roles = primaryRoles(asset);
  if (roles.length === 0) return [];
  return allAssets
    .filter((other) => other.id !== asset.id)
    .filter((other) => primaryRoles(other).some((role) => roles.includes(role)))
    .map((other) => other.id);
}

function primaryRoles(asset: AssetCard): string[] {
  const fromAnalysis = asset.analysis?.slotAffordance?.primaryRoles?.map((role) => role.role) ?? [];
  return uniqueStrings([
    ...fromAnalysis,
    ...(asset.suitableSlots ?? [])
  ]).slice(0, 5);
}

function assetTitle(asset: AssetCard): string | undefined {
  return asset.spatialDescription ?? asset.text ?? asset.url ?? asset.id;
}

function statusRank(status: SlotContributionDelta['previousStatus']): number {
  if (status === 'covered') return 3;
  if (status === 'weak') return 2;
  if (status === 'insufficient') return 1;
  return 0;
}

function zeroCoverageDelta(): CoverageDelta {
  return {
    coverageScoreDelta: 0,
    coveredSlotsDelta: 0,
    weakSlotsDelta: 0,
    insufficientSlotsDelta: 0,
    observationsDelta: 0
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function roundDelta(value: number): number {
  return Number(value.toFixed(1));
}
