import { z } from 'zod';
import {
  CreativeIngredientTypeSchema,
  SegmentRoleSchema,
  ShotSlotRoleSchema
} from '@viral-struct/shared';

export const GapEvidenceTypeSchema = z.enum([
  'none',
  'product_identity',
  'social_proof',
  'factual_claim',
  'usage_demo'
]);

export const GapEmotionalFunctionSchema = z.enum([
  'curiosity',
  'desire',
  'trust',
  'urgency'
]);

export const GapReportSchema = z.object({
  id: z.string(),
  slotId: z.string(),
  segmentId: z.string(),
  segmentRole: SegmentRoleSchema.optional(),
  slotRole: ShotSlotRoleSchema,
  visualType: z.enum(['image', 'video', 'text', 'generated']),
  durationMs: z.number().positive(),
  evidenceType: GapEvidenceTypeSchema,
  requiresRealProof: z.boolean(),
  emotionalFunction: GapEmotionalFunctionSchema,
  whyUnmatched: z.string().min(1),
  missingIngredients: z.array(CreativeIngredientTypeSchema),
  sourceIntent: z.unknown().optional(),
  acceptanceCriteria: z.unknown().optional()
}).strict();

export const GapFillMethodSchema = z.enum([
  'aigc_fill',
  'deterministic_editing_fill',
  'ask_user_for_asset'
]);

export const GapFillVerifierCheckSchema = z.object({
  id: z.string(),
  type: z.enum([
    'slot_reference',
    'asset_reference',
    'duration',
    'safe_area',
    'claim_supported',
    'product_identity',
    'style_match',
    'no_unapproved_human_generation',
    'structure_fidelity',
    'emotional_function'
  ]),
  description: z.string().min(1),
  level: z.enum(['local', 'global']),
  status: z.enum(['pass', 'fail', 'pending']).optional()
}).strict();

export const AssetGenerationRequestSchema = z.object({
  slotId: z.string(),
  generationMode: z.enum(['text_to_image', 'image_to_video', 'text_to_video']),
  semanticRole: z.string().min(1),
  positivePrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
  referenceAssetIds: z.array(z.string()),
  durationMs: z.number().positive().optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  forbiddenElements: z.array(z.string()).min(1),
  riskFlags: z.array(z.string()),
  fallbackRepair: z.enum(['deterministic_editing_fill', 'ask_user_for_asset']),
  maxRegenerations: z.number().int().min(0).max(2),
  verificationCriteria: z.array(z.string()).min(1)
}).strict();

export const HyperFramesFillSpecSchema = z.object({
  slotId: z.string(),
  repairType: z.enum([
    'title_card',
    'selling_point_card',
    'comparison_card',
    'cta_card',
    'subtitle_patch',
    'product_layout',
    'transition_bridge'
  ]),
  durationMs: z.number().positive(),
  copy: z.object({
    headline: z.string().optional(),
    subline: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    cta: z.string().optional()
  }).strict(),
  referencedAssets: z.array(z.string()),
  layoutIntent: z.string().min(1),
  motionIntent: z.string().min(1),
  styleTokens: z.array(z.string()),
  verificationCriteria: z.array(z.string()).min(1)
}).strict();

export const UserAssetRequestSchema = z.object({
  reason: z.string().min(1),
  whyRequired: z.string().min(1),
  idealShot: z.string().min(1),
  minimalAcceptableShot: z.string().min(1),
  shootingTips: z.array(z.string()).min(1),
  durationMs: z.tuple([z.number().positive(), z.number().positive()]),
  framing: z.enum(['closeup', 'medium', 'wide', 'macro']),
  motion: z.enum(['static', 'push_in', 'hand_operation', 'fast_cut']),
  examplesToAvoid: z.array(z.string()).min(1),
  fallbackIfUserCannotProvide: z.enum(['hyperframes_attributed_card', 'leave_unresolved'])
}).strict();

export const ScriptRepairSpecSchema = z.object({
  scriptIntent: z.string().min(1),
  subtitleLines: z.array(z.string()).min(1),
  voiceoverHint: z.string().optional()
}).strict();

export const QualityImpactSchema = z.object({
  dimension: z.literal('visual_fidelity'),
  severity: z.enum(['reduced', 'lost']),
  originalEvidenceType: GapEvidenceTypeSchema,
  note: z.string().min(1)
}).strict();

export const GapFillPlanSchema = z.object({
  id: z.string(),
  gapReportId: z.string(),
  slotId: z.string(),
  segmentId: z.string(),
  inheritedContext: z.object({
    slotRole: ShotSlotRoleSchema,
    segmentRole: SegmentRoleSchema.optional(),
    sourceIntent: z.unknown().optional(),
    acceptanceCriteria: z.unknown().optional(),
    missingIngredients: z.array(CreativeIngredientTypeSchema).optional(),
    matchStatus: z.enum(['partial', 'missing']),
    matchScore: z.number().optional()
  }).strict(),
  method: GapFillMethodSchema,
  reason: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  resolutionStatus: z.enum(['planned', 'unresolved']),
  qualityImpact: QualityImpactSchema.optional(),
  safetyGate: z.object({
    requiresRealProof: z.boolean(),
    aigcAllowed: z.boolean(),
    userAssetRequired: z.boolean()
  }).strict(),
  reuseSpec: z.object({
    assetId: z.string(),
    treatment: z.enum(['crop_zoom', 'loop', 'reorder', 'still_to_motion']),
    durationMs: z.number().positive(),
    motionIntent: z.string().optional()
  }).strict().optional(),
  editingSpec: HyperFramesFillSpecSchema.optional(),
  aigcRequest: AssetGenerationRequestSchema.optional(),
  userAssetRequest: UserAssetRequestSchema.optional(),
  scriptRepairSpec: ScriptRepairSpecSchema.optional(),
  verifierChecks: z.array(GapFillVerifierCheckSchema).min(1)
}).strict();
