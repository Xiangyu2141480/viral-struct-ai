import { z } from 'zod';

export const SegmentRoleSchema = z.enum([
  'hook',
  'pain_point',
  'selling_point',
  'proof',
  'usage',
  'comparison',
  'cta',
  // instructional roles (course/tutorial genre)
  'explanation',
  'demonstration',
  'technique_step',
  'context'
]);

export const ShotSlotRoleSchema = z.enum([
  'opening_attention',
  'product_closeup',
  'usage_demo',
  'benefit_visual',
  'comparison',
  'testimonial',
  'cta_visual',
  // instructional slot roles (course/tutorial genre)
  'instruction_card',
  'example_clip',
  'technique_demo'
]);

export const GapRepairStrategySchema = z.enum([
  'structure_reorder',
  'caption_rewrite',
  'text_card',
  'selling_point_card',
  'comparison_card',
  'cta_card',
  'crop_zoom',
  'reuse_asset',
  'aigc_background',
  'aigc_voiceover',
  'hand_demo',
  'product_closeup_replacement',
  'texture_card',
  'swatch_card',
  'before_after_card',
  'trust_card',
  'style_filter_suggestion',
  'ask_user_for_human_demo'
]);

export const CreativeIngredientTypeSchema = z.enum([
  'human_presence',
  'face_closeup',
  'host_talking',
  'hand_demo',
  'beauty_demo',
  'makeup_application',
  'skin_texture_display',
  'before_after_comparison',
  'product_closeup_trait',
  'texture_display',
  'swatch_demo',
  'scene_style',
  'soft_light',
  'clean_background',
  'premium_visual',
  'trust_building',
  'social_proof',
  'professional_review',
  'lifestyle_context',
  'unknown'
]);

export const IngredientTransferabilitySchema = z.enum([
  'directly_transferable',
  'requires_user_asset',
  'can_be_recreated_by_packaging',
  'can_be_replaced_by_repair',
  'not_transferable'
]);

export const HumanRoleSchema = z.enum(['host', 'model', 'user', 'hand_only', 'none']);
export const AssetHumanRoleSchema = z.enum(['host', 'model', 'user', 'hand_only', 'unknown']);
export const HumanFramingSchema = z.enum([
  'face_closeup',
  'half_body',
  'full_body',
  'hands',
  'skin_macro',
  'product_only'
]);
export const HumanActionSchema = z.enum([
  'talking',
  'applying_product',
  'showing_result',
  'swatching',
  'holding_product',
  'none'
]);
export const AssetHumanActionSchema = z.enum([
  'talking',
  'applying_product',
  'showing_result',
  'swatching',
  'holding_product'
]);
export const VisualStyleTagSchema = z.enum([
  'soft_light',
  'clean_background',
  'premium_visual',
  'lifestyle_context',
  'beauty_style',
  'professional_review'
]);

export const CreativeIngredientSchema = z.object({
  id: z.string(),
  type: CreativeIngredientTypeSchema,
  name: z.string(),
  description: z.string(),
  segmentIds: z.array(z.string()),
  requiredForSlotIds: z.array(z.string()),
  transferability: IngredientTransferabilitySchema,
  requiredAssets: z.array(z.string()).optional(),
  fallbackStrategies: z.array(GapRepairStrategySchema),
  evidence: z.array(z.object({
    type: z.enum(['frame', 'timestamp', 'transcript', 'model_observation']),
    value: z.string()
  })),
  confidence: z.number().min(0).max(1)
});

export const MaterialGapTypeSchema = z.enum([
  'missing_opening_visual',
  'missing_product_closeup',
  'missing_usage_demo',
  'missing_comparison',
  'missing_cta_visual',
  'missing_human_host',
  'missing_face_closeup',
  'missing_usage_action',
  'missing_beauty_demo',
  'missing_before_after',
  'missing_trust_element',
  'missing_scene_style',
  'missing_visual_ingredient'
]);

export const ContentBriefSchema = z.object({
  productName: z.string().min(1),
  targetAudience: z.string().min(1),
  scenario: z.string().min(1),
  sellingPoints: z.array(z.string().min(1)).min(1),
  cta: z.string().min(1),
  stylePreference: z.string().optional(),
  /**
   * Target product category for motif transfer (decision D2). User-supplied and
   * authoritative; when omitted it is inferred from productName via
   * normalizeCategory at parse time. Free-form so any category alias is accepted.
   */
  category: z.string().min(1).optional()
});

export const AssetVisualContentSchema = z.object({
  primarySubject: z.string(),
  subjectPosition: z.string(),
  negativeSpace: z.string().optional(),
  kinematicElements: z.array(z.string()),
  lighting: z.string().optional(),
  colorPalette: z.array(z.string()).optional()
});

export const AssetMotionPotentialSchema = z.object({
  isStill: z.boolean(),
  implicitMotion: z.enum(['low', 'medium', 'high']),
  canSimulateMotion: z.array(z.string()).optional(),
  canSimulateDurationMs: z.tuple([z.number(), z.number()]).optional()
});

export const AssetCandidateSlotRoleSchema = z.object({
  role: ShotSlotRoleSchema,
  confidence: z.number().min(0).max(1),
  caveat: z.string().optional()
});

export const AssetManagerRoleSchema = z.enum([
  'opening_hook',
  'product_closeup',
  'usage_demo',
  'comparison',
  'benefit_proof',
  'lifestyle_scene',
  'background',
  'packaging_card',
  'cta',
  'cover'
]);

