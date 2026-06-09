import { z } from 'zod';

/**
 * OrchestratedTimeline — the Director Agent's deliverable.
 *
 * Three-role boundary (team decision): Asset Manager produces AssetCards + supply evidence;
 * the **Director Agent** matches assets per slot, proposes gap-fill options, and orchestrates
 * transitions into this timeline; the Video Agent executes/renders it. This contract is the
 * handoff between Director Agent and Video Agent.
 *
 * Hard boundary (encoded + asserted): `meta.planOnly === true`. The Director Agent never calls an
 * external generation model, never renders an MP4, and never produces audio. AIGC options are
 * **job cards only** (`ownership: 'external_generation_job_card_only'`). The deliverable is a
 * *timeline*, not a rendered product — rendering is the Video Agent's job, performed separately.
 *
 * Zod is the single source of truth; the TS types are derived (mirrors authoredComposition.ts).
 */

export const OrchestratedAspectRatioSchema = z.enum(['9:16', '16:9', '1:1']);
export type OrchestratedAspectRatio = z.infer<typeof OrchestratedAspectRatioSchema>;

export const OrchestratedRenderProfileSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    aspectRatio: OrchestratedAspectRatioSchema
  })
  .strict();
export type OrchestratedRenderProfile = z.infer<typeof OrchestratedRenderProfileSchema>;

// ---- Treatment spec (mirrors slotMatcher's SlotTreatmentSpec; kept local to avoid a cross-file dep) ----

export const OrchestratedTreatmentSpecSchema = z
  .object({
    motion: z.string().optional(),
    durationMs: z.number().optional(),
    syncPoint: z.string().optional(),
    captionOverlay: z.string().optional()
  })
  .strict();
export type OrchestratedTreatmentSpec = z.infer<typeof OrchestratedTreatmentSpecSchema>;

// ---- Gap-resolution options (asset-preserving options for partial slots; AIGC only for true gaps) ----

/** Reshoot: a natural-language shooting brief for the user. Highest fidelity, but needs a human. */
export const ReshootOptionSchema = z
  .object({
    id: z.literal('reshoot'),
    title: z.string(),
    guidanceNL: z.string(),
    framing: z.string(),
    durationSec: z.number().positive(),
    mustCapture: z.array(z.string()),
    avoid: z.array(z.string())
  })
  .strict();
export type ReshootOption = z.infer<typeof ReshootOptionSchema>;

/** Hyperframes: a natural-language editing brief the Video Agent can execute from existing assets. */
export const HyperframesOptionSchema = z
  .object({
    id: z.literal('hyperframes'),
    title: z.string(),
    editingGuidanceNL: z.string(),
    cardType: z.string().optional(),
    copy: z
      .object({
        headline: z.string().optional(),
        subline: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        cta: z.string().optional()
      })
      .strict()
      .optional(),
    referencedAssetIds: z.array(z.string()),
    durationMs: z.number().positive()
  })
  .strict();
export type HyperframesOption = z.infer<typeof HyperframesOptionSchema>;

/** AIGC: a generation prompt as a job card only — Director never submits it. */
export const AigcOptionSchema = z
  .object({
    id: z.literal('aigc'),
    prompt: z.string(),
    negativePrompt: z.string(),
    referenceAssetIds: z.array(z.string()),
    aspectRatio: OrchestratedAspectRatioSchema,
    expectedDurationSec: z.number().positive(),
    providerHint: z.enum(['seedance', 'gemini', 'generic']),
    ownership: z.literal('external_generation_job_card_only')
  })
  .strict();
export type AigcOption = z.infer<typeof AigcOptionSchema>;

export const GapResolutionOptionSchema = z.discriminatedUnion('id', [
  ReshootOptionSchema,
  HyperframesOptionSchema,
  AigcOptionSchema
]);
export type GapResolutionOption = z.infer<typeof GapResolutionOptionSchema>;

export const GapResolutionOptionIdSchema = z.enum(['reshoot', 'hyperframes', 'aigc']);
export type GapResolutionOptionId = z.infer<typeof GapResolutionOptionIdSchema>;

export const DirectorFillStatusSchema = z.enum([
  'matched',
  'partial_asset_support',
  'needs_hyperframes_enhancement',
  'source_specific_not_transferable',
  'missing_generation_required'
]);
export type DirectorFillStatus = z.infer<typeof DirectorFillStatusSchema>;

export const SourceSpecificTransferSubtypeSchema = z.enum([
  'opening_transform',
  'interface_detail',
  'assembly_detail',
  'ui_sequence',
  'device_handoff',
  'cta_lockup',
  'kinetic_assembly_reveal',
  'generic_source_specific'
]);
export type SourceSpecificTransferSubtype = z.infer<typeof SourceSpecificTransferSubtypeSchema>;

