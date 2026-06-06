import type {
  AssetSupplyContext,
  ContextualSlotCoverage,
  MaterialCoverageObservation,
  MissingIngredient,
  SlotAssetCandidate
} from '@viral-struct/shared';

export function getCoverageForSlot(
  context: AssetSupplyContext,
  slotId: string
): ContextualSlotCoverage | undefined {
  return context.contextualCoverage?.slotCoverages.find((coverage) => coverage.slotId === slotId);
}

export function getBestCandidatesForSlot(
  context: AssetSupplyContext,
  slotId: string,
  limit = 3
): SlotAssetCandidate[] {
  return (getCoverageForSlot(context, slotId)?.candidateAssets ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getObservationsForSlot(
  context: AssetSupplyContext,
  slotId: string
): MaterialCoverageObservation[] {
  return context.contextualCoverage?.observations.filter((observation) => observation.affectedSlotId === slotId) ?? [];
}

export function getMissingIngredientsForSlot(
  context: AssetSupplyContext,
  slotId: string
): MissingIngredient[] {
  const coverage = getCoverageForSlot(context, slotId);
  const observationIngredients = getObservationsForSlot(context, slotId).flatMap((observation) => [
    ...observation.missingIngredients,
    ...observation.availableButWeakIngredients
  ]);
  return dedupeIngredients([
    ...(coverage?.missingIngredients ?? []),
    ...(coverage?.weakIngredients ?? []),
    ...observationIngredients
  ]);
}

export function summarizeCoverageForSlot(context: AssetSupplyContext, slotId: string): string {
  const coverage = getCoverageForSlot(context, slotId);
  if (!coverage) return `No asset supply coverage is available for ${slotId}.`;

  const candidates = getBestCandidatesForSlot(context, slotId)
    .map((candidate) => `${candidate.assetId} (${candidate.fitStatus}, score=${candidate.score})`)
    .join(', ') || 'no candidate assets';
  const missing = getMissingIngredientsForSlot(context, slotId)
    .map((ingredient) => ingredient.label)
    .join(', ') || 'no missing ingredients';
  const observations = getObservationsForSlot(context, slotId);
  const observationText = observations.length
    ? `${observations.length} asset supply observation(s), not final MaterialGap decisions`
    : 'no asset supply observations';

  return `${coverage.slotId}: ${coverage.coverageStatus} coverage for ${coverage.slotRole}; candidates: ${candidates}; missing/weak ingredients: ${missing}; ${observationText}.`;
}

function dedupeIngredients(ingredients: MissingIngredient[]): MissingIngredient[] {
  const seen = new Set<string>();
  const result: MissingIngredient[] = [];
  for (const ingredient of ingredients) {
    const key = `${ingredient.requiredIngredientId}:${ingredient.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ingredient);
  }
  return result;
}