export const RoleAffordanceComponentsSchema = z.object({
  semanticFit: z.number().min(0).max(100),
  visualSignalFit: z.number().min(0).max(100),
  productVisibilityFit: z.number().min(0).max(100),
  qualityFit: z.number().min(0).max(100),
  formatFit: z.number().min(0).max(100),
  editabilityFit: z.number().min(0).max(100),
  safetyFit: z.number().min(0).max(100)
});

export const RoleAffordanceScoreSchema = z.object({
  role: AssetManagerRoleSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).optional(),
  components: RoleAffordanceComponentsSchema,
  rationale: z.string(),
  reasons: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional()
});

export const AssetRoleSchema = z.union([
  AssetManagerRoleSchema,
  ShotSlotRoleSchema,
  z.enum(['title_card', 'text_brief', 'unknown'])
]);

export const AssetKeyframeSchema = z.object({
  id: z.string(),
  timeSec: z.number().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
  source: z.enum(['uploaded_video', 'sampled_frame', 'placeholder', 'manual'])
});

export const AssetMediaProfileSchema = z.object({
  kind: z.enum(['image', 'video', 'text']),
  sourceUrl: z.string().optional(),
  textLength: z.number().int().min(0).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  format: z.string().optional(),
  durationSec: z.number().min(0).optional(),
  fps: z.number().min(0).optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', 'unknown']).optional(),
  keyframes: z.array(AssetKeyframeSchema),
  hasAudio: z.boolean().optional(),
  fileExtension: z.string().optional()
});

export const AssetSemanticProfileSchema = z.object({
  summary: z.string(),
  detectedObjects: z.array(z.string()),
  detectedIngredients: z.array(CreativeIngredientTypeSchema),
  visualStyleTags: z.array(VisualStyleTagSchema),
  humanPresence: z.object({
    hasHuman: z.boolean(),
    role: AssetHumanRoleSchema.optional(),
    framing: z.array(HumanFramingSchema).optional(),
    actions: z.array(AssetHumanActionSchema).optional()
  }).optional(),
  visualContent: AssetVisualContentSchema.optional(),
  motionPotential: AssetMotionPotentialSchema.optional()
});