export const SourceAbstractionSchema = z
  .object({
    sourceSpecific: z.boolean(),
    subtype: SourceSpecificTransferSubtypeSchema,
    sourcePattern: z.string(),
    abstractGrammar: z.string(),
    targetEquivalentLabel: z.string(),
    targetEquivalentActions: z.array(z.string()),
    rationale: z.string()
  })
  .strict();
export type SourceAbstraction = z.infer<typeof SourceAbstractionSchema>;

// ---- Per-slot evidence (旁证 from coverage; matching verdict is owned by the LLM/rule matcher) ----

export const OrchestratedSlotEvidenceSchema = z
  .object({
    coverageStatus: z.enum(['covered', 'weak', 'insufficient']).optional(),
    matchedIngredients: z.array(z.string()),
    missingIngredients: z.array(z.string()),
    blockingReasons: z.array(z.string())
  })
  .strict();
export type OrchestratedSlotEvidence = z.infer<typeof OrchestratedSlotEvidenceSchema>;

// ---- Slot fill (matched | gap) ----

export const SlotFillMatchedSchema = z
  .object({
    kind: z.literal('matched'),
    assetId: z.string(),
    matchQuality: z.number().min(0).max(1),
    matchedCriteria: z.array(z.string()),
    missingCriteria: z.array(z.string()).optional(),
    treatmentSpec: OrchestratedTreatmentSpecSchema.optional(),
    status: z.enum(['matched', 'partial']),
    videoEngineInstruction: z.string(),
    /** partial slots carry asset-preserving options; true gaps may also carry an AIGC job card. */
    options: z.array(GapResolutionOptionSchema).optional(),
    recommendedOptionId: GapResolutionOptionIdSchema.optional(),
    evidence: OrchestratedSlotEvidenceSchema
  })
  .strict();
export type SlotFillMatched = z.infer<typeof SlotFillMatchedSchema>;

export const SlotFillGapSchema = z
  .object({
    kind: z.literal('gap'),
    reason: z.string(),
    missing: z.string(),
    recommendedOptionId: GapResolutionOptionIdSchema,
    options: z.array(GapResolutionOptionSchema),
    videoEngineInstruction: z.string(),
    evidence: OrchestratedSlotEvidenceSchema
  })
  .strict();
export type SlotFillGap = z.infer<typeof SlotFillGapSchema>;

export const SlotFillSchema = z.discriminatedUnion('kind', [SlotFillMatchedSchema, SlotFillGapSchema]);
export type SlotFill = z.infer<typeof SlotFillSchema>;

// ---- Structural compression beat (P0-B): one functional beat re-budgeted from ≥1 source slots ----

export const StructuralCompressionDecisionSchema = z.enum(['keep', 'compress', 'merge', 'replace', 'drop']);
export type StructuralCompressionDecision = z.infer<typeof StructuralCompressionDecisionSchema>;

export const PreservedStructureFunctionSchema = z.enum([
  'attention_hook',
  'context_setup',
  'product_reveal',
  'feature_or_benefit_proof',
  'usage_or_ritual',
  'social_or_trust_proof',
  'emotional_payoff',
  'cta_lockup'
]);
export type PreservedStructureFunction = z.infer<typeof PreservedStructureFunctionSchema>;

export const TargetEquivalentFamilySchema = z.enum([
  'sensory_cascade',
  'ritual_activation',
  'feature_demo',
  'benefit_proof',
  'social_scene',
  'trust_scene',
  'burst_payoff',
  'cta_lockup'
]);
export type TargetEquivalentFamily = z.infer<typeof TargetEquivalentFamilySchema>;

export const StructuralCompressionBeatSchema = z
  .object({
    beatId: z.string(),
    /** What structural job this beat preserves from the source arc (function, not surface content). */
    preservedStructureFunction: PreservedStructureFunctionSchema,
    /** The source functional family this beat came from (e.g. selling_point/usage). */
    sourceFunctionFamily: z.string(),
    /** The target-category equivalent the beat should be expressed as. */
    targetEquivalentFamily: TargetEquivalentFamilySchema,
    /** Neutral NL describing what the target beat should achieve (feeds prompt context). */
    targetEquivalentBeat: z.string(),
    compressionDecision: StructuralCompressionDecisionSchema,
    compressionReason: z.string(),
    proofType: z.string().optional(),
    /** Source segments/slots merged into this single target beat (provenance). */
    mergedSourceSegmentIds: z.array(z.string()),
    mergedSourceSlotIds: z.array(z.string())
  })
  .strict();
export type StructuralCompressionBeat = z.infer<typeof StructuralCompressionBeatSchema>;

