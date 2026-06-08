/**
 * Shared safety constants for the Director Agent. Kept identical to the Asset Manager's
 * SAFE_NEGATIVE_PROMPT (missingMaterialBriefBuilder.ts) so synthesized fallback prompts and
 * transition frame-bridge job cards carry the same guardrails as ②'s briefs.
 */
export const SAFE_NEGATIVE_PROMPT = [
  'no text overlays',
  'no watermark',
  'no celebrity',
  'no other brands',
  'no price promotion',
  'no medical claims',
  'do not alter the product packaging or label',
  'avoid copying the source video composition exactly'
].join(', ');

export const DEFAULT_ASPECT_RATIO = '9:16' as const;

/** Default share of transitions that should run as hyperframes (decision 2 / §7). */
export const DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT = 0.8;
