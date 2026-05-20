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
  qualityScore: z.number().min(0).max(1)
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
    fallbackStrategies: z.array(z.enum([
      'structure_reorder',
      'caption_rewrite',
      'text_card',
      'selling_point_card',
      'comparison_card',
      'cta_card',
      'crop_zoom',
      'reuse_asset',
      'aigc_background'
    ]))
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
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    type: z.enum(['sequence', 'requires', 'maps_to', 'fallback']),
    explanation: z.string().optional()
  }))
});