export const AssetIssueSchema = z.object({
  type: z.enum([
    'missing_metadata',
    'low_quality',
    'low_resolution',
    'no_motion_evidence',
    'unsafe_claim',
    'unknown'
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  message: z.string()
});

export const AssetQualityProfileSchema = z.object({
  overallScore: z.number().min(0).max(1),
  resolution: z.number().min(0).max(1),
  sharpness: z.number().min(0).max(1),
  brightness: z.number().min(0).max(1),
  contrast: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  composition: z.number().min(0).max(1),
  lighting: z.number().min(0).max(1),
  subjectProminence: z.number().min(0).max(1),
  productFocus: z.number().min(0).max(1),
  textSafeArea: z.number().min(0).max(1),
  formatFit: z.number().min(0).max(1).optional(),
  issues: z.array(AssetIssueSchema)
});

export const SlotAffordanceProfileSchema = z.object({
  suitableSlots: z.array(ShotSlotRoleSchema),
  primaryRoles: z.array(z.object({
    role: ShotSlotRoleSchema,
    confidence: z.number().min(0).max(1),
    caveat: z.string().optional()
  })),
  missingRoles: z.array(ShotSlotRoleSchema),
  rationale: z.string()
});

export const AssetEditabilityProfileSchema = z.object({
  canCropZoom: z.boolean(),
  canUseAsBackground: z.boolean(),
  canLoop: z.boolean(),
  canExtendWithCards: z.boolean(),
  suggestedEdits: z.array(z.string())
});

export const AssetSafetyProfileSchema = z.object({
  status: z.enum(['passed', 'needs_review', 'blocked']),
  brandRisk: z.enum(['low', 'medium', 'high']),
  ipRisk: z.enum(['low', 'medium', 'high']),
  claimRisk: z.enum(['low', 'medium', 'high']),
  reasons: z.array(z.string())
});

export const AssetSearchProfileSchema = z.object({
  tags: z.array(z.string()),
  keywords: z.array(z.string()),
  embeddingText: z.string()
});

export const AssetVlmAnalysisProfileSchema = z.object({
  source: z.literal('optional_vlm'),
  provider: z.literal('openai_compatible'),
  model: z.string(),
  analyzedAt: z.string(),
  shortCaption: z.string(),
  sceneType: z.string(),
  productVisible: z.boolean(),
  productVisibilityScore: z.number().min(0).max(100),
  detectedObjects: z.array(z.string()),
  textVisible: z.boolean(),
  suggestedRoles: z.array(AssetManagerRoleSchema),
  rationale: z.string(),
  risks: z.array(z.string())
});

export const AssetAnalysisSourceSchema = z.enum([
  'static_library',
  'mock_filename_rules',
  'llm_multimodal',
  'manual_text_brief',
  'deterministic',
  'generated_external',
  'planned_generation',
  'aigc'
]);

export const AssetAnalysisProfileSchema = z.object({
  profileVersion: z.literal('asset_analysis_v1'),
  analyzedAt: z.string(),
  source: AssetAnalysisSourceSchema.optional(),
  fallbackUsed: z.boolean(),
  warnings: z.array(z.string()),
  media: AssetMediaProfileSchema,
  semantic: AssetSemanticProfileSchema,
  quality: AssetQualityProfileSchema,
  slotAffordance: SlotAffordanceProfileSchema,
  editability: AssetEditabilityProfileSchema,
  safety: AssetSafetyProfileSchema,
  search: AssetSearchProfileSchema,
  roleAffordance: z.array(RoleAffordanceScoreSchema).optional(),
  vlm: AssetVlmAnalysisProfileSchema.optional()
});

export const AssetCardSchema = z.object({
  id: z.string(),
  type: z.enum(['image', 'video', 'text']),
  url: z.string().optional(),
  text: z.string().optional(),
  spatialDescription: z.string().optional(),
  temporalDescription: z.string().optional(),
  detectedObjects: z.array(z.string()),
  suitableSlots: z.array(ShotSlotRoleSchema),
  qualityScore: z.number().min(0).max(1),
  detectedIngredients: z.array(CreativeIngredientTypeSchema).optional(),
  humanPresence: z.object({
    hasHuman: z.boolean(),
    role: AssetHumanRoleSchema.optional(),
    framing: z.array(HumanFramingSchema).optional(),
    actions: z.array(AssetHumanActionSchema).optional()
  }).optional(),
  visualStyleTags: z.array(VisualStyleTagSchema).optional(),
  visualContent: AssetVisualContentSchema.optional(),
  motionPotential: AssetMotionPotentialSchema.optional(),
  candidateSlotRoles: z.array(AssetCandidateSlotRoleSchema).optional(),
  analysisSource: AssetAnalysisSourceSchema.optional(),
  analysis: AssetAnalysisProfileSchema.optional()
});

export const TransitionGrammarIdSchema = z.enum([
  'dynamic_entry',
  'impact_beat',
  'assembly_reveal',
  'activation_moment',
  'lockup_transition'
]);

export const TargetTransitionEquivalentSchema = z.enum([
  'ice_cube_drop',
  'open_cap',
  'pour_to_cup',
  'drink_neck_down',
  'bottle_rotation',
  'lineup_sweep',
  'clean_cta_end_frame',
  'hyperframes_benefit_card_drop'
]);

export const TransitionIngredientSchema = z.object({
  id: z.string(),
  grammarId: TransitionGrammarIdSchema,
  label: z.string(),
  sourcePattern: z.string(),
  targetEquivalent: TargetTransitionEquivalentSchema,
  requiredEvidence: z.array(z.string()),
  acceptableAssetRoles: z.array(AssetManagerRoleSchema),
  avoidCopyingSource: z.array(z.string())
});

export const TransitionNeedSchema = z.object({
  id: z.string(),
  grammarId: TransitionGrammarIdSchema,
  sourceMotif: z.string(),
  transferableIntent: z.string(),
  targetEquivalent: TargetTransitionEquivalentSchema,
  targetSlots: z.array(z.string()),
  importance: z.enum(['low', 'medium', 'high']),
  ingredients: z.array(TransitionIngredientSchema)
});

export const AssetTransitionAffordanceSchema = z.object({
  assetId: z.string(),
  supportsGrammar: z.array(TransitionGrammarIdSchema),
  supportedIngredients: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  limitations: z.array(z.string())
});

export const TransitionCoverageObservationSchema = z.object({
  id: z.string(),
  transitionNeedId: z.string(),
  grammarId: TransitionGrammarIdSchema,
  coverageStatus: z.enum(['covered', 'weak', 'insufficient']),
  candidateAssetIds: z.array(z.string()),
  missingIngredientIds: z.array(z.string()),
  potentialImpact: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  ownership: z.literal('asset_manager_transition_observation_only')
});

export const TransitionHandoffBriefSchema = z.object({
  id: z.string(),
  owner: z.enum(['video_agent', 'gap_repair', 'hyperframes', 'aigc', 'manual_shoot']),
  transitionNeedIds: z.array(z.string()),
  brief: z.string(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  safetyNotes: z.array(z.string()),
  notRenderedOutput: z.boolean()
});

export const TransitionMotionGrammarHandoffSchema = z.object({
  protocolVersion: z.literal('transition-handoff-v1'),
  patternId: z.literal('kinetic_assembly'),
  sourceExample: z.string(),
  targetProduct: z.string(),
  designLanguage: z.string(),
  boundary: z.array(z.string()),
  transitionNeeds: z.array(TransitionNeedSchema),
  assetAffordances: z.array(AssetTransitionAffordanceSchema),
  coverageObservations: z.array(TransitionCoverageObservationSchema),
  downstreamHandoff: z.array(TransitionHandoffBriefSchema),
  warnings: z.array(z.string())
});

export const MotifTypeSchema = z.enum([
  'surreal_assembly',
  'kinetic_assembly_reveal',
  'kinetic_product_reveal',
  'dynamic_entry',
  'impact_activation',
  'ingredient_transformation',
  'lineup_lockup',
  'benefit_card_motion',
  'category_usage_moment'
]);

export const MotionTokenSchema = z.enum([
  'dynamic_entry',
  'component_cascade',
  'chaos_to_order',
  'assembly_completion',
  'interaction_activation',
  'spectacle_burst',
  'cta_reveal',
  'falling_object',
  'impact_beat',
  'snap_open',
  'assembly_reveal',
  'activation_moment',
  'pour_flow',
  'drink_action',
  'bottle_rotation',
  'lineup_sweep',
  'card_drop',
  'clean_hold',
  'quick_cut',
  'push_in',
  'match_cut',
  'morph'
]);

export const TargetCategoryMotifMappingSchema = z.object({
  targetCategory: z.string(),
  preferredEquivalents: z.array(z.string()),
  rejectedEquivalents: z.array(z.string()),
  rationale: z.string()
}).strict();

export const MotifTransferVariableSchema = z.object({
  name: z.string(),
  sourceValue: z.string(),
  targetValue: z.string(),
  allowedTargetValues: z.array(z.string()),
  notes: z.string().optional()
}).strict();

export const ViralMotifAnnotationSchema = z.object({
  id: z.string(),
  slotId: z.string().optional(),
  segmentId: z.string().optional(),
  motifType: MotifTypeSchema,
  motionTokens: z.array(MotionTokenSchema),
  sanitizedIntent: z.string(),
  transferVariables: z.array(MotifTransferVariableSchema),
  bannedSourceTerms: z.array(z.string()),
  targetCategoryMapping: TargetCategoryMotifMappingSchema,
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(1)
}).strict();

export const MotifContextSchema = z.object({
  motifAnnotationId: z.string(),
  motifType: MotifTypeSchema,
  motionTokens: z.array(MotionTokenSchema),
  missingMotionTokens: z.array(MotionTokenSchema),
  sanitizedIntent: z.string(),
  targetMotifHints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string())
}).strict();

const MotifAwareBriefBaseSchema = z.object({
  id: z.string(),
  motifAnnotationId: z.string(),
  targetCategoryMapping: TargetCategoryMotifMappingSchema,
  sanitizedIntent: z.string(),
  bannedSourceTerms: z.array(z.string()),
  motionTokens: z.array(MotionTokenSchema),
  safetyNotes: z.array(z.string()),
  notRenderedOutput: z.boolean()
});

export const MotifAwareManualShootBriefSchema = MotifAwareBriefBaseSchema.extend({
  shotObjective: z.string(),
  requiredActions: z.array(z.string()),
  compositionNotes: z.array(z.string())
}).strict();

export const MotifAwareAigcPromptBriefSchema = MotifAwareBriefBaseSchema.extend({
  prompt: z.string(),
  negativePrompt: z.string()
}).strict();

export const MotifAwareHyperframesBriefSchema = MotifAwareBriefBaseSchema.extend({
  cardType: z.enum(['hook_card', 'benefit_card', 'comparison_card', 'cta_card', 'transition_card']),
  cardMotion: z.enum(['card_drop', 'slide_in', 'snap_cut', 'lineup_sweep', 'clean_hold']),
  copyIntent: z.string()
}).strict();

export const RoleCoverageSummarySchema = z.object({
  role: AssetManagerRoleSchema,
  status: z.enum(['covered', 'weak', 'missing']),
  bestAssetId: z.string().optional(),
  bestScore: z.number().min(0).max(100),
  assetIds: z.array(z.string())
});

export const SlotCandidateAssetSchema = z.object({
  assetId: z.string(),
  assetType: z.enum(['image', 'video', 'text']),
  score: z.number().min(0).max(100),
  roleAffordance: z.number().min(0).max(100),
  intentSemanticMatch: z.number().min(0).max(100),
  acceptanceCriteriaMatch: z.number().min(0).max(100),
  assetQuality: z.number().min(0).max(100),
  editabilityFit: z.number().min(0).max(100),
  rationale: z.string()
});

export const SlotCoverageRowSchema = z.object({
  slotId: z.string(),
  segmentId: z.string().optional(),
  slotRole: ShotSlotRoleSchema.optional(),
  mappedRole: AssetManagerRoleSchema,
  requiredAssetType: z.enum(['image', 'video', 'text', 'generated']).optional(),
  status: z.enum(['covered', 'weak', 'missing']),
  bestAssetId: z.string().optional(),
  bestScore: z.number().min(0).max(100),
  candidates: z.array(SlotCandidateAssetSchema),
  gapReason: z.string().optional()
});

export const AssetLibraryReportSchema = z.object({
  libraryId: z.string(),
  assetCount: z.number().int().min(0),
  byType: z.record(z.enum(['image', 'video', 'text']), z.number().int().min(0)),
  avgQualityScore: z.number().min(0).max(1),
  qualitySummary: z.object({
    avgQualityScore: z.number().min(0).max(1),
    lowQualityAssetIds: z.array(z.string()),
    warningCount: z.number().int().min(0)
  }).optional(),
  coveredSlots: z.array(ShotSlotRoleSchema),
  missingSlots: z.array(ShotSlotRoleSchema),
  roleCoverage: z.record(AssetManagerRoleSchema, RoleCoverageSummarySchema),
  missingRoles: z.array(AssetManagerRoleSchema),
  weakRoles: z.array(AssetManagerRoleSchema),
  topAssetsByRole: z.record(AssetManagerRoleSchema, z.array(SlotCandidateAssetSchema)),
  recommendations: z.array(z.string()),
  warnings: z.array(z.string()),
  generatedAt: z.string()
});

export const SlotCoverageMatrixSchema = z.object({
  slots: z.array(z.object({
    role: z.union([ShotSlotRoleSchema, AssetManagerRoleSchema]),
    slotId: z.string().optional(),
    mappedRole: AssetManagerRoleSchema.optional(),
    assetIds: z.array(z.string()),
    bestAssetId: z.string().optional(),
    bestScore: z.number().min(0).max(100),
    coverage: z.enum(['covered', 'weak', 'partial', 'missing']),
    candidates: z.array(SlotCandidateAssetSchema).optional()
  })),
  slotRows: z.array(SlotCoverageRowSchema),
  coveredSlotCount: z.number().int().min(0),
  totalSlotCount: z.number().int().min(0),
  coverageRatio: z.number().min(0).max(1)
});

export const AssetMatchEvidenceSchema = z.object({
  assetId: z.string(),
  qualityScore: z.number().min(0).max(1),
  topAffordanceRole: AssetManagerRoleSchema.optional(),
  topAffordanceScore: z.number().min(0).max(100).optional(),
  productVisibilityScore: z.number().min(0).max(100).optional(),
  keyframeIds: z.array(z.string()),
  keyframeCaptions: z.array(z.string()).optional(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string())
});

export const NormalizedAssetCardSchema = AssetCardSchema.extend({
  analysis: AssetAnalysisProfileSchema
});

export const AssetLibraryProfileSchema = AssetLibraryReportSchema;

export const MaterialScenarioTypeSchema = z.enum([
  'empty_assets',
  'single_image_only',
  'partial_real_footage',
  'aigc_ready',
  'mixed_real_and_aigc'
]);

export const MaterialScenarioProfileSchema = z.object({
  scenarioType: MaterialScenarioTypeSchema,
  assetCount: z.number().int().min(0),
  imageCount: z.number().int().min(0),
  videoCount: z.number().int().min(0),
  textCount: z.number().int().min(0),
  generatedAssetCount: z.number().int().min(0),
  realFootageCount: z.number().int().min(0),
  evidenceCoverageScore: z.number().min(0).max(100),
  completionFeasibilityScore: z.number().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendedDownstreamMode: z.enum([
    'structure_cards_only',
    'single_image_motion_reuse',
    'real_footage_editing',
    'aigc_missing_material_generation',
    'mixed_repair_workflow'
  ]),
  warnings: z.array(z.string())
});

export const RequiredIngredientKindSchema = z.enum([
  'visual_subject',
  'shot_type',
  'motion',
  'product_evidence',
  'usage_evidence',
  'comparison_evidence',
  'cta_surface',
  'text_safe_area',
  'duration',
  'aspect_ratio',
  'packaging_surface'
]);

export const RequiredIngredientSchema = z.object({
  id: z.string(),
  kind: RequiredIngredientKindSchema,
  label: z.string(),
  requiredBy: z.object({
    segmentId: z.string().optional(),
    slotId: z.string(),
    acceptanceCriteria: z.string().optional()
  }),
  importance: z.enum(['low', 'medium', 'high'])
});

export const AvailableIngredientSchema = z.object({
  requiredIngredientId: z.string(),
  assetId: z.string(),
  score: z.number().min(0).max(100),
  evidence: z.array(z.string())
});

export const MissingIngredientSchema = z.object({
  requiredIngredientId: z.string(),
  label: z.string(),
  reason: z.string(),
  evidence: z.array(z.string())
});

export const CoverageImpactSchema = z.object({
  type: z.enum([
    'hook_strength_reduced',
    'product_clarity_reduced',
    'usage_proof_missing',
    'comparison_weakened',
    'cta_clarity_reduced',
    'rhythm_disrupted',
    'packaging_overload_risk'
  ]),
  description: z.string(),
  affectedMetric: z.enum([
    'hookStrength',
    'slotCoverage',
    'visualScriptAlignment',
    'ctaClarity',
    'transitionFidelity'
  ]).optional(),
  severity: z.enum(['low', 'medium', 'high'])
});

export const SlotAssetUsableAsSchema = z.enum([
  'video_clip',
  'image_clip',
  'poster_frame',
  'background_plate',
  'overlay_support',
  'reference_only'
]);

export const SlotAssetCandidateSchema = z.object({
  assetId: z.string(),
  score: z.number().min(0).max(100),
  fitStatus: z.enum(['strong', 'usable', 'weak']),
  usableAs: SlotAssetUsableAsSchema,
  mediaReadiness: z.object({
    hasUsableUrl: z.boolean(),
    hasLocalPath: z.boolean(),
    hasThumbnail: z.boolean(),
    hasKeyframe: z.boolean(),
    hasDuration: z.boolean()
  }),
  constraints: z.object({
    maxRecommendedDurationSec: z.number().min(0).optional(),
    needsCrop: z.boolean().optional(),
    needsOverlaySupport: z.boolean().optional(),
    notEnoughForStandaloneShot: z.boolean().optional(),
    textSafeAreaRisk: z.boolean().optional()
  }),
  evidence: z.object({
    affordanceScore: z.number().min(0).max(100),
    qualityScore: z.number().min(0).max(100),
    semanticSignals: z.array(z.string()),
    keyframeIds: z.array(z.string()).optional(),
    reasons: z.array(z.string()),
    warnings: z.array(z.string())
  })
});

export const ContextualSlotCoverageSchema = z.object({
  slotId: z.string(),
  affectedSegmentId: z.string().optional(),
  slotRole: AssetRoleSchema,
  slotIntent: z.string(),
  sourceInstance: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  requiredIngredients: z.array(RequiredIngredientSchema),
  availableIngredients: z.array(AvailableIngredientSchema),
  missingIngredients: z.array(MissingIngredientSchema),
  weakIngredients: z.array(MissingIngredientSchema),
  candidateAssets: z.array(SlotAssetCandidateSchema),
  coverageStatus: z.enum(['covered', 'weak', 'insufficient']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(z.string()),
  limitations: z.array(z.string()),
  motifContext: MotifContextSchema.optional()
});

export const MaterialCoverageObservationSchema = z.object({
  id: z.string(),
  affectedSegmentId: z.string().optional(),
  affectedSlotId: z.string(),
  slotRole: AssetRoleSchema,
  slotIntent: z.string(),
  observationType: z.enum([
    'missing_required_ingredient',
    'weak_candidate_quality',
    'weak_semantic_fit',
    'format_mismatch',
    'duration_mismatch',
    'missing_motion_evidence',
    'missing_product_evidence',
    'missing_usage_evidence',
    'missing_comparison_evidence',
    'missing_cta_surface',
    'missing_text_safe_area'
  ]),
  requiredIngredients: z.array(RequiredIngredientSchema),
  missingIngredients: z.array(MissingIngredientSchema),
  availableButWeakIngredients: z.array(MissingIngredientSchema),
  bestCandidateAssetIds: z.array(z.string()),
  potentialImpact: z.array(CoverageImpactSchema),
  severityEstimate: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(z.string()),
  motifContext: MotifContextSchema.optional(),
  motifType: MotifTypeSchema.optional(),
  missingMotionTokens: z.array(MotionTokenSchema).optional(),
  targetMotifHints: z.array(z.string()).optional(),
  ownership: z.literal('asset_manager_observation_only')
});

export const ContextualAssetCoverageReportSchema = z.object({
  graphId: z.string(),
  briefId: z.string().optional(),
  libraryId: z.string(),
  coverageSummary: z.object({
    totalSlots: z.number().int().min(0),
    coveredSlots: z.number().int().min(0),
    weakSlots: z.number().int().min(0),
    insufficientSlots: z.number().int().min(0),
    coverageScore: z.number().min(0).max(100)
  }),
  slotCoverages: z.array(ContextualSlotCoverageSchema),
  observations: z.array(MaterialCoverageObservationSchema),
  warnings: z.array(z.string())
});

export const CompletionChannelEligibilitySchema = z.object({
  channel: z.enum([
    'manual_shoot',
    'aigc_video_prompt',
    'aigc_image_prompt',
    'hyperframes_card_animation',
    'reuse_crop_zoom',
    'copy_packaging_card',
    'video_agent_fallback_rendering'
  ]),
  eligible: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
  requiredInputs: z.array(z.string()),
  providedInputs: z.array(z.string()),
  missingInputs: z.array(z.string()),
  ownership: z.enum([
    'gap_repair_planner',
    'video_agent',
    'hyperframes_renderer',
    'external_generation_adapter',
    'human_shooting'
  ])
});

export const ManualShootBriefSchema = z.object({
  title: z.string(),
  objective: z.string(),
  shotDescription: z.string(),
  durationSec: z.number().positive(),
  framing: z.string(),
  requiredProps: z.array(z.string()),
  mustCapture: z.array(z.string()),
  avoid: z.array(z.string())
});

export const AigcGenerationBriefSchema = z.object({
  providerHint: z.enum(['gemini', 'seedance', 'generic']),
  prompt: z.string(),
  negativePrompt: z.string(),
  referenceAssetIds: z.array(z.string()),
  expectedDurationSec: z.number().positive(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  safetyNotes: z.array(z.string())
});

export const HyperframesFallbackBriefSchema = z.object({
  title: z.string(),
  cardType: z.enum([
    'hook_card',
    'benefit_card',
    'usage_placeholder_card',
    'comparison_card',
    'cta_card',
    'timeline_bridge_card'
  ]),
  copyIntent: z.string(),
  visualElements: z.array(z.string()),
  animationHints: z.array(z.string()),
  durationSec: z.number().positive(),
  inputAssets: z.array(z.string())
});

export const MissingMaterialBriefSchema = z.object({
  id: z.string(),
  affectedSegmentId: z.string().optional(),
  affectedSlotId: z.string(),
  slotRole: AssetRoleSchema,
  slotIntent: z.string(),
  missingIngredients: z.array(MissingIngredientSchema),
  potentialImpact: z.array(CoverageImpactSchema),
  manualShootBrief: ManualShootBriefSchema.optional(),
  aigcGenerationBrief: AigcGenerationBriefSchema.optional(),
  hyperframesBrief: HyperframesFallbackBriefSchema.optional(),
  channelEligibility: z.array(CompletionChannelEligibilitySchema),
  motifContext: MotifContextSchema.optional(),
  ownership: z.literal('asset_manager_handoff_brief_only')
});

export const AssetSupplyContextSchema = z.object({
  protocolVersion: z.literal('asset-supply-v1'),
  libraryId: z.string(),
  generatedAt: z.string(),
  assets: z.array(NormalizedAssetCardSchema),
  libraryProfile: AssetLibraryProfileSchema,
  contextualCoverage: ContextualAssetCoverageReportSchema.optional(),
  materialScenario: MaterialScenarioProfileSchema.optional(),
  missingMaterialBriefs: z.array(MissingMaterialBriefSchema).optional(),
  warnings: z.array(z.string())
});

export const BoundaryMicroShotSchema = z.object({
  id: z.string(),
  role: z.enum(['pre_transition', 'transition_peak', 'post_transition', 'unknown']),
  durationMs: z.number().optional(),  // milliseconds
  description: z.string().optional()
});

export const ShotSlotIntentSchema = z.object({
  purpose: z.string(),
  energyLevel: z.enum(['low', 'medium', 'high']),
  motionPattern: z.string(),
  compositionPrincipal: z.string(),
  durationMs: z.tuple([z.number(), z.number()]),
  soundDesignHint: z.string().optional()
});

export const ShotSlotSourceInstanceSchema = z.object({
  productInSource: z.string(),
  specificAction: z.string().optional(),
  colorSignature: z.string().optional()
});

export const ShotSlotAcceptanceCriterionSchema = z.object({
  motionType: z.string().optional(),
  compositionType: z.string().optional(),
  examples: z.array(z.string())
});

export const ShotSlotAcceptanceCriteriaSchema = z.object({
  anyOf: z.array(ShotSlotAcceptanceCriterionSchema),
  rejectIf: z.array(z.string()).optional()
});

export const BoundarySchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  transitionType: z.enum(['cut', 'fade', 'morph', 'wipe', 'dissolve', 'unknown']),
  intensity: z.enum(['weak', 'medium', 'strong']).optional(),
  alignedToBeat: z.boolean().optional(),
  microShots: z.array(BoundaryMicroShotSchema).optional(),
  evidence: z.string().optional()
});

export const ViralStructureGraphSchema = z.object({
  schemaVersion: z.enum(['v0', 'v1']).optional(),
  meta: z.object({
    duration: z.number(),
    aspectRatio: z.enum(['9:16', '16:9', '1:1', 'unknown']),
    videoType: z.enum(['ecommerce', 'local_service', 'course', 'brand', 'unknown']),
    style: z.enum(['high_click', 'high_conversion', 'premium', 'fast_pace', 'unknown'])
  }),
  structureSummary: z.string(),
  segments: z.array(z.object({
    id: z.string(),
    role: SegmentRoleSchema,
    start: z.number(),
    end: z.number(),
    duration: z.number(),
    purpose: z.string(),
    narration: z.string().optional(),
    caption: z.string().optional(),
    transferRule: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  })),
  shotSlots: z.array(z.object({
    id: z.string(),
    segmentId: z.string(),
    role: ShotSlotRoleSchema,
    requiredAsset: z.object({
      type: z.enum(['image', 'video', 'text', 'generated']),
      subject: z.string(),
      camera: z.enum(['closeup', 'medium', 'wide', 'macro', 'unknown']).optional(),
      motion: z.enum(['static', 'push_in', 'pan', 'fast_cut', 'hand_operation', 'unknown']).optional(),
      minDuration: z.number().optional()
    }),
    visualIngredientRequirements: z.array(CreativeIngredientTypeSchema).optional(),
    humanRequirement: z.object({
      required: z.boolean(),
      role: HumanRoleSchema.optional(),
      framing: HumanFramingSchema.optional(),
      action: HumanActionSchema.optional()
    }).optional(),
    fallbackStrategies: z.array(GapRepairStrategySchema),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    intent: ShotSlotIntentSchema.optional(),
    sourceInstance: ShotSlotSourceInstanceSchema.optional(),
    acceptanceCriteria: ShotSlotAcceptanceCriteriaSchema.optional(),
    motifAnnotations: z.array(ViralMotifAnnotationSchema).optional()
  })),
  rhythm: z.object({
    avgShotDuration: z.number(),
    cutFrequency: z.enum(['low', 'medium', 'high']),
    peakAt: z.number().optional(),
    pattern: z.string()
  }),
  packaging: z.object({
    captionDensity: z.enum(['low', 'medium', 'high']),
    captionPosition: z.enum(['bottom_center', 'center', 'top', 'mixed']),
    titleStyle: z.string(),
    cardTypes: z.array(z.string()),
    transitions: z.array(z.string()),
    coverStyle: z.string()
  }),
  creativeIngredients: z.array(CreativeIngredientSchema),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    type: z.enum(['sequence', 'requires', 'maps_to', 'fallback']),
    explanation: z.string().optional()
  })),
  boundaries: z.array(BoundarySchema).optional(),
  motifAnnotations: z.array(ViralMotifAnnotationSchema).optional()
});

