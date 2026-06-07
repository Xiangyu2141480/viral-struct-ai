import type { MotifTransferVariable, MotionToken, ShotSlotNode, ViralMotifAnnotation } from '@viral-struct/shared';
import { mapTargetCategoryMotif } from './targetCategoryMotifMapper';
import { containsSourceSpecificTerm, sanitizeMotionGrammarText } from './motionGrammarSanitizer';

export interface ViralMotifExtractorInput {
  slot: ShotSlotNode;
  targetCategory: string;
}

const KINETIC_ASSEMBLY_TOKENS: MotionToken[] = [
  'component_cascade',
  'chaos_to_order',
  'assembly_completion',
  'interaction_activation',
  'spectacle_burst',
  'cta_reveal'
];

export function extractViralMotifAnnotation(input: ViralMotifExtractorInput): ViralMotifAnnotation | undefined {
  const sourceText = collectSlotText(input.slot);
  const sanitized = sanitizeMotionGrammarText(sourceText);
  const kineticScore = scoreKineticAssemblyReveal(sanitized.motionTokens, sourceText);

  if (kineticScore < 0.62) {
    return undefined;
  }

  const targetCategoryMapping = mapTargetCategoryMotif({
    motifType: 'kinetic_assembly_reveal',
    targetCategory: input.targetCategory
  });

  return {
    id: `motif_${input.slot.id}_kinetic_assembly_reveal`,
    slotId: input.slot.id,
    segmentId: input.slot.segmentId,
    motifType: 'kinetic_assembly_reveal',
    motionTokens: sanitized.motionTokens,
    sanitizedIntent: sanitized.sanitizedIntent,
    transferVariables: buildTransferVariables(sanitized.motionTokens),
    bannedSourceTerms: sanitized.bannedSourceTerms,
    targetCategoryMapping,
    evidence: [
      ...sanitized.evidence,
      `Rule confidence ${kineticScore.toFixed(2)} from ${sanitized.motionTokens.length} motion token(s).`
    ],
    confidence: kineticScore
  };
}

function scoreKineticAssemblyReveal(tokens: MotionToken[], sourceText: string): number {
  const tokenHitCount = KINETIC_ASSEMBLY_TOKENS.filter((token) => tokens.includes(token)).length;
  const tokenScore = tokenHitCount / KINETIC_ASSEMBLY_TOKENS.length;
  const hasSourceSpecificCue = containsSourceSpecificTerm(sourceText);
  const hasAssemblyPair = tokens.includes('component_cascade') && tokens.includes('assembly_completion');
  const hasActivationPayoff = tokens.includes('interaction_activation') && (tokens.includes('spectacle_burst') || tokens.includes('cta_reveal'));
  const structureBonus = [hasSourceSpecificCue, hasAssemblyPair, hasActivationPayoff].filter(Boolean).length * 0.1;

  return clamp01(tokenScore * 0.8 + structureBonus);
}

function collectSlotText(slot: ShotSlotNode): string {
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
