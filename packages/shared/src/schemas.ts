import { z } from 'zod';

export const SegmentRoleSchema = z.enum([
  'hook',
  'pain_point',
  'selling_point',
  'proof',
  'usage',
  'comparison',
  'cta'
]);

export const ShotSlotRoleSchema = z.enum([
  'opening_attention',
  'product_closeup',
  'usage_demo',
  'benefit_visual',
  'comparison',
  'testimonial',
  'cta_visual'
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
  stylePreference: z.string().optional()
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
  visualStyleTags: z.array(VisualStyleTagSchema).optional()
});

export const BoundaryMicroShotSchema = z.object({
  id: z.string(),
  role: z.enum(['pre_transition', 'transition_peak', 'post_transition', 'unknown']),
  durationMs: z.number().optional(),
  description: z.string().optional()
});

export const BoundarySchema = z.object({
  boundaryId: z.string(),
  from: z.string(),
  to: z.string(),
  transitionType: z.enum(['cut', 'fade', 'morph', 'wipe', 'dissolve', 'unknown']),
  intensity: z.enum(['weak', 'medium', 'strong']).optional(),
  alignedToBeat: z.boolean().optional(),
  microShots: z.array(BoundaryMicroShotSchema).optional(),
  evidence: z.string().optional()
});

export const ViralStructureGraphSchema = z.object({
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
    importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional()
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
  boundaries: z.array(BoundarySchema).optional()  // ★ new
});