export const SafetyStatusSchema = z.object({
  status: z.enum(['passed', 'needs_review', 'blocked']),
  ipRisk: z.enum(['low', 'medium', 'high']),
  brandRisk: z.enum(['low', 'medium', 'high']),
  claimRisk: z.enum(['low', 'medium', 'high']),
  reasons: z.array(z.string())
});

export const StoryboardFrameTypeSchema = z.enum([
  'opening_hook',
  'product_closeup',
  'benefit_usage',
  'gap_repair',
  'cta_cover'
]);

export const StoryboardImagePromptSchema = z.object({
  positivePrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', 'unknown']),
  styleHints: z.array(z.string()),
  promptSource: z.literal('storyboard_prompt_planner')
});

export const GeneratedVisualAssetSchema = z.object({
  id: z.string(),
  type: z.enum(['placeholder_svg', 'external_image']),
  url: z.string(),
  mimeType: z.enum(['image/svg+xml', 'image/png', 'image/jpeg']),
  generationSource: z.enum(['placeholder', 'image_api']),
  promptId: z.string(),
  label: z.string()
});

export const StoryboardFrameSchema = z.object({
  id: z.string(),
  frameIndex: z.number().int().min(0),
  frameType: StoryboardFrameTypeSchema,
  title: z.string(),
  timelineItemId: z.string(),
  slotId: z.string().optional(),
  structureIntent: z.string(),
  sourceInstance: z.string(),
  acceptanceCriteria: z.array(z.string()),
  matchedAsset: z.object({
    id: z.string(),
    type: z.enum(['image', 'video', 'text']),
    url: z.string().optional(),
    text: z.string().optional(),
    spatialDescription: z.string().optional(),
    temporalDescription: z.string().optional(),
    qualityScore: z.number().min(0).max(1)
  }).optional(),
  slotMatch: z.object({
    slotId: z.string(),
    assetId: z.string().optional(),
    score: z.number(),
    status: z.enum(['matched', 'partial', 'missing']),
    reason: z.string(),
    alignmentSource: z.enum(['llm_judge', 'rule_based']).optional()
  }).optional(),
  materialGap: z.object({
    slotId: z.string(),
    role: ShotSlotRoleSchema,
    type: MaterialGapTypeSchema.optional(),
    severity: z.enum(['low', 'medium', 'high']),
    reason: z.string(),
    impact: z.string(),
    gapSpecSource: z.enum(['llm_generated', 'rule_based']).optional()
  }).optional(),
  repair: z.object({
    slotId: z.string(),
    strategy: GapRepairStrategySchema,
    explanation: z.string(),
    generatedAssetHint: z.string().optional(),
    gapSpec: z.object({
      ideal: z.string().optional(),
      minimalAcceptable: z.string().optional(),
      alternativeIfNoShoot: z.string().optional()
    }).optional()
  }).optional(),
  imagePrompt: StoryboardImagePromptSchema,
  generatedVisualAsset: GeneratedVisualAssetSchema.optional(),
  safetyStatus: SafetyStatusSchema,
  rationale: z.string()
});

