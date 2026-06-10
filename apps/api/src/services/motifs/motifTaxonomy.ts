import type { MotifType, MotionToken } from '@viral-struct/shared';

/**
 * Data-driven motif taxonomy.
 *
 * Each entry maps a {@link MotifType} to the motion tokens that signal it. This
 * is the single extension point for "add a new motif type": append one
 * definition here (and add the value to the shared `MotifType` enum). The
 * extractor scores every definition and picks the best match, so no scoring
 * logic changes when the taxonomy grows.
 *
 * Token semantics live in `motionGrammarSanitizer` (the rule table that turns
 * source text into MotionTokens). Adding a token rule there + referencing it in
 * a definition here is all that's needed to cover a new viral pattern.
 */
export interface MotifDefinition {
  motifType: MotifType;
  /** Tokens that evidence this motif. Score rises with the fraction present. */
  signalTokens: MotionToken[];
  /** Co-occurring token pairs that add a structure bonus (stronger evidence). */
  strongPairs?: Array<[MotionToken, MotionToken]>;
  /** Minimum score (0-1) to classify as this motif. */
  threshold: number;
  /** Tie-breaker when scores are equal: higher = more specific, wins. */
  priority: number;
  /** One-line human note (shown in evidence). */
  summary: string;
}

export const MOTIF_DEFINITIONS: MotifDefinition[] = [
  {
    motifType: 'kinetic_assembly_reveal',
    signalTokens: ['component_cascade', 'chaos_to_order', 'assembly_completion', 'interaction_activation', 'spectacle_burst', 'cta_reveal'],
    strongPairs: [['component_cascade', 'assembly_completion'], ['interaction_activation', 'spectacle_burst']],
    threshold: 0.62,
    priority: 100,
    summary: 'full surreal chain: cascade → assemble → interaction trigger → spectacle → CTA'
  },
  {
    motifType: 'surreal_assembly',
    signalTokens: ['component_cascade', 'falling_object', 'assembly_completion', 'assembly_reveal', 'morph', 'chaos_to_order'],
    strongPairs: [['component_cascade', 'assembly_completion'], ['falling_object', 'assembly_reveal']],
    threshold: 0.5,
    priority: 80,
    summary: 'surreal parts converge into a whole, but without the interaction/CTA payoff'
  },
  {
    motifType: 'ingredient_transformation',
    signalTokens: ['component_cascade', 'morph', 'flow_motion', 'falling_object'],
    strongPairs: [['component_cascade', 'morph'], ['flow_motion', 'falling_object']],
    threshold: 0.5,
    priority: 75,
    summary: 'category-native ingredients cascade / transform / flow together'
  },
  {
    motifType: 'kinetic_product_reveal',
    signalTokens: ['dynamic_entry', 'object_rotation', 'push_in', 'assembly_reveal', 'clean_hold'],
    strongPairs: [['dynamic_entry', 'clean_hold'], ['object_rotation', 'push_in']],
    threshold: 0.5,
    priority: 70,
    summary: 'product revealed via whole-object motion (rotation / push-in), not fragments'
  },
  {
    motifType: 'lineup_lockup',
    signalTokens: ['lineup_sweep', 'object_rotation', 'clean_hold', 'cta_reveal'],
    strongPairs: [['lineup_sweep', 'clean_hold']],
    threshold: 0.5,
    priority: 70,
    summary: 'product lineup / pack sweep resolving into a clean lockup'
  },
  {
    motifType: 'impact_activation',
    signalTokens: ['impact_beat', 'activation_moment', 'snap_open', 'interaction_activation'],
    strongPairs: [['impact_beat', 'activation_moment']],
    threshold: 0.5,
    priority: 65,
    summary: 'an impact / beat triggers a state activation'
  },
  {
    motifType: 'dynamic_entry',
    signalTokens: ['dynamic_entry', 'falling_object', 'impact_beat', 'push_in'],
    strongPairs: [['dynamic_entry', 'impact_beat']],
    threshold: 0.5,
    priority: 60,
    summary: 'high-energy object entry as an opening hook'
  },
  {
    motifType: 'benefit_card_motion',
    signalTokens: ['card_drop', 'clean_hold', 'cta_reveal'],
    strongPairs: [['card_drop', 'cta_reveal']],
    threshold: 0.5,
    priority: 55,
    summary: 'benefit / info card animation (HyperFrames-style), not live footage'
  },
  {
    motifType: 'category_usage_moment',
    signalTokens: ['snap_open', 'flow_motion', 'consume_action', 'activation_moment'],
    strongPairs: [['snap_open', 'consume_action'], ['flow_motion', 'consume_action']],
    threshold: 0.45,
    priority: 40,
    summary: 'ordinary category usage (open / pour / drink) — the plain baseline'
  }
];

export interface NovelMotifCandidate {
  detectedTokens: MotionToken[];
  suggestedSlug: string;
  note: string;
}

export interface MotifClassification {
  definition?: MotifDefinition;
  score: number;
  detectedTokens: MotionToken[];
  /** Tokens were detected but no definition cleared its threshold. */
  isNovel: boolean;
  candidate?: NovelMotifCandidate;
}

export function scoreMotifDefinition(tokens: MotionToken[], def: MotifDefinition): number {
  const present = new Set(tokens);
  const matched = def.signalTokens.filter((token) => present.has(token)).length;
  const tokenScore = def.signalTokens.length === 0 ? 0 : (matched / def.signalTokens.length) * 0.8;
  const pairBonus = (def.strongPairs ?? []).filter(([a, b]) => present.has(a) && present.has(b)).length * 0.1;
  return clamp01(tokenScore + Math.min(0.2, pairBonus));
}

/**
 * Classify detected motion tokens into the best-matching motif type.
 *
 * Returns `definition: undefined` when nothing clears a threshold. When tokens
 * were nonetheless detected, `isNovel` is true and a `candidate` is attached so
 * unseen semantics surface for a human / offline LLM to promote into a new
 * MOTIF_DEFINITIONS entry, instead of being silently dropped.
 */
export function classifyMotif(tokens: MotionToken[]): MotifClassification {
  const detectedTokens = Array.from(new Set(tokens));
  const scored = MOTIF_DEFINITIONS
    .map((def) => ({ def, score: scoreMotifDefinition(detectedTokens, def) }))
    .filter((entry) => entry.score >= entry.def.threshold)
    .sort((a, b) => (b.score - a.score) || (b.def.priority - a.def.priority));

  if (scored.length > 0) {
    return { definition: scored[0].def, score: scored[0].score, detectedTokens, isNovel: false };
  }

  if (detectedTokens.length >= 2) {
    return {
      score: 0,
      detectedTokens,
      isNovel: true,
      candidate: {
        detectedTokens,
        suggestedSlug: detectedTokens.join('+'),
        note: `Detected motion tokens [${detectedTokens.join(', ')}] but no defined motif cleared its threshold. Consider adding a MOTIF_DEFINITIONS entry (+ MotifType enum value) for this combination.`
      }
    };
  }

  return { score: 0, detectedTokens, isNovel: false };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
