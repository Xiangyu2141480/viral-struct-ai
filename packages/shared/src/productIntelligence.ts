import { z } from 'zod';
import { TargetDurationModeSchema } from './orchestratedTimeline';

/**
 * Product Intelligence (P0-A) — the target-product semantic anchor.
 *
 * This is NOT a brief parser. It is a traceable, evidence-bearing understanding layer for the TARGET
 * product: how complex it is, what kind of proof it persuades with, what sensory/usage/social material
 * it needs, and which claims are forbidden. Every fact carries its evidence source + confidence so it can
 * both drive downstream modules (structural compression, prompt context, duration选档) and serve as a
 * reviewer evidence chain.
 *
 * Authoritative input = the user's text brief; assets corroborate; the LLM's world knowledge fills the
 * rest. See docs/product-intelligence-optimization-plan.md §3 (P0-A).
 */

export const ProductComplexitySchema = z.enum([
  'low_complexity_impulse_product',
  'medium_complexity_lifestyle_product',
  'high_complexity_feature_product'
]);
export type ProductComplexity = z.infer<typeof ProductComplexitySchema>;

export const ProofRegimeSchema = z.enum(['search', 'experience', 'credence', 'hybrid']);
export type ProofRegime = z.infer<typeof ProofRegimeSchema>;

export const ProofTypeSchema = z.enum([
  'feature_proof',
  'usage_proof',
  'sensory_proof',
  'social_proof',
  'comparison_proof',
  'trust_proof',
  'claim_proof'
]);
export type ProofType = z.infer<typeof ProofTypeSchema>;

export const ClaimRiskSchema = z.enum([
  'performance_exaggeration',
  'health_or_medical',
  'absolute_superlative',
  'price_or_offer_inconsistency',
  'before_after',
  'ip_or_brand_confusion'
]);
export type ClaimRisk = z.infer<typeof ClaimRiskSchema>;

export const EvidenceSourceSchema = z.enum([
  'user_description',
  'asset_evidence',
  'llm_inference',
  'manual_override'
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceSpanSchema = z
  .object({
    source: EvidenceSourceSchema,
    text: z.string(),
    confidence: z.number().min(0).max(1)
  })
  .strict();
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;

export const ProductFactSchema = z
  .object({
    value: z.string(),
    evidence: z.array(EvidenceSpanSchema),
    confidence: z.number().min(0).max(1)
  })
  .strict();
export type ProductFact = z.infer<typeof ProductFactSchema>;

export const ClaimBoundarySchema = z
  .object({
    risk: ClaimRiskSchema,
    rule: z.string(),
    examplesDisallowed: z.array(z.string()).optional(),
    evidence: z.array(EvidenceSpanSchema)
  })
  .strict();
export type ClaimBoundary = z.infer<typeof ClaimBoundarySchema>;

export const TargetDurationRecommendationSchema = z
  .object({
    preferred: TargetDurationModeSchema,
    alternatives: z.array(TargetDurationModeSchema),
    reason: z.string()
  })
  .strict();
export type TargetDurationRecommendation = z.infer<typeof TargetDurationRecommendationSchema>;

export const ProductIntelligenceSchema = z
  .object({
    productName: z.string(),
    category: ProductFactSchema,
    complexity: ProductComplexitySchema,
    proofRegime: ProofRegimeSchema,
    /** What the product fundamentally promises (drives benefit/sensory beats). */
    coreBenefits: z.array(ProductFactSchema),
    /** The real, filmable use sequence (drives ritual/usage beats + reshoot briefs). */
    usageRituals: z.array(ProductFactSchema),
    /** Multisensory cues (drives sensory_cascade target-equivalents + aigc prompts). */
    sensoryCues: z.array(ProductFactSchema),
    /** Where/with whom it is consumed (drives social_scene beats). */
    socialContexts: z.array(ProductFactSchema),
    /** How this product persuades — selects target-equivalent families in compression. */
    recommendedProofTypes: z.array(ProofTypeSchema),
    /** Compliance boundaries, generated UP FRONT and fed into every prompt as a negative constraint. */
    forbiddenClaims: z.array(ClaimBoundarySchema),
    targetDurationRecommendation: TargetDurationRecommendationSchema,
    analysisSource: z.enum(['llm', 'deterministic'])
  })
  .strict();
export type ProductIntelligence = z.infer<typeof ProductIntelligenceSchema>;