export const GenerationProviderSchema = z.enum(['mock', 'seedance_2_0']);
export const MissingMaterialGenerationModeSchema = z.enum(['image_to_video', 'text_to_video']);
export const MissingMaterialGenerationStatusSchema = z.enum(['planned', 'ready', 'blocked']);

export const MissingMaterialPromptMetadataSchema = z.object({
  source: z.literal('prompt_compactor'),
  originalPositivePromptLength: z.number().int().nonnegative(),
  compactPositivePromptLength: z.number().int().nonnegative(),
  targetMaxCharacters: z.number().int().positive(),
  shotSpecPreserved: z.boolean(),
  warnings: z.array(z.string())
});

export const MissingMaterialGenerationJobSchema = z.object({
  id: z.string(),
  gapId: z.string(),
  repairId: z.string().optional(),
  timelineItemId: z.string().optional(),
  provider: GenerationProviderSchema,
  providerLabel: z.string(),
  mode: MissingMaterialGenerationModeSchema,
  status: MissingMaterialGenerationStatusSchema,
  durationSec: z.number().positive(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', 'unknown']),
  positivePrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
  shotSpec: z.string().min(1),
  gapType: MaterialGapTypeSchema.optional(),
  gapSeverity: z.enum(['low', 'medium', 'high']),
  repairStrategy: GapRepairStrategySchema.optional(),
  storyboardFrameId: z.string().optional(),
  promptMetadata: MissingMaterialPromptMetadataSchema.optional(),
  safetyStatus: SafetyStatusSchema,
  blockedReason: z.string().optional(),
  disclaimer: z.string()
});

export const MissingMaterialGenerationRequestSchema = z.object({
  materialGaps: z.array(z.object({
    slotId: z.string(),
    role: ShotSlotRoleSchema,
    type: MaterialGapTypeSchema.optional(),
    severity: z.enum(['low', 'medium', 'high']),
    reason: z.string(),
    impact: z.string(),
    affectedSegmentId: z.string().optional(),
    missingIngredients: z.array(CreativeIngredientTypeSchema).optional(),
    gapSpec: z.object({
      ideal: z.string().optional(),
      minimalAcceptable: z.string().optional(),
      alternativeIfNoShoot: z.string().optional()
    }).optional(),
    gapSpecSource: z.enum(['llm_generated', 'rule_based']).optional()
  })),
  repairs: z.array(z.object({
    slotId: z.string(),
    strategy: GapRepairStrategySchema,
    explanation: z.string(),
    generatedAssetHint: z.string().optional(),
    gapSpec: z.object({
      ideal: z.string().optional(),
      minimalAcceptable: z.string().optional(),
      alternativeIfNoShoot: z.string().optional()
    }).optional()
  })).optional(),
  storyboardFrames: z.array(StoryboardFrameSchema).optional(),
  timeline: z.array(z.unknown()).optional(),
  contentBrief: ContentBriefSchema.optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', 'unknown']).optional(),
  provider: GenerationProviderSchema.optional()
});

export const DemoEstimateMetricSchema = z.object({
  score: z.number(),
  label: z.string(),
  explanation: z.string(),
  formula: z.string().optional(),
  simulated: z.boolean().optional()
});

export const DemoEstimateSchema = z.object({
  disclaimer: z.literal('Offline heuristic estimate. Not based on real user behavior.'),
  generatedAt: z.string(),
  metrics: z.object({
    viralPotential: DemoEstimateMetricSchema,
    templateFit: DemoEstimateMetricSchema,
    gapRepairCoverage: DemoEstimateMetricSchema,
    evidenceConfidence: DemoEstimateMetricSchema,
    variantDistinctiveness: DemoEstimateMetricSchema,
    estimatedCtrLift: DemoEstimateMetricSchema
  }),
  components: z.record(z.number()),
  warnings: z.array(z.string())
});