// ---- Orchestrated slot (one per shotSlot, in time order) ----

export const OrchestratedSlotSchema = z
  .object({
    slotId: z.string(),
    segmentId: z.string().optional(),
    /** ShotSlotRole, or a free-form role for non-standard graphs. */
    role: z.string(),
    index: z.number().int().min(0),
    startMs: z.number().min(0),
    endMs: z.number().min(0),
    sourceStartMs: z.number().min(0).optional(),
    sourceEndMs: z.number().min(0).optional(),
    targetStartMs: z.number().min(0).optional(),
    targetEndMs: z.number().min(0).optional(),
    fillStatus: DirectorFillStatusSchema.optional(),
    sourceIntent: z.string().optional(),
    /** transferable intent — already sanitized to prevent source-video leakage into target prompts. */
    transferableIntent: z.string().optional(),
    sourceAbstraction: SourceAbstractionSchema.optional(),
    motifType: z.string().optional(),
    motionTokens: z.array(z.string()).optional(),
    /** P0-B: present when this slot is a re-budgeted functional beat (≥1 source slots merged). */
    compressionBeat: StructuralCompressionBeatSchema.optional(),
    fill: SlotFillSchema
  })
  .strict()
  .superRefine((slot, ctx) => {
    if (slot.endMs <= slot.startMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `slot ${slot.slotId}: endMs must be greater than startMs` });
    }
  });
export type OrchestratedSlot = z.infer<typeof OrchestratedSlotSchema>;

// ---- Transitions (one per adjacent slot pair) ----

export const OrchestratedTransitionModeSchema = z.enum([
  'cut',
  'match_cut',
  'graphic_match',
  'eyeline_bridge',
  'object_wipe',
  'motion_bridge',
  'split_edit_j_cut',
  'split_edit_l_cut',
  'card_animation',
  'particle_bridge',
  'hyperframes',
  'aigc_job_card',
  // Legacy mode kept for older fixtures and handoff consumers.
  'aigc_frame_bridge'
]);
export type OrchestratedTransitionMode = z.infer<typeof OrchestratedTransitionModeSchema>;

export const TransitionAssetSupportSchema = z
  .object({
    status: z.enum(['covered', 'partial', 'gap', 'reference_only']),
    supportedByAssetIds: z.array(z.string()),
    requiredEvidence: z.array(z.string()),
    matchedEvidence: z.array(z.string()),
    missingEvidence: z.array(z.string()),
    missingTransitionAssets: z.array(z.string()),
    reuseFirst: z.boolean()
  })
  .strict();
export type TransitionAssetSupport = z.infer<typeof TransitionAssetSupportSchema>;

export const TransitionSafetyResultSchema = z
  .object({
    passed: z.boolean(),
    sourceLeakageRisk: z.enum(['none', 'needs_rewrite', 'blocked']),
    ipRisk: z.enum(['none', 'needs_review', 'blocked']),
    claimRisk: z.enum(['none', 'needs_review', 'blocked']),
    policyFlags: z.array(z.string()),
    requiredRewrites: z.array(z.string())
  })
  .strict();
export type TransitionSafetyResult = z.infer<typeof TransitionSafetyResultSchema>;

export const TransitionWhyNotSchema = z
  .object({
    mode: OrchestratedTransitionModeSchema,
    reason: z.string()
  })
  .strict();
export type TransitionWhyNot = z.infer<typeof TransitionWhyNotSchema>;

export const TransitionLlmEnhancementSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.string().optional(),
    model: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    semanticBridgeText: z.string().optional(),
    compactPrompt: z.string().optional(),
    rewrittenCategoryNativeEquivalent: z.string().optional(),
    audioCueText: z.string().optional(),
    failedReason: z.string().optional()
  })
  .strict();
export type TransitionLlmEnhancement = z.infer<typeof TransitionLlmEnhancementSchema>;

export const TransitionAigcJobCardSchema = z
  .object({
    id: z.string(),
    providerHint: z.enum(['seedance', 'gemini', 'generic']),
    prompt: z.string(),
    negativePrompt: z.string(),
    referenceAssetIds: z.array(z.string()),
    ownership: z.literal('external_generation_job_card_only'),
    planOnly: z.literal(true)
  })
  .strict();
export type TransitionAigcJobCard = z.infer<typeof TransitionAigcJobCardSchema>;

