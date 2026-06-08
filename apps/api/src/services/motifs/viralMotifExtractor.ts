import type { MotifTransferVariable, MotionToken, ShotSlotNode, ViralMotifAnnotation, MotifContext } from '@viral-struct/shared';
import { mapTargetCategoryMotif } from './targetCategoryMotifMapper';
import { sanitizeMotionGrammarText } from './motionGrammarSanitizer';
import { classifyMotif, type MotifClassification } from './motifTaxonomy';
import type { CategoryPreset } from './categoryPresetProvider';

export interface ViralMotifExtractorInput {
  slot: ShotSlotNode;
  targetCategory: string;
  /** Optional D2 preset (generated at asset-parse). Drives target mapping. */
  preset?: CategoryPreset;
}

export function extractViralMotifAnnotation(input: ViralMotifExtractorInput): ViralMotifAnnotation | undefined {
  const sourceText = collectSlotText(input.slot);
  const sanitized = sanitizeMotionGrammarText(sourceText);
  const classification = classifyMotif(sanitized.motionTokens);

  // `category_usage_moment` is the plain baseline (ordinary open/pour/drink).
  // Per the tested contract, ordinary usage slots carry NO motif annotation and
  // fall back to the existing plain brief path — so we recognise it but emit
  // undefined here. Every other classified motif produces an annotation.
  if (!classification.definition || classification.definition.motifType === 'category_usage_moment') {
    return undefined;
  }

  const { definition, score } = classification;
  const targetCategoryMapping = mapTargetCategoryMotif({
    motifType: definition.motifType,
    targetCategory: input.targetCategory,
    preset: input.preset
  });

  return {
    id: `motif_${input.slot.id}_${definition.motifType}`,
    slotId: input.slot.id,
    segmentId: input.slot.segmentId,
    motifType: definition.motifType,
    motionTokens: sanitized.motionTokens,
    sanitizedIntent: sanitized.sanitizedIntent,
    transferVariables: buildTransferVariables(sanitized.motionTokens),
    bannedSourceTerms: sanitized.bannedSourceTerms,
    targetCategoryMapping,
    evidence: [
      ...sanitized.evidence,
      `Classified as ${definition.motifType} (${definition.summary}).`,
      `Rule confidence ${score.toFixed(2)} from ${sanitized.motionTokens.length} motion token(s).`
    ],
    confidence: score
  };
}

/**
 * Surface motion-grammar signal for offline taxonomy expansion (decision D1).
 * When tokens are detected but no defined motif matched, the returned
 * classification carries `isNovel: true` + a `candidate`, so unseen semantics
 * can be promoted into a new MOTIF_DEFINITIONS entry instead of being dropped.
 */
export function inspectMotifSignal(slot: ShotSlotNode): MotifClassification {
  return classifyMotif(sanitizeMotionGrammarText(collectSlotText(slot)).motionTokens);
}

export function buildMotifContext(annotation: ViralMotifAnnotation): MotifContext {
  return {
    motifAnnotationId: annotation.id,
    motifType: annotation.motifType,
    motionTokens: annotation.motionTokens,
    missingMotionTokens: annotation.motionTokens,
    sanitizedIntent: annotation.sanitizedIntent,
    targetMotifHints: annotation.targetCategoryMapping.preferredEquivalents,
    confidence: annotation.confidence,
    evidence: annotation.evidence
  };
}

export function collectSlotText(slot: ShotSlotNode): string {
  const acceptanceText = slot.acceptanceCriteria?.anyOf
    .flatMap((criterion) => [
      criterion.motionType,
      criterion.compositionType,
      ...criterion.examples
    ])
    .filter(Boolean)
    .join(' ');

  return [
    slot.id,
    slot.role,
    slot.requiredAsset.subject,
    slot.requiredAsset.motion,
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.intent?.compositionPrincipal,
    slot.sourceInstance?.productInSource,
    slot.sourceInstance?.specificAction,
    acceptanceText,
    slot.acceptanceCriteria?.rejectIf?.join(' ')
  ].filter(Boolean).join(' ');
}

function buildTransferVariables(tokens: MotionToken[]): MotifTransferVariable[] {
  const variables: MotifTransferVariable[] = [];

  if (tokens.includes('component_cascade') || tokens.includes('chaos_to_order')) {
    variables.push({
      name: 'cascade_material',
      sourceValue: 'source product components',
      targetValue: 'ice cubes, lemon slices, tea droplets, or cold mist',
      allowedTargetValues: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist'],
      notes: 'Preserve the cascade energy while using beverage-native materials.'
    });
  }

  if (tokens.includes('assembly_completion')) {
    variables.push({
      name: 'assembly_payoff',
      sourceValue: 'source product assembly',
      targetValue: 'pour to cup or bottle rotation reveal',
      allowedTargetValues: ['pour to cup', 'bottle rotation', 'lineup sweep'],
      notes: 'Translate assembly into a drink-state reveal, not hardware construction.'
    });
  }

  if (tokens.includes('interaction_activation')) {
    variables.push({
      name: 'activation_action',
      sourceValue: 'source interaction trigger',
      targetValue: 'cap opening or hand-triggered pour',
      allowedTargetValues: ['cap opening', 'hand pour', 'benefit card tap'],
      notes: 'Keep the interaction tactile and product-safe.'
    });
  }

  if (tokens.includes('spectacle_burst') || tokens.includes('cta_reveal')) {
    variables.push({
      name: 'payoff_surface',
      sourceValue: 'source spectacle and purchase reveal',
      targetValue: 'cold splash, benefit card, or CTA lock-up',
      allowedTargetValues: ['cold splash', 'HyperFrames benefit card drop', 'CTA lock-up'],
      notes: 'Use an explicit CTA surface without source layout or brand copying.'
    });
  }

  return variables;
}