export const OrchestratedTransitionSchema = z
  .object({
    id: z.string(),
    fromSlotId: z.string(),
    toSlotId: z.string(),
    mode: OrchestratedTransitionModeSchema,
    implementationMode: OrchestratedTransitionModeSchema.optional(),
    transitionType: OrchestratedTransitionModeSchema.optional(),
    transitionFunction: z.string().optional(),
    preferredImplementation: z.enum(['hyperframes', 'video_engine', 'external_generation']),
    reason: z.string(),
    semanticBridgeExplanation: z.string().optional(),
    visualAction: z.string().optional(),
    assetSupport: TransitionAssetSupportSchema.optional(),
    missingTransitionAssets: z.array(z.string()).optional(),
    fallbackStrategy: z.string().optional(),
    hyperframesGuidance: z.string().optional(),
    optionalAigcJobCardId: z.string().optional(),
    optionalAIGCJobCard: TransitionAigcJobCardSchema.optional(),
    audioCueHandoff: z.string().optional(),
    safetyResult: TransitionSafetyResultSchema.optional(),
    llmEnhancement: TransitionLlmEnhancementSchema.nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
    whyThisMode: z.string().optional(),
    whyNot: z.array(TransitionWhyNotSchema).optional(),
    hyperframes: z
      .object({
        editingGuidanceNL: z.string(),
        durationMs: z.number().positive(),
        styleTokens: z.array(z.string())
      })
      .strict()
      .optional(),
    aigcFrameBridge: z
      .object({
        fromTailFrameRef: z.string().optional(),
        toHeadFrameRef: z.string().optional(),
        prompt: z.string(),
        negativePrompt: z.string(),
        durationMs: z.number().positive(),
        ownership: z.literal('external_generation_job_card_only')
      })
      .strict()
      .optional(),
    requiredAssets: z.array(z.string()),
    missingAssets: z.array(z.string()),
    riskNotes: z.array(z.string())
  })
  .strict();
export type OrchestratedTransition = z.infer<typeof OrchestratedTransitionSchema>;

// ---- Reusable asset packs (Director handoff for Video Agent / human shooting / external job cards) ----

export const ReusableAssetPackTypeSchema = z.enum([
  'product_hero_reveal',
  'product_closeup',
  'usage_demo',
  'cap_open_usage',
  'pour_or_drink_usage',
  'cold_condensation_macro',
  'cold_refresh_proof',
  'motif_assembly_reveal',
  'transition_pack',
  'transition_ice_lemon_pack',
  'cta_lockup',
  'lineup_social_proof'
]);
export type ReusableAssetPackType = z.infer<typeof ReusableAssetPackTypeSchema>;

export const ReusableAssetPackPlanSchema = z
  .object({
    id: z.string(),
    packType: ReusableAssetPackTypeSchema,
    title: z.string(),
    status: z.enum(['required', 'optional']),
    recommendedChannel: z.enum(['reshoot', 'hyperframes', 'aigc']),
    promptSummary: z.string(),
    targetSlots: z.array(z.string()),
    referencedAssetIds: z.array(z.string()),
    ownership: z.literal('director_handoff_plan_only')
  })
  .strict();
export type ReusableAssetPackPlan = z.infer<typeof ReusableAssetPackPlanSchema>;

// ---- Top-level timeline ----

export const TargetDurationModeSchema = z.enum(['source_preserve', 'high_click_15s', 'high_conversion_20s', 'full_story_30s']);
export type TargetDurationMode = z.infer<typeof TargetDurationModeSchema>;

export const OrchestratedTimelineMetaSchema = z
  .object({
    productName: z.string().optional(),
    targetCategory: z.string().optional(),
    matchSource: z.enum(['llm_judge', 'rule_based', 'mixed']),
    generatedAt: z.string(),
    sourceDurationMs: z.number().min(0).optional(),
    targetDurationMs: z.number().min(0).optional(),
    targetDurationMode: TargetDurationModeSchema.optional(),
    /** Hard boundary: the Director Agent only plans; it never renders or calls external models. */
    planOnly: z.literal(true)
  })
  .strict();
export type OrchestratedTimelineMeta = z.infer<typeof OrchestratedTimelineMetaSchema>;

export const OrchestratedTimelineSchema = z
  .object({
    schemaVersion: z.literal('orchestrated-v1'),
    projectId: z.string(),
    renderProfile: OrchestratedRenderProfileSchema,
    slots: z.array(OrchestratedSlotSchema),
    transitions: z.array(OrchestratedTransitionSchema),
    reusableAssetPacks: z.array(ReusableAssetPackPlanSchema).optional(),
    meta: OrchestratedTimelineMetaSchema,
    warnings: z.array(z.string())
  })
  .strict()
  .superRefine((timeline, ctx) => {
    const expectedTransitions = Math.max(0, timeline.slots.length - 1);
    if (timeline.transitions.length !== expectedTransitions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `transitions length (${timeline.transitions.length}) must equal slots.length - 1 (${expectedTransitions})`
      });
    }
  });
export type OrchestratedTimeline = z.infer<typeof OrchestratedTimelineSchema>;
